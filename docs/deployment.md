# Deployment

Web KaTrain is a static Vite app. A production build emits `dist/`, which can be
served by GitHub Pages or any static host that can serve JavaScript, WASM,
compressed model files, and the service worker.

## Build

```sh
npm ci
npm run build
```

The build runs:

- TypeScript project build.
- Vite production build.
- Version metadata generation at `dist/version.json`.
- Copy/download prebuild hooks for TensorFlow.js WASM files and the small model.

Preview the result:

```sh
npm run preview
```

## Base Path

`vite.config.ts` computes the Vite base path in this order:

1. `VITE_BASE_URL`
2. `BASE_URL`
3. The GitHub repository name from `GITHUB_REPOSITORY`
4. `/`

The value is normalized to start and end with `/`. For a repository named
`web-katrain`, GitHub Pages builds use `/web-katrain/`.

Use an explicit base path when deploying somewhere unusual:

```sh
VITE_BASE_URL=/my/path/ npm run build
```

## Analysis Visit Cap

The browser engine refuses to start a search deeper than `ENGINE_MAX_VISITS`
(`src/engine/katago/limits.ts`), which defaults to 500,000 visits. It bounds one
analysis request only: the depth selector, the Settings visits fields, and every
engine call derive their limit from it.

Override the default at build time when you want a lower ceiling (for weaker
devices) or a higher one:

```sh
VITE_KATAGO_MAX_VISITS=250000 npm run build
```

The value must be a positive integer; anything else falls back to 500,000.

## Analysis Time Cap

The browser engine also refuses to search longer than `ENGINE_MAX_TIME_MS`
(`src/engine/katago/limits.ts`), which defaults to 10 minutes. Every engine call
clamps its own maximum time to it, so a large visit cap only matters if the time
cap is raised to match.

Override the default at build time:

```sh
VITE_KATAGO_MAX_TIME_MS=1200000 npm run build
```

The value is a positive integer in milliseconds; anything else falls back to
600,000 (10 minutes).

## GitHub Pages

The repository includes `.github/workflows/deploy-pages.yml`. On pushes to
`main` or manual dispatch, it:

1. Checks out the repository with LFS enabled.
2. Sets up Node 24 with npm caching.
3. Runs `npm ci`.
4. Runs `npm run audit`, `npm run lint`, `npm test`, and
   `npm run test:typecheck`. A failure in any of them stops the deploy.
5. Runs `npm run build`.
6. Uploads `dist/` as a Pages artifact.
7. Deploys through `actions/deploy-pages`.

The gates in step 4 are the same checks `npm run` offers locally, in the same
order web-chess uses, so a green local run means a green deploy. Note that
gating on `npm run audit` means a new advisory in a dependency can block a
release without any app code changing — if that happens, it is a real signal,
but it is not a build failure.

The current live URL is:

https://sir-teo.github.io/web-katrain/

## Remote Engine on GitHub Pages

GitHub Pages serves static files; it does not run the `/katago-proxy` configured
in Vite's development server. Production builds instead read
`VITE_KATAGO_WS_URL` as the default direct WebSocket endpoint. A bare server URL
gets `/katago` appended; a URL with an explicit path is preserved.

The Pages workflow passes the repository secret `VITE_KATAGO_WS_URL` to the
build step. Set it to an endpoint such as `wss://engine.example.com/katago`,
then push the changes or rerun the deployment workflow. Existing browsers
that saved the old `/katago-proxy` default adopt the deployed endpoint;
custom URLs remain unchanged. You can also enter the endpoint directly in
Settings → Engine → Remote Engine URL.

Pages uses HTTPS, so its WebSocket endpoint must use `wss://` with a valid TLS
certificate. Changing `ws://` to `wss://` is insufficient if the server only
speaks plain WebSocket. Put a TLS reverse proxy or an HTTPS tunnel that supports
WebSocket upgrades in front of that server. For example, inside an existing
Nginx HTTPS server block with a valid certificate:

```nginx
location /katago {
    proxy_pass http://YOUR_ENGINE_HOST:YOUR_ENGINE_PORT/katago;
    proxy_http_version 1.1;
    proxy_set_header Host $proxy_host;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 600s;
}
```

Use the proxy's `wss://` address in the secret. If the backend restricts
WebSocket origins, allow your Pages origin (`https://USERNAME.github.io`).
The endpoint is embedded in the browser bundle even when supplied through an
Actions secret; it is public configuration, so do not include private credentials.

## Headers

For best WASM performance, serve these headers:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

They enable `SharedArrayBuffer`, which TensorFlow.js WASM uses for threaded
execution.

The Vite dev and preview servers set the headers. The production build ships
`public/_headers`:

```text
/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
```

Hosts such as Netlify and Cloudflare Pages can honor that file. GitHub Pages
does not support custom response headers, so WASM runs single-threaded there.
The app still works, and WebGPU is unaffected by this limitation.

## Service Worker and Offline Cache

The production app registers `sw.js` after page load. Development builds do not
register the service worker.

The service worker precaches:

- The app shell.
- The manifest and the PWA icons. Not the manifest screenshots: they are 504 kB
  shown by the browser, the OS or a crawler, never by the running app.
- The small default model.
- The analysis worker, even before the first analysis. The build records its
  hashed filename in `index.html`; caching it does not start the engine. Like
  the model, a failed worker download leaves the offline board available.
- One TensorFlow.js WASM build, `tfjs-backend-wasm-simd.wasm`. TFJS chooses one
  of the three at runtime, and the other two cannot be chosen here: the threaded
  build needs cross-origin isolation, which GitHub Pages cannot provide, and the
  non-SIMD build is for browsers older than this app supports.
- The board and stone images the *default* theme draws. The other themes are
  cached the first time they are used.

Everything left out stays cache-first at runtime, so anything actually used is
kept offline after the first time it loads.

Navigation requests fall back to the cached app shell when offline. Static
assets are cache-first. Other same-origin GET requests are cached at runtime.

## Updates

The build emits `version.json` with package version, git hash, commit date, and
build date. Production clients poll that file periodically and on window focus.
When a new git hash is detected, the app can show an update-ready banner.

The service worker also listens for `SKIP_WAITING`, allowing the UI to activate
a waiting worker and reload.

## Static Host Checklist

- Serve `index.html`, `404.html`, `manifest.webmanifest`, `sw.js`, model files,
  WASM files, and generated JS/CSS from the same origin.
- Preserve `.gz` model files as files; do not decompress or block them.
- Use the correct Vite base path for subdirectory deployments.
- Add COOP/COEP headers when the host supports them.
- Make sure `404.html` is deployed for SPA fallback on hosts that need it.

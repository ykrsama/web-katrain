# Fox public-record import

This feature adds **Import from Fox** to the desktop **⋯ → Import** menu and the mobile **Menu → Game** actions. The Chinese label is **野狐抓谱**. There is no floating launcher.

The menu entry appears after the configured `/api/fox/status` capability check succeeds. `VITE_FOX_API_BASE_URL` selects the Cloudflare Worker origin; when unset, API paths target the frontend origin root. A static Pages build without an accessible API hides the entry.

It imports public historical records, not live games. No Fox account, cookies or credentials are required. Availability and retention remain controlled by Fox; this is an unofficial client and does not guarantee complete account history.

## GitHub Pages + Cloudflare Worker

The frontend stays on GitHub Pages. `workers/fox/` implements the public-record API on Cloudflare Workers. The Pages workflow checks the code, builds both bundles, deploys the Worker, verifies its status and CORS response, and then publishes Pages. It never runs a persistent server on the Actions runner. The Worker name is `web-katrain-fox`; it is separate from the temporary `web-katrain-fox-probe` used for connectivity testing.

Configure the **repository running the workflow** under Settings → Secrets and variables → Actions:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `CLOUDFLARE_API_TOKEN` | Cloudflare deployment token scoped to your account. Use the **Edit Cloudflare Workers** token template. |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | Your Cloudflare account ID. |
| Variable | `VITE_FOX_API_BASE_URL` | Production Worker origin, e.g. `https://web-katrain-fox.ykrsama.workers.dev`. No `/api/fox` suffix. |
| Variable, optional | `FOX_ALLOWED_ORIGINS` | Comma-separated frontend HTTPS origins. Defaults to `https://<repository-owner>.github.io`. For a custom Pages domain, list it here; include the Pages origin too if both are used. |

An origin contains no repository path: use `https://ykrsama.github.io`, not `https://ykrsama.github.io/web-katrain/`. API URLs are public configuration; keep the deployment token out of all `VITE_*` values and out of source files. See Cloudflare's [GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

Push to `main` or manually run `.github/workflows/deploy-pages.yml`. Wrangler creates the production Worker on the first deploy; no dashboard code editing is needed. When the API URL is configured, missing credentials, a failed Worker deploy or a failed status/CORS check stops the Pages release. When the URL variable is absent, the workflow publishes a static-only site and skips Worker deployment. Custom-domain DNS/routes must already point to this Worker; the workflow creates its `workers.dev` endpoint automatically.

The status check establishes that the deployed service can be reached with the frontend Origin. It does not prove that Fox is reachable at that moment. After the first release, search a real nickname with public records, page through results, preview a record, and download its original SGF. A previous probe passed nickname resolution, listing and SGF fetching through Cloudflare; upstream availability can change.

## Run locally

Prerequisites: Node.js 24+ and `npm ci`. In separate terminals:

```bash
npm run dev:fox
npm run dev
```

Open the Vite URL, normally **http://localhost:5173**. Vite proxies `/api/fox` to the local Worker at `127.0.0.1:18767`. Wrangler runs the Worker locally; no Cloudflare login is needed for this path. Outgoing requests still require access to Fox. Direct cross-origin development from the two standard Vite origins is also permitted by the local Wrangler config.

To use an already deployed Worker, set `VITE_FOX_API_BASE_URL` in the gitignored `.env` and allow your dev origin in the Worker's configuration. For a production frontend build, set it at build time:

```bash
VITE_FOX_API_BASE_URL=https://web-katrain-fox.example.workers.dev npm run build
```

`npm run build:fox` bundles and validates the Worker without deploying. `npm run deploy:fox` deploys and checks it using the same environment variables as CI; outside Actions also supply `FOX_ALLOWED_ORIGINS` explicitly.

The old Python loopback gateway and its duplicate protocol implementation have been replaced by the Worker. The Worker does not provide `/katago-proxy`; browser analysis remains local, and remote AI analysis still uses its existing engine configuration.

## Use and SGF safety

1. Select **nickname** or **UID** explicitly. All-digit nicknames still use nickname lookup unless UID mode is selected.
2. Query and preview a record. Pagination uses the final `chessid` as its cursor, not a page number; overlapping records are deduplicated, and repeated-only pages stop pagination.
3. Download the original SGF, or import a copy onto the board. Confirm replacement of the current board after saving anything you want to keep.
4. For special komi such as `KM[375]`, verify the rules and enter komi **in points** explicitly. The importer does not silently assume 375 points or guess a conversion factor. The original download stays byte-identical; only the parsed import copy gets the confirmed value.
5. Replay normally. The upstream loader opens from the start by default. Imported records get an external filename and detach the previous library save target, so saving does not overwrite the previously opened library record.

Repeated or mixed black/white move values in **any node, including variations**, are rejected rather than silently dropping handicap stones. This is not a comprehensive Fox SGF normalizer. Raw downloads retain variations, handicap and komi as supplied upstream, including UTF-8 byte content. All upstream requests use HTTPS. The old insecure HTTP fallback has been removed.

## Localization

Menu entries, dialog labels, warnings and notifications use the existing `useT()` interface with English source keys. `src/i18n/zh/fox.ts` adds Chinese values without rewriting existing catalogue modules or shadowing their keys. Other declared locales use the app's existing English fallback; this feature does not add complete translations for them.

Closing the dialog unmounts its session, aborts its request, and discards the selected record, komi and board-replacement permission; reopening starts fresh. Old async state updates cannot affect the new component session.

Status/error state stores source keys and interpolation variables, so it re-renders when the app locale changes. Raw server diagnostics are available under **Upstream details (original language)** rather than presented as translated UI.

## Tests

From the repository root:

```bash
npx vitest run test/foxWorker.test.ts test/foxApi.test.ts --maxWorkers=1
node --test test/foxImport.node-check.mjs
npx vitest run test/foxI18n.test.tsx --maxWorkers=1
npm run verify
npm run build:fox
```

Worker tests use synthetic fixtures to cover nickname/UID mode, Unicode query encoding, cursor pagination, raw SGF bytes, unsafe numeric IDs, upstream errors/redirects, response limits, timeouts, caching, CORS and rate limiting. They do not claim live Fox connectivity. Existing import tests retain coverage for komi confirmation and move-node validation. Service-worker tests verify API calls never fall back to stale offline data.

Optional browser boundary checks (requires Playwright and a running Vite server):

```bash
FOX_TEST_URL=http://127.0.0.1:5173 python3 scripts/check-fox-boundaries.py
```

These checks use explicitly synthetic routed responses for stale replacement consent, cancelled/reopened requests, repeated/mixed moves in any variation, and missing-backend static deployments. Their evidence is written to the ignored `.external/fox-evidence/` directory.

The Worker was also exercised in the real local workerd runtime against public Fox HTTPS endpoints: nickname lookup, two pages of records, SGF preview and byte-identical raw download. Earlier browser checks against the former loopback gateway covered encoded-komi refusal and explicit confirmation, library-to-import switching, separate save download, full replay, mobile menu and runtime language switching. The separate cloud probe passed all three upstream stages; the production Worker still needs deployment with your account credentials. Engine-specific tests remain opt-in; these checks do not establish live GPU analysis or live observation support.

## Worker API

- `GET /api/fox/status`: capability and runtime identity. Does not query Fox.
- `GET /api/fox/search?q=<nickname>&mode=nickname` (or explicit `mode=uid`).
- `GET /api/fox/games?uid=<uid>&cursor=<last-chessid>`.
- `GET /api/fox/sgf?id=<chessid>`: raw SGF plus metadata.
- `GET /api/fox/download/<chessid>.sgf`: unchanged attachment.

Only GET/HEAD and CORS preflight are supported. Unknown paths return JSON 404. Browser CORS responses allow exact configured origins, including on errors; requests without Origin remain available for direct downloads and diagnostics. CORS is not authentication.

Cloudflare's rate-limit binding limits record requests per client IP and location; health checks and preflights are exempt. Limits are approximate, and shared network addresses share a bucket. The binding and window are configured in `workers/fox/wrangler.json`. Successful upstream JSON is cached briefly with the Cache API; cache TTL, timeout and response size limit live in `workers/fox/client.ts`. Cache failures fall back to upstream requests. No database is needed. Browser responses use `no-store`, and the app's service worker bypasses `/api/fox/*` entirely. Raw download responses include an attachment filename so downloads also work across origins.

## Protocol reference

The original public HTTP flow was checked against `wimi321/lizzieyzy-next` at `cb53acc55eda42c6c671b5f668cd3b597456bf07`, particularly `src/main/java/featurecat/lizzie/analysis/GetFoxRequest.java`. The Worker uses `QueryUserInfoPanel` for nickname lookup, `YHWQFetchChessList` for listing, and the H5 `YHWQFetchChess` HTTPS endpoint for downloads. The legacy `TXWQFetchChess` HTTP endpoints have been removed. This is separate from that project's native ReadBoard and Fox AI loopback TCP integration.

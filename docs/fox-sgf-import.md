# Fox records

The **Fox records / 野狐棋谱** entry in the desktop **⋯ → Import** menu and mobile **Menu → Game** actions searches historical records and current live games from a single search field with automatic nickname/UID handling. The dialog follows the current UI theme.

The entry is always available. Both nickname discovery and historical records use the configured Cloudflare API (`VITE_FOX_API_BASE_URL`, or the frontend origin when unset). The subsequent live connection runs directly from the browser. A missing API is reported when searching instead of exposing room/link configuration.

Nickname lookup and live observation require no Fox account or cookies. Availability and retention remain controlled by Fox; this is an unofficial client and does not guarantee complete account history or access to every live room.

## Live observation

Enter a nickname or UID in the single search field. Search first resolves a nickname, including numeric nicknames; only an explicit missing-account response allows numeric input to fall back to a UID for historical lookup. Transport and other upstream failures never trigger this fallback. Recent searches are stored in one local list and can be selected, deleted individually or cleared from the dropdown. Earlier nickname/UID history is merged and deduplicated automatically. The result shows **Live observation** and **Historical records** together. If the player is currently playing, select **Watch live game** to preview the position, adjust the prefilled rules/komi if desired, then choose **Watch on board**. The UI does not expose share links or room identifiers. Opening the entry uses the same unsaved-game guard as New game: clean games open directly, while unsaved games offer cancel, discard or save before the search page opens. Imports need no replacement checkbox.

`GET /api/fox/player?q=<query>` automatically resolves the name and reads the public profile's `state_info`. Only `state: 2` locations are treated as the player's current game; `state: 3` is the player watching somebody else and is excluded. Room coordinates are validated, deduplicated and kept internal. Lookup aliases may return a different display name. A profile with no playing location means no current game was found through this lookup; it does not establish that no tournament broadcast featuring that name exists. Profile data is cached for only five seconds, separately from the historical cache.

The browser uses the discovered room key to connect to `wss://wss.foxwq.com/`, requests a temporary visitor identity and enters the game. Board size, chess ID and player identities are read from the actual room snapshot; the requested player's UID must be present before the position is accepted. No extra Worker, database or server deployment is needed beyond the existing Fox API. Only read-only discovery, entry and heartbeat messages are sent; no move or chat commands are sent to Fox.

Historical and live imports share rule and komi defaults. Ordinary SGF point values are preserved. Chinese fixed-point komi is converted from hundredths of a stone to points (`375` → `7.5`); Japanese/Korean hundredths of a point convert as `650` → `6.5`. Missing/unrecognized values use the rule preset default. When both rules and komi are recognized, they are applied automatically and the import page hides both fields. Missing or unrecognized metadata shows editable fields with the fallback values; their choices are applied to the imported root metadata. Original downloads remain unchanged. Closing the dialog after attaching leaves observation running, with **Follow latest move** and **Stop observing** controls on the main board. Closing an unattached preview cancels it. Reviewing an earlier position or exploring a branch pauses automatic following; selecting **Follow latest move** resumes it. Loading another game disconnects observation. Stop keeps the last position and its variations available for saving.

The decoder replays the ordered operation history, including moves, passes and undos. Commentary/reference branches are excluded from the played line. Withdrawn moves and local study branches are retained as variations. A no-move end marker terminates the exported main line when the broadcast retracts moves. Sequence gaps, resets, broken connections and missing heartbeats trigger bounded reconnection with a new complete snapshot; stale callbacks from old sockets are ignored.

The current live reader supports Chinese/Japanese Go without handicap or initial setup, including clock-only time-extension rooms. Unsupported setup/special rules fail explicitly; use historical import for those records. Closed/expired rooms and room reuse are reported instead of showing another game. Live access and connectivity remain controlled by Fox. Protocol tests and browser interaction checks use synthetic messages; separate public nickname checks exercise real discovery and visitor entry.

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

1. Enter a nickname or UID and search. A matching numeric nickname takes precedence over the same digits as a UID. Search history stays in this browser.
2. Query and preview a record. Pagination uses the final `chessid` as its cursor, not a page number; overlapping records are deduplicated, and repeated-only pages stop pagination.
3. Use the prefilled rules and komi, or edit either before importing. Unknown komi encodings fall back to the selected record's rule preset.
4. Download the original SGF or import onto the board. The unsaved-game choice is handled before opening the search page.
5. Replay normally. The upstream loader opens from the start by default. Imported records get an external filename and detach the previous library save target, so saving does not overwrite the previously opened library record.

Repeated or mixed black/white move values in **any node, including variations**, are rejected rather than silently dropping handicap stones. This is not a comprehensive Fox SGF normalizer. Raw downloads retain variations, handicap and komi as supplied upstream, including UTF-8 byte content. All upstream requests use HTTPS. The old insecure HTTP fallback has been removed.

## Localization

Menu entries, dialog labels, warnings and notifications use the existing `useT()` interface with English source keys. `src/i18n/zh/fox.ts` adds Chinese values without rewriting existing catalogue modules or shadowing their keys. Other declared locales use the app's existing English fallback; this feature does not add complete translations for them.

Closing the dialog unmounts its session, aborts its request, and discards the selected record and import settings; local search history remains available; reopening starts fresh. Old async state updates cannot affect the new component session.

Status/error state stores source keys and interpolation variables, so it re-renders when the app locale changes. The import interface shows player information and editable rules/komi, without raw IDs, byte counts, encoded komi or protocol diagnostics.

## Tests

From the repository root:

```bash
npx vitest run test/foxLive.test.ts test/foxWorker.test.ts test/foxApi.test.ts test/foxImportOptions.test.ts test/foxSearchHistory.test.ts --maxWorkers=1
node --test test/foxImport.node-check.mjs
npx vitest run test/foxI18n.test.tsx --maxWorkers=1
npm run verify
npm run build:fox
```

Worker tests use synthetic fixtures to cover nickname/UID mode, Unicode query encoding, cursor pagination, raw SGF bytes, unsafe numeric IDs, upstream errors/redirects, response limits, timeouts, caching, CORS and rate limiting. They do not claim live Fox connectivity. Import tests cover fixed-point komi conversion, rule-default fallbacks, applying edited rules/komi, and move-node validation. Search-history tests cover merging legacy modes, deduplication, persistence, deletion/clearing and invalid stored data. Automatic lookup tests cover numeric-nickname priority, missing-account UID fallback, and failure propagation. Service-worker tests verify API calls never fall back to stale offline data.

Optional browser boundary checks (requires Playwright and a running Vite server):

```bash
FOX_TEST_URL=http://127.0.0.1:5173 python3 scripts/check-fox-boundaries.py
```

These checks use explicitly synthetic routed responses for reset preview state, cancelled/reopened requests, repeated/mixed moves in any variation, and live-only static deployments. Their evidence is written to the ignored `.external/fox-evidence/` directory.

The Worker was also exercised in the real local workerd runtime against public Fox HTTPS endpoints: nickname lookup, two pages of records, SGF preview and byte-identical raw download. Earlier browser checks against the former loopback gateway covered encoded-komi refusal and explicit confirmation, library-to-import switching, separate save download, full replay, mobile menu and runtime language switching. The separate cloud probe passed all three upstream stages; the production Worker still needs deployment with your account credentials. Public nickname discovery and guest WebSocket snapshots were verified for 功夫肥猫, 神游世界 and obw12345. Browser checks with synthetic live messages cover preview, board updates, paused reviewing, follow, stop and theme/mobile layouts. Engine-specific tests remain opt-in; these checks do not establish live GPU analysis.

## Worker API

- `GET /api/fox/status`: capability and runtime identity. Does not query Fox.
- `GET /api/fox/player?q=<query>` (default `mode=auto`; explicit `nickname`/`uid` modes remain available to API clients): display identity and validated current-game locations.
- `GET /api/fox/search?q=<nickname>&mode=nickname` (or explicit `mode=uid`): legacy combined historical lookup.
- `GET /api/fox/games?uid=<uid>&cursor=<last-chessid>`.
- `GET /api/fox/sgf?id=<chessid>`: raw SGF plus metadata.
- `GET /api/fox/download/<chessid>.sgf`: unchanged attachment.

Only GET/HEAD and CORS preflight are supported. Unknown paths return JSON 404. Browser CORS responses allow exact configured origins, including on errors; requests without Origin remain available for direct downloads and diagnostics. CORS is not authentication.

Cloudflare's rate-limit binding limits record requests per client IP and location; health checks and preflights are exempt. Limits are approximate, and shared network addresses share a bucket. The binding and window are configured in `workers/fox/wrangler.json`. Successful upstream JSON is cached briefly with the Cache API; cache TTL, timeout and response size limit live in `workers/fox/client.ts`. Cache failures fall back to upstream requests. No database is needed. Browser responses use `no-store`, and the app's service worker bypasses `/api/fox/*` entirely. Raw download responses include an attachment filename so downloads also work across origins.

## Protocol reference

The original public HTTP flow was checked against `wimi321/lizzieyzy-next` at `cb53acc55eda42c6c671b5f668cd3b597456bf07`, particularly `src/main/java/featurecat/lizzie/analysis/GetFoxRequest.java`. The Worker uses `QueryUserInfoPanel` for nickname lookup, `YHWQFetchChessList` for listing, and the H5 `YHWQFetchChess` HTTPS endpoint for downloads. The legacy `TXWQFetchChess` HTTP endpoints have been removed. This is separate from that project's native ReadBoard and Fox AI loopback TCP integration.

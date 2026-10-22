# Fox public-record import

This feature adds **Import from Fox** to the desktop **⋯ → Import** menu and the mobile **Menu → Game** actions. The Chinese label is **野狐抓谱**. There is no floating launcher.

The menu entry is exposed only after the same-origin `/api/fox/status` capability check succeeds. A static GitHub Pages build without this API hides the entry rather than advertising a broken import action. The supplied gateway serves from `/`; API paths intentionally target the origin root.

It imports public historical records, not live games. No Fox account, cookies or credentials are required. Availability, retention and permitted use remain controlled by Fox; this is an unofficial client, not a guarantee of complete account history.

## Run locally

Prerequisites: the project's supported Node version and Python **3.11+**. From the repository root:

```bash
npm ci
npm run build
python3 tools/fox_sgf/gateway.py \
  --dist dist \
  --manifest tools/fox_sgf/manifest.json \
  --port 18767
```

Open **http://127.0.0.1:18767**. The gateway serves both the production front end and `/api/fox/*` from the same origin, avoiding browser CORS and mixed-content restrictions. It binds to loopback only and rejects foreign Host/Origin headers. Do not expose this development gateway as a public service.

Direct upstream access is the default. If needed, explicitly select a local proxy:

```bash
python3 tools/fox_sgf/gateway.py --dist dist \
  --manifest tools/fox_sgf/manifest.json --port 18767 \
  --proxy http://127.0.0.1:7890
```

The gateway does **not** provide the app's `/katago-proxy` WebSocket engine. Configure a separate engine before using remote AI analysis. The Fox import workflow does not need one.

## Use and SGF safety

1. Select **nickname** or **UID** explicitly. All-digit nicknames still use nickname lookup unless UID mode is selected.
2. Query and preview a record. Pagination uses the final `chessid` as its cursor, not a page number; overlapping records are deduplicated, and repeated-only pages stop pagination.
3. Download the original SGF, or import a copy onto the board. Confirm replacement of the current board after saving anything you want to keep.
4. For special komi such as `KM[375]`, verify the rules and enter komi **in points** explicitly. The importer does not silently assume 375 points or guess a conversion factor. The original download stays byte-identical; only the parsed import copy gets the confirmed value.
5. Replay normally. The upstream loader opens from the start by default. Imported records get an external filename and detach the previous library save target, so saving does not overwrite the previously opened library record.

Repeated or mixed black/white move values in **any node, including variations**, are rejected rather than silently dropping handicap stones. This is not a comprehensive Fox SGF normalizer. Raw downloads retain variations, handicap and komi as supplied upstream. SGF downloads use HTTPS by default. Legacy HTTP fallback is **disabled by default**; explicitly add `--allow-insecure-http` only if compatibility is required after HTTPS fails. Such responses are marked as untrusted transport in the import UI. This flag does not make HTTP data trustworthy.

## Localization

Menu entries, dialog labels, warnings and notifications use the existing `useT()` interface with English source keys. `src/i18n/zh/fox.ts` adds Chinese values without rewriting existing catalogue modules or shadowing their keys. Other declared locales use the app's existing English fallback; this feature does not add complete translations for them.

Closing the dialog unmounts its session, aborts its request, and discards the selected record, komi and board-replacement permission; reopening starts fresh. Old async state updates cannot affect the new component session.

Status/error state stores source keys and interpolation variables, so it re-renders when the app locale changes. Raw server diagnostics are available under **Upstream details (original language)** rather than presented as translated UI.

## Tests

From the repository root:

```bash
python3 -m unittest discover -s tools/fox_sgf -p 'test_*.py' -v
node --test test/foxImport.node-check.mjs
npx vitest run test/foxI18n.test.tsx --maxWorkers=1
npm run verify
```

The Python transport and gateway tests use explicitly synthetic fixtures and never claim those fixtures are real downloaded games. The frontend guard checks prior catalogue module bytes, effective values in the actual spread order, absence of new key collisions, placeholder parity, English fallback and real component SSR in English/Chinese.

Optional browser boundary checks (requires Playwright and a running gateway):

```bash
FOX_TEST_URL=http://127.0.0.1:18767 python3 scripts/check-fox-boundaries.py
```

These checks use explicitly synthetic routed responses for stale replacement consent, cancelled/reopened requests, repeated/mixed moves in any variation, and missing-backend static deployments. Their evidence is written to the ignored `.external/fox-evidence/` directory.

The implementation was also exercised against real public Fox records through a loopback gateway: nickname lookup, pagination listing, raw download byte equality, encoded-komi refusal and explicit confirmation, library-to-import switching, separate save download, full replay, mobile menu and runtime language switching. Engine-specific tests remain opt-in; these checks do not establish live GPU analysis or live observation support.

## Gateway API

- `GET /api/fox/status`: gateway/build identity; the shipped manifest identifies the source baseline, not a deployment timestamp.
- `GET /api/fox/search?q=<nickname>&mode=nickname` (or explicit `mode=uid`).
- `GET /api/fox/games?uid=<uid>&cursor=<last-chessid>`.
- `GET /api/fox/sgf?id=<chessid>`: raw SGF plus metadata.
- `GET /api/fox/download/<chessid>.sgf`: unchanged attachment.

Requests are throttled and briefly cached in memory. No server-side record database is created. Unknown API/static paths do not fall through to HTML; static traversal is blocked, JS/WASM MIME types are preserved, and COOP/COEP headers support the upstream WASM runtime.

## Protocol reference

The public HTTP flow was checked against `wimi321/lizzieyzy-next` at `cb53acc55eda42c6c671b5f668cd3b597456bf07`, particularly `src/main/java/featurecat/lizzie/analysis/GetFoxRequest.java`. Nickname lookup uses `QueryUserInfoPanel`, listing uses `YHWQFetchChessList`, and downloads use `TXWQFetchChess` with a H5 `YHWQFetchChess` fallback. This is separate from that project's native ReadBoard and Fox AI loopback TCP integration.

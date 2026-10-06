# Development Context

Last checkpoint: [2026-10-06 - Repository Modules](../checkpoints/2026-10-06-repository-modules.md).

This is the living handoff document for subsequent development. Read it and the
latest checkpoint before changing the explorer or forecasting code. The source
code is authoritative when it differs from this document. Update this context
and add a dated checkpoint after a substantial feature or architecture change.

## Project

- Repository: `nse-bse-api`, version `0.1.3`, TypeScript, Node.js >=18.
- Separate unofficial NSE and BSE clients; exported together through
  [../../src/index.ts](../../src/index.ts).
- ESM and CommonJS builds, TypeScript declarations, and Vitest tests.
- Domain code: `src/nse`, `src/bse`, `src/forecast`, `src/kite`. HTTP entry
  points/assets: `apps/explorer`, `apps/kite`. Tests mirror these boundaries.
- Tooling: `scripts/build`, `scripts/forecast`; configuration placeholders:
  `config/examples`. Local `.env.kite` and caches remain unmoved and ignored.
- Existing package exports and npm commands are preserved; new `/forecast` and
  `/kite` package entries expose module cores, not HTTP servers.
- Windows is the current development environment; use PowerShell syntax.
- Separate read-only Kite feature handoff: [../kite/CONTEXT.md](../kite/CONTEXT.md).
- Existing modifications are uncommitted. Preserve user changes and do not
  reset, clean, commit, or change branches without an explicit request.

## Development History

1. Added a Swagger-style local explorer for the Node library. This is a custom
   developer tool, not a Swagger/OpenAPI specification or production service.
2. Added an experimental NSE statistical stock forecast based on two years of
   history, for one or five trading sessions, with uncertainty and backtesting.
3. Added custom start/end dates, with historical training cutoffs and a maximum
   seven-calendar-day inclusive forecast range.
4. Added market context and an optional EODHD news adapter. This provider path
   was subsequently removed at the user's request; do not restore it implicitly.
5. Added local pretrained Prosus FinBERT inference through its documented ONNX
   conversion, technical-indicator features, and random-forest training.
6. Replaced random forests with official LightGBM and changed the lookback to
   three years, using the user's 14-month train / 3-month test / 6-month rolling
   advance schedule. Local FinBERT remains optional; hosted news is removed.
7. Added opt-in hosted Explorer support for Render. `npm start` runs the HTTP
  server, not the library entry point. Hosted mode uses `RENDER_EXTERNAL_URL`
  or `EXPLORER_PUBLIC_ORIGIN`, binds to all interfaces, and enforces the exact
  public host/origin. Local-only behavior remains the default. `/health` is
  available without exchange calls. This is still an unauthenticated developer
  tool. The Render build now creates the default Linux LightGBM virtual
  environment, installs its dependencies, and checks imports before deployment.

The older two-year lookback, EODHD API token settings, provider news-symbol
filter, and random-forest descriptions are superseded, not current behavior.

## Current Forecast Contract

Library entry: `nse.forecastStock(params)` or `nse.forecast.forecastStock(params)`.
Explorer HTTP entry: `POST /api/forecast`; catalogue entry:
`POST /api/run/nse-forecast`. Responses wrap the result in `data`, with
`durationMs` alongside it.

```json
{
  "symbol": "TCS",
  "horizon": "week",
  "model": "technical",
  "context": "auto",
  "sentiment": "off"
}
```

- `horizon`: `next_day` (default), `week` (five sessions), or `custom`.
- Custom mode requires ISO string `start_date` and `end_date`, ordered and at
  most seven calendar days inclusive. Weekends are skipped; holiday dates and
  session offsets are approximate. Weekend-only ranges are rejected.
- For custom forecasts, history starts three calendar years before the start
  date and ends the day before it. Prices inside/after the forecast range are
  excluded, including for historical requests.
- Other horizons anchor their three-year history to the current India date.
  At least 600 valid closes and coverage near the start are required. History
  more than ten calendar days old relative to its cutoff is rejected.
- Explorer defaults to `model: technical` (LightGBM). Direct library/API calls
  omitting `model` still default to the statistical `baseline`.
- `technical_finbert` enables joint technical/sentiment LightGBM training and
  requires a sufficient local headline archive. It must not silently fall back
  to a differently named model.
- `context: auto` adds free NIFTYBEES market context. `off` disables context.
  The baseline can use the beta overlay; LightGBM price predictions do not add
  that heuristic overlay, but context can withhold the directional signal.
- `sentiment`: `off` (explorer default) or `finbert`, using a local archive only.
  There is no hosted news request, provider symbol, or API-key requirement.
- Invalid parameters return HTTP 400. Data/model/runtime failures return 502.
  Another in-progress explorer call returns 429.

The result contains last close, actual history coverage, indicators, forecast
points/ranges, direction and signal, model metadata, backtest metrics, context,
and warnings. An up/down point estimate is not a reliable trading signal.

## Rolling LightGBM Training

- Three years of actual NSE daily closes; causal features from known data.
- Twelve causal, close-derived features: one/five/10/20-session log returns,
  SMA20/50 and EMA12/26 ratios, RSI14, MACD histogram ratio, Bollinger %B,
  Bollinger bandwidth, and 20-session volatility. OHLCV-dependent indicators
  are not included because the forecast observation pipeline retains closes only.
- Bollinger %B and bandwidth plus 10/20-session returns were added on
  2026-10-05. Their implementation and feature integration are tested, but
  improved out-of-sample forecast accuracy has not been established.
- Official Python LightGBM 4.6.0, 100 trees, 15 leaves, depth 4, learning rate
  0.05, minimum 20 child samples, seed 42, two CPU threads.
- Fixed rolling training window of 14 calendar months, followed by three
  calendar months of testing. Advance both boundaries by six months and repeat.
- Model weights remain frozen within each test block. Each day's short-horizon
  prediction uses information available at that day; this is not a single
  three-month future price-path prediction.
- A six-month step with three-month testing leaves three-month gaps between
  scored test blocks. Actual prices in these gaps may enter later training.
- Labels crossing train/test boundaries are purged. Train only on actual target
  returns that have already completed by the training cutoff.
- Earlier predictions and observed outcomes are retained for evaluation and
  residual calibration. Predicted prices are NEVER substituted for true labels.
  This is the scientific correction to the user's initial suggestion of
  retraining with forecast data.
- Refit on the latest 14 months for the requested future forecast. Horizons are
  predicted directly, not by generating artificial future candles.
- Models are freshly fitted per request; no persisted stock-model weights or
  incremental booster continuation are implemented.

`model.training.folds` reports boundaries and row counts.
`model.training.outOfSampleForecasts` retains origin/target dates and predicted
versus actual log returns. `backtest` summarizes the final requested horizon.

Ranges use the 95th percentile of earlier OOS absolute log-return errors. Test
coverage uses only errors from prior completed folds. The first uncalibrated
fold is excluded from coverage, and `coverageSamples` reports the denominator.
Future ranges use all available past OOS residuals. Temporal dependence and
overlapping targets mean 95% coverage is not guaranteed.

## Local FinBERT

- Pretrained `ProsusAI/finbert`, using the documented `Xenova/finbert` ONNX
  conversion through optional Transformers.js v3, CPU, quantized `q8` weights.
- Actual inference was verified in both ESM and CommonJS. Python LightGBM and
  Node FinBERT are separate runtimes; FinBERT does not require Python.
- Explicit opt-in only. Public model weights download on first use, roughly
  100+ MB, into `node_modules/.cache/finbert` for the explorer.
- Scores are positive/negative/neutral financial-sentiment probabilities;
  polarity is positive minus negative. They are not stock-movement probabilities.
- `FINBERT_NEWS_ARCHIVE`, or `forecastTraining.newsArchivePath`, configures an
  existing local JSON archive: version 1, symbol matching the stock or `GLOBAL`,
  timestamped `articles` with `publishedAt` and `title`.
- Archive bounds: 5 MB, 2000 headlines. Timezones are required. Future articles
  are excluded before scoring; duplicate timestamp/headline pairs are removed.
- Joint features aggregate the preceding three calendar days at each price
  date's 15:30 India-time cutoff, requiring at least three headlines per date.
- Archive preprocessing requires broad historical coverage. Every rolling fold
  additionally needs at least 120 covered training labels and 20 test labels.
- No automatic historical-news collection, paid-provider fallback, or fine-tuning
  FinBERT on this stock. Joint code paths were validated with synthetic archives;
  investment performance with a real long archive is not established.

## Ownership Map

| Surface | Owning File |
| --- | --- |
| Library exports | [../../src/index.ts](../../src/index.ts) |
| NSE orchestration | [../../src/nse/client/nse-client.ts](../../src/nse/client/nse-client.ts) |
| Historical NSE fetch/pagination | [../../src/nse/api/historical-api.ts](../../src/nse/api/historical-api.ts) |
| Input validation, history cutoffs, result assembly | [../../src/forecast/forecast-api.ts](../../src/forecast/forecast-api.ts) |
| Indicators, tasks, OOS metrics and metadata | [../../src/forecast/trained-forecast.ts](../../src/forecast/trained-forecast.ts) |
| Calendar folds and boundary purging | [../../src/forecast/walk-forward.ts](../../src/forecast/walk-forward.ts) |
| Async official LightGBM subprocess bridge | [../../src/forecast/lightgbm.ts](../../src/forecast/lightgbm.ts) |
| Free market and local-archive context | [../../src/forecast/forecast-context-api.ts](../../src/forecast/forecast-context-api.ts) |
| Local sentiment inference/cache | [../../src/forecast/finbert.ts](../../src/forecast/finbert.ts) |
| Archive loading and historical sentiment features | [../../src/forecast/finbert-history.ts](../../src/forecast/finbert-history.ts) |
| Local HTTP bridge and environment configuration | [../../apps/explorer/server.ts](../../apps/explorer/server.ts) |
| Allowlisted endpoint schemas | [../../apps/explorer/api.ts](../../apps/explorer/api.ts) |
| Explorer interactions and rendering | [../../apps/explorer/public/app.js](../../apps/explorer/public/app.js) |
| Explorer markup/styles | [../../apps/explorer/public/index.html](../../apps/explorer/public/index.html), [../../apps/explorer/public/styles.css](../../apps/explorer/public/styles.css) |
| Windows Python setup | [../../scripts/forecast/setup-lightgbm.ps1](../../scripts/forecast/setup-lightgbm.ps1) |
| Python requirements | [../../scripts/forecast/lightgbm-requirements.txt](../../scripts/forecast/lightgbm-requirements.txt) |
| User-facing usage | [../../README.md](../../README.md) |

## Setup And Verification

```powershell
npm install
npm run setup:lightgbm
npm run test:forecast
npm run build
npm run explorer
```

Windows setup downloads official Astral uv and installs project-local Python
3.12 and LightGBM dependencies under `node_modules/.cache/lightgbm`. It needs
network access but no administrator privileges. The package Node engine is
>=18; LightGBM forecasting additionally needs the Python environment.

| Setting | Purpose |
| --- | --- |
| `PORT` | Explorer port; default 3100 |
| `LIGHTGBM_PYTHON` | Override the Python executable containing LightGBM |
| `FINBERT_NEWS_ARCHIVE` | Optional local historical headline archive |

The explorer binds to `127.0.0.1`, checks host/origin, serves only allowlisted
assets/methods, caps request bodies at 16 KB, and serializes calls. It avoids
browser exchange-cookie/CORS issues through the Node clients. No API keys or
credentials belong in documentation or checkpoints. Do not expose it publicly.

Caches: `node_modules/.cache/api-explorer`, `node_modules/.cache/lightgbm`, and
`node_modules/.cache/finbert`. These are reproducible runtime data, not checkpoint
artifacts. The package's published file list does not include the explorer or
setup scripts; consumers outside this checkout must provision Python themselves.

Focused gate: `npm run test:forecast` (last known: 46 passing tests).
Library gate: `npm run build` (ESM and CommonJS). Whole-suite tests include live
exchange calls; don't confuse network availability failures with unit failures.
Check this checkpoint's verified scope before claiming broader coverage.

## Operational Lessons And Limitations

- Historical rows currently use `mtimestamp`, `chClosingPrice`, `chSymbol`,
  and `chSeries`. Older uppercase aliases are handled. Dates may be DD-Mon-YYYY.
- NSE date formatting uses local getters: send local-noon Date objects to avoid
  UTC-midnight day shifts. `formatDateYMD` is compact YYYYMMDD, not ISO.
- Repeated EADDRINUSE errors were caused by older explorer instances on 3100.
  Identify the owner and catalogue before stopping anything; avoid terminating
  unrelated Node processes. Port 3101 was used for the latest updated explorer.
  Treat running processes and ports as transient, not guaranteed next-session state.
- Replacing files by deletion/recreation left stale VS Code import diagnostics.
  Both builds passed. Use TypeScript: Restart TS Server; don't distort valid code
  to hide a stale editor cache. Prefer in-place edits.
- Latest observed npm audit reported 10 dependency vulnerabilities. They were
  not automatically upgraded with breaking `audit fix --force` changes.
- Unadjusted splits/dividends, exchange holidays, sparse/stale data, revisions,
  and regime changes remain risks. Large historical jumps withhold the signal.
- No model performance guarantee. The tested live TCS LightGBM model did not
  beat no-change prices; its directional signal remained uncertain.
- Adding indicators increases feature breadth, not proven forecast quality;
  compare out-of-sample metrics against the no-change baseline before claiming
  improvement. This feature set does not include high/low/volume indicators.
- No persistent model store, training-job API, scheduler, or news-archive
  ingestion pipeline. Context risk flags are not a causal event-impact model.

## Next Development Protocol

1. Read this file and its linked latest checkpoint. Recheck the actual touched
   source and working tree; never assume prior session files are unchanged.
2. Confirm the requested split semantics before altering rolling versus expanding
   windows, month counts, gap coverage, or target-label boundaries.
3. Keep tests scoped to the changed behavior first. Use the forecast gate and
   library build for shared/API changes; use browser checks for UI changes.
4. Keep observed labels, OOS predictions, model calibration, and sentiment
   probabilities distinct. Never claim improvement without measured evidence.
5. Update current decisions, verification status and limitations here. Add a
   dated checkpoint recording the change, its tests and outstanding work.
6. Point repository memory at the new checkpoint. A documentation checkpoint
   does not create a Git commit, release, backup, or immutable code snapshot.
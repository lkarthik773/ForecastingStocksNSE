# Checkpoint: Rolling LightGBM

Date: 2026-10-05

Living context: [Development Context](../development/CONTEXT.md).
Status: implemented in the shared working tree; not committed or released.
This is a documented handoff, not an immutable source-code backup or Git tag.

## User Goal And Latest Decision

Provide a local API explorer and stock forecasts using historical prices,
technical indicators, uncertainty and verifiable time-series evaluation.

Latest request superseded the prior provider/random-forest approach:

- Remove EODHD-related changes.
- Use official LightGBM with three years of NSE stock history.
- Train for 14 calendar months, test the following three months, advance six
  months, and repeat with a fixed rolling window.
- Keep past predictions for evaluation; retraining uses actual observed target
  returns rather than treating forecasts as true labels.

The explorer now defaults to LightGBM and sentiment off. Baseline comparison
and optional local-archive FinBERT are retained. No hosted news token is needed.

## Delivered State

- Custom developer explorer with 29 read-only NSE/BSE operations, parameter
  forms, JS/cURL previews, JSON/table results, copy/download, request history,
  model metadata, and expandable rolling-fold details.
- NSE forecasting: next session, five sessions, or at most seven inclusive
  calendar dates in custom mode; weekday approximations without a holiday engine.
- Three-year request window, 600-close minimum, strict historical cutoffs,
  duplicate/conflict validation and stale-data rejection.
- Python LightGBM 4.6.0 behind an asynchronous Node subprocess bridge. Isolated
  Windows setup and alternative interpreter path support.
- Causal technical features and purged labels; frozen test-block models,
  latest-14-month final fit, OOS prediction/actual records and baseline metrics.
- Prior completed test-fold residuals calibrate later ranges; first-fold
  coverage excluded and coverage denominator exposed.
- Free NSE NIFTYBEES market context and optional local Prosus FinBERT archive.
- EODHD source/config/UI/docs and the random-forest dependency removed.
- TypeScript exports, setup requirements and README updated.

## Example Fold Schedule

History start: 2023-10-05. History boundary: 2026-10-05.

| Fold | Train Start | Train End / Test Start | Test End |
| --- | --- | --- | --- |
| 1 | 2023-10-05 | 2024-12-05 | 2025-03-05 |
| 2 | 2024-04-05 | 2025-06-05 | 2025-09-05 |
| 3 | 2024-10-05 | 2025-12-05 | 2026-03-05 |
| 4 | 2025-04-05 | 2026-06-05 | 2026-09-05 |

Ends are exclusive. Test blocks have three-month gaps due to the six-month
advance. Testing is daily short-horizon prediction over each block, not a
single three-month price trajectory. Forecasts are not synthetic training labels.

## Verification Evidence

Last feature-verification run in this conversation on 2026-10-05:

- `npm run test:forecast`: 46 tests passed across six files.
- `npm run build`: ESM and CommonJS passed.
- Official Python LightGBM 4.6.0 installation and execution passed.
- Real NSE TCS history: 743 valid closes from 2023-10-05 through 2026-10-01.
- Weekly live request: four complete rolling folds for each direct horizon,
  1,205 OOS records across one-to-five-session models.
- Five-session evaluation: 233 scored predictions, 175 interval-coverage
  samples, about 3.2387% model MAPE versus 2.6642% no-change MAPE, about 53.65%
  directional accuracy. The model did NOT beat the no-change baseline.
- Desktop/mobile browser check: model default, sentiment off, absent provider
  fields, fold dates, JSON/table rendering and no horizontal overflow passed.
- No remaining EODHD/random-forest references were found in source, scripts,
  tests, README, manifest or lockfile at the removal check.

These are prior observed results, not guarantees that later edits or a new
machine still pass. This documentation task does not claim fresh live-news,
whole-suite, lint, production, or real-archive investment-performance validation.

## Working Tree Snapshot

Captured before creating these handoff files:

- Modified: README, package manifest, main/NSE exports, NSE client and options.
- Untracked: lockfile, explorer directory, LightGBM setup/requirements,
  forecast/context/FinBERT/LightGBM/training/split modules, and focused tests.
- Existing user changes were preserved. No Git commit, branch or tag was created.

New handoff artifacts: root docs/development/CONTEXT.md and this checkpoint.
Future edits must recheck the working tree rather than assume this list is fixed.

## Runtime And Resume

```powershell
npm install
npm run setup:lightgbm
npm run test:forecast
npm run build
npm run explorer
```

Default bind: 127.0.0.1:3100. Last verified updated instance used 3101 because
an older explorer occupied 3100. Do not assume either process remains running.
Use the local catalogue to identify the owner before stopping it.

Optional settings: `PORT`, `LIGHTGBM_PYTHON`, `FINBERT_NEWS_ARCHIVE`.
No secrets are stored in this checkpoint. Cache/runtime environments are not
included as source artifacts and must be reproducible from setup.

## Open Issues And Boundaries

- VS Code reported stale imports after file recreation despite passing builds;
  restart the TypeScript server instead of changing valid imports.
- Last npm audit reported 10 vulnerabilities; no forced breaking upgrade applied.
- No actual long-news-archive investment validation; local FinBERT inference and
  synthetic joint-training paths were tested in earlier iterations.
- No persistent stock-model store, scheduled retraining, resumable training job,
  independently collected news archive, holiday calendar or adjusted-price engine.
- Python is an extra forecasting prerequisite; npm installation alone is not enough.
- LightGBM did not outperform the no-change baseline in the observed TCS test.

## Handoff Rule

Read the living context and relevant source before the next change. Keep the
14/3/6 schedule and real-label safeguards unless the user changes them. Record
new verification honestly, update docs/development/CONTEXT.md, and add a later dated
checkpoint for the next substantive development milestone.
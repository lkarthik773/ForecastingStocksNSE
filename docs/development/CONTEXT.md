# Development Context

Last implementation checkpoint: [2026-10-07 - Probability Target Foundation Audit](../checkpoints/2026-10-07-probability-target-audit.md).
Earlier dated benchmark checkpoints are retained as history, but their
pre-correction metrics are superseded by the regenerated results summarized
below and in the result CSVs.

This is the living handoff document for subsequent development. Read it and the
latest checkpoint and [forecast improvement plan](FORECAST_IMPROVEMENT_PLAN.md)
before changing the explorer or forecasting code. The source code is
authoritative when it differs from this document. Update this context and add a
dated checkpoint after a substantial feature or architecture change.

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
- Forecast improvement roadmap: [Forecast improvement plan](FORECAST_IMPROVEMENT_PLAN.md).
- Current development focus: forecast evaluation and accuracy. Kite feature
  development is paused pending review of the forecast plan; preserve current
  Kite HOLD behavior and do not add or enable order execution.
- Current forecast status: Phase 1 benchmark/data-quality work and the Phase 2
  common-date 36/60/120-month history comparison are complete. Phase 3 OHLC,
  broad-market context, close-only volatility/path structure, relative-volume,
  and prior-fold prediction-shrinkage experiments are complete; none was
  adopted. No model has demonstrated a reliable improvement over the no-change
  price baseline.
- On 2026-10-07, a bug was fixed in parsing NSE `DD-Mon-YYYY` historical dates:
  the previous code truncated the date before parsing and silently skipped
  split/bonus adjustments. All Phase 1-3 benchmark runs and exports were
  regenerated. Use the corrected results below; older checkpoint metrics are
  historical and superseded.
- Corrected default benchmark: 29 symbols; 60-month history; 14-month train /
  3-month frozen test / 6-month advance. LightGBM MAPE is 1.1320% next day and
  2.8892% for five sessions, versus no-change 1.0194% and 2.3503%; directional
  accuracy is 50.36% and 50.43%. The model still loses to no-change.
- The separately rerun 3-month-advance diagnostic also loses to no-change:
  MAPE is 1.1649% next day and 2.9199% for five sessions versus 1.0554% and
  2.4244%; direction is 50.47% and 50.77%.
- Causal shrinkage was tested benchmark-only using factors 0.0-1.0 by 0.1,
  fitted solely on earlier completed OOS folds (minimum 100 prior predictions;
  otherwise no-change). On the current 14/3/6 schedule, shrinkage MAPE was
  1.0199% next day and 2.3503% for five sessions, versus no-change 1.0194% and
  2.3503%. On the gap-free diagnostic it was 1.0555% and 2.4259%, versus
  1.0554% and 2.4244%. The selected factor was zero in most folds, at most
  0.1, and the candidate did not beat no-change. Production forecast and Kite
  HOLD remain unchanged.
- The proposal [feedtstock2forecastmodel.md](feedtstock2forecastmodel.md) was
  reconciled against current code: walk-forward validation, LightGBM,
  corporate-action/data-quality handling, close-derived indicators, OHLC,
  volume, and market-proxy candidates already exist or were benchmarked.
  Sector-index modeling, true VWAP/intraday inputs, F&O, and threshold-event
  probability outputs remain unimplemented or data-blocked; feature candidates
  already tested were not adopted.
- Probability-target foundation audit is benchmark-only. Current 14/3/6
  schedule contains 14,044 next-day and 13,136 five-session labels. Observed
  positive-return rates are 49.70% and 50.61%; >+1% rates are 19.40% and
  35.47%; <-1% rates are 18.73% and 34.54%. The prior-only, fold-causal
  prevalence baseline's Brier scores are 0.2504, 0.1694, 0.1628 next day and
  0.2521, 0.2373, 0.2292 at five sessions, respectively. This is a baseline
  audit, not a learned probability forecast; API outputs are unchanged.
- Corrected volume audit: 29 symbols, 1,239 rows each (35,931 total), from
  2021-04-05 to 2026-04-02. `chTotTradedQty` is positive and present on every
  row; no duplicate dates, invalid/zero volumes, or non-equity rows. Eight
  ex-date groups covered nine split/bonus actions. Share-factor-restated
  event-window volume ratios remain variable (about 0.56-2.39), so this
  availability audit does not validate volume as a predictive feature. A
  benchmark-only candidate using log current quantity / prior 20-session
  median was tested with a 20-observation post-action warmup. It did not
  demonstrate a useful gain; no volume feature is used in production.
- Phase 4 sentiment archive availability audit: blocked because
  `FINBERT_NEWS_ARCHIVE` is unset and no local headline archive was found in
  conventional project data/cache locations. No external news was fetched.
  Synthetic sentiment tests are not real-history coverage or accuracy
  evidence. Do not run a sentiment ablation until a suitable local archive
  with per-article symbol relevance and point-in-time provenance is available.
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
   five years by default (configurable from 36 to 120 months), using the user's
   14-month train / 3-month test / 6-month rolling advance schedule. Local
   FinBERT remains optional; hosted news is removed.
7. Added opt-in hosted Explorer support for Render. `npm start` runs the HTTP
  server, not the library entry point. Hosted mode uses `RENDER_EXTERNAL_URL`
  or `EXPLORER_PUBLIC_ORIGIN`, binds to all interfaces, and enforces the exact
  public host/origin. Local-only behavior remains the default. `/health` is
  available without exchange calls. This is still an unauthenticated developer
  tool. The Render build now creates the default Linux LightGBM virtual
  environment, installs its dependencies, and checks imports before deployment.
8. Established an action-aware, quality-screened forecast benchmark across a
   fixed cohort of 29 NSE equities. Known split/bonus actions are adjusted
   causally; suspicious intraday-reversal candles are flagged and affected
   training/evaluation samples are excluded rather than silently repaired.
   TATAMOTORS remains excluded under the user's direction because the
   historical endpoint returned a different symbol. ADANIENT's unexplained
   large moves remain documented and flagged, not assumed to be corporate
   actions.
9. Completed a common-date Phase 2 comparison of 36-, 60-, and 120-month
   history settings. The fixed model schedule and sample cohort were preserved;
   detailed results and limits are recorded below and in the improvement plan.
10. Implemented the separate Kite read-only account service and preview-only
    forecast gate. User-reported live account reads succeeded. The service
    remains in HOLD mode and cannot submit, modify, or cancel broker orders.

The older two-year lookback, EODHD API token settings, provider news-symbol
filter, and random-forest descriptions are superseded, not current behavior.

## Development Status And Next Steps

### Completed forecast work

- **Phase 1 — benchmark and data-quality controls:** fixed 29-symbol NSE
  cohort; one-session and five-session horizons; causal split/bonus adjustment
  through the configured NSE forecast path; OHLC reversal screen; same-date
  baselines; per-symbol/per-fold reporting; eligibility and holdout records.
  All eligible symbols were retained regardless of backtest score. The screen
  flags a candle when its high-low range is at least 10% of open and its
  open-close body is at most 50% of that range. Flagged candles stay visible in
  raw history, while affected training/evaluation windows are omitted and
  counted. The 60-month rerun flagged 21 candles.
- **Phase 2 — history window:** completed 87 symbol/window runs (29 symbols
  times three history lengths), with zero failures. Each setting was compared
  using the exact shared symbol/origin/target pairs: 6,915 next-day and 6,467
  five-session pairs, from 2024-06-05 through 2026-03-04. The fixed
  14-month train / 3-month test / 6-month advance schedule was unchanged.
- **Phase 2 result:** the technical model did not beat no-change MAPE at any
  history length or horizon. Its directional accuracy ranged from 50.11% to
  50.15% next day and 49.93% to 50.49% for five sessions; all remain below
  the 55% preview gate. The 120-month setting gave no meaningful improvement over
  60 months. Retain 60 months as the default; this is not a claim that it is
  optimal.

| Horizon | History | Samples | Technical MAPE | Statistical MAPE | No-change MAPE | Technical direction | Technical interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next day | 36 months | 6,915 | 1.1357% | 1.0234% | 1.0218% | 50.11% | 95.86% |
| Next day | 60 months | 6,915 | 1.1275% | 1.0228% | 1.0218% | 50.15% | 95.66% |
| Next day | 120 months | 6,915 | 1.1274% | 1.0230% | 1.0218% | 50.15% | 96.91% |
| Next 5 sessions | 36 months | 6,467 | 2.9592% | 2.4397% | 2.4269% | 49.93% | 94.73% |
| Next 5 sessions | 60 months | 6,467 | 2.9505% | 2.4347% | 2.4269% | 50.49% | 94.94% |
| Next 5 sessions | 120 months | 6,467 | 2.9524% | 2.4381% | 2.4269% | 50.35% | 96.37% |

Lower MAPE is better; neither the technical nor statistical estimate beats
no-change in this matched-date comparison. Full-precision metrics and per-stock
breakdowns are in the linked results and improvement plan.
- **Phase 3, experiment 1 — OHLC features:** compared the 12-feature
  close-only control with a five-feature OHLC candidate (intraday range, candle
  body return, close location in range, overnight gap, and 20-session mean
  range). The same 60-month history, 29 stocks, action adjustments, quality
  screen, folds and matched target dates were used. All 58 model runs completed;
  the source OHLC fields were available for all benchmark observations. The
  matched sample contained 13,997 next-day and 13,089 five-session pairs
  (2022-06-06 through 2026-03-04).

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | OHLC candidate | 13,997 | 1.1650% | 1.0480% | 49.99% | 95.99% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | OHLC candidate | 13,089 | 2.9784% | 2.4372% | 50.00% | 95.70% |

The candidate was lower-MAPE than close-only for 16/29 stocks at each horizon,
but neither model beat no-change for any symbol (0/29); direction remained
near 50% and declined slightly with OHLC. Decision: do not adopt OHLC features
in production. Its small five-session gain does not consistently improve
overall forecast quality, is not a prospective holdout result, and does not
make the preview criteria pass. An internal benchmark-only switch exists to
reproduce this experiment; the public forecast parameters and default model
remain close-only.
- Experiment outputs: [aggregate metrics](../../results/forecast-feature-ablation-comparison.csv),
  [per-symbol results](../../results/forecast-feature-ablation-by-symbol.csv),
  [feature/data eligibility](../../results/forecast-feature-ablation-eligibility.csv),
  [readable chart](../../results/forecast-feature-ablation-comparison.svg).
- **Phase 3, experiment 2 — NIFTYBEES market context:** added four causal
  features from same-date and earlier NIFTYBEES closes (one-, five-, and
  20-session returns plus 20-session return volatility). The proxy supplied
  1,239 sessions from 2021-04-05 through 2026-04-02; all 58 model runs
  completed, with no unavailable market-feature rows. The same 60-month
  history, 29 symbols, corporate-action handling, reversal screen, 14/3/6
  folds, cutoff, baselines and matched forecast origins were used. A causality
  test verifies later proxy changes do not alter earlier frozen-fold forecasts.

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | Market-context candidate | 13,997 | 1.1681% | 1.0480% | 49.73% | 95.89% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | Market-context candidate | 13,089 | 3.0264% | 2.4372% | 49.70% | 96.46% |

  Market context increased pooled MAPE by 0.0024 percentage points next day
  and 0.0294 points for five sessions; it had lower MAPE than close-only for
  13/29 symbols at each horizon. Neither feature set beat
  no-change for any symbol, and the market model's pooled directional accuracy
  declined at both horizons and remained below 55%. Do not adopt it in
  production or relax any preview/Kite gate. The experiment uses only an
  internal benchmark switch; no public forecast parameter or trading behavior
  changed.
- Experiment outputs: [aggregate metrics](../../results/forecast-market-context-ablation-comparison.csv),
  [per-symbol results](../../results/forecast-market-context-ablation-by-symbol.csv),
  [feature availability and eligibility](../../results/forecast-market-context-ablation-eligibility.csv),
  [readable chart](../../results/forecast-market-context-ablation-comparison.svg).
- **Phase 3, experiment 3 — close-only volatility and path structure:** added
  five causal features from close-to-close returns only: 5-session and
  60-session realized volatility, 20-session downside volatility, 20-session
  lag-one return autocorrelation, and 20-session trend efficiency. The longer
  lookback excluded one initial training row per scored fold; it excluded no
  test rows, and the comparison retained identical origins and targets. All 58
  model runs completed with zero errors using the same history, cohort,
  corporate-action handling, reversal screen, fold schedule, baselines and
  cutoff. The future-close invariance test passed.

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | Advanced technical candidate | 13,997 | 1.1808% | 1.0480% | 49.63% | 96.02% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | Advanced technical candidate | 13,089 | 3.0413% | 2.4372% | 50.44% | 95.77% |

  The candidate had higher pooled MAPE than close-only at both horizons and
  beat close-only MAPE for only 8/29 stocks next day and 10/29 for five
  sessions. Next-day direction accuracy declined; five-session accuracy
  improved only 0.19 percentage points and remained near chance. No symbol or
  pooled horizon beat no-change. **Decision:** reject these features for
  production; preserve the close-only model and all preview/Kite gates.
- Experiment outputs: [aggregate metrics](../../results/forecast-advanced-technical-ablation-comparison.csv),
  [per-symbol results](../../results/forecast-advanced-technical-ablation-by-symbol.csv),
  [eligibility and missing-feature counts](../../results/forecast-advanced-technical-ablation-eligibility.csv),
  [readable chart](../../results/forecast-advanced-technical-ablation-comparison.svg).
- **Phase 3, experiment 4 — causal relative volume:** compared close-only with
  `log(current quantity / median prior 20-session quantity)`. No future
  action was applied to an earlier origin; the ex-date and following 19
  observations were withheld to prevent mixing share units. All 58 runs
  completed. Matched data covered all 29 symbols and 13,913 next-day /
  13,010 five-session pairs. Candidate MAPE was 1.1662% next day and 2.9919%
  for five sessions, versus close-only 1.1650% / 2.9979% and no-change
  1.0477% / 2.4383%. Candidate direction was 49.97% / 50.30%, slightly below
  close-only at both horizons. It beat close-only MAPE for 13/29 and 17/29
  symbols, but beat no-change for 0/29. **Decision:** reject for production;
  keep benchmark-only. Production model, forecast API and Kite HOLD remain
  unchanged.
- Experiment outputs: [aggregate metrics](../../results/forecast-volume-ablation-comparison.csv),
  [per-symbol results](../../results/forecast-volume-ablation-by-symbol.csv),
  [eligibility](../../results/forecast-volume-ablation-eligibility.csv),
  [readable chart](../../results/forecast-volume-ablation-comparison.svg).
- At the user's request, the benchmark chart was rewritten in plain language.
  Forecast metrics, common-date comparisons, symbol-level values, eligibility,
  adjustment details and holdout status are published in `results/`.
- Historical prices and forecasts are not guaranteed to be split- and
  dividend-adjusted at every source. The current provider adjustment applies
  recognized split/bonus factors, not dividends. ADANIENT's noted moves have no
  matching split/bonus record. Treat these as documented data limitations.
- Corrected final Phase 1 results also failed the no-change comparison:
  technical MAPE was 1.1320% next day and 2.8892% for five sessions, versus
  1.0194% and 2.3503% no-change; directional accuracy was 50.36% and 50.43%.
  These pooled metrics and the Phase 2 matched-date comparison use different
  run specifications; do not compare them as if they were a single sample.
- **Kite service:** start locally with `npm run start:kite`; detailed setup and
  API usage are in [Kite setup](../kite/README.md). It provides authenticated
  read-only account endpoints and forecast-gated previews only. The preview
  stays blocked unless side/signal/direction match, backtest beats no-change,
  there are at least 30 samples and 55% directional accuracy, forecast age is
  under 15 minutes, close age is at most 10 calendar days, context risk is
  clear, and notional is at most INR 10,000. Eligible results are still
  `previewOnly` with `mode: HOLD` and `tradingEnabled: false`; this service does
  not place broker orders. The user reported successful Kite login/account
  reads; public deployment decisions remain open.

The 2026-04-06 through 2026-10-06 historical period was examined in prior
Phase 1 work, so it is not an untouched holdout. The reserved prospective
period is 2026-10-07 through 2027-04-06 (exclusive end in the export is
2027-04-07). It has not been fetched or scored. Keep it out of model/feature
selection until it is genuinely available for prospective evaluation.

### Next work, in order

1. **Continue forecast-only evaluation.** OHLC, broad-market context,
   close-only volatility/path structure, and relative-volume features did not
   qualify for production. Retain the 60-month close-only model as control,
   with the same 29-symbol cohort, 14/3/6 schedule and both baselines. Keep the
   prospective holdout reserved.
2. **Use matched, chronological evaluation.** Compare control and candidate
   only on identical eligible symbols, horizons, forecast origins and targets.
   Report pooled and per-symbol/per-fold MAPE/MAE, directional accuracy,
   interval calibration/coverage, sample counts and exclusions. Freeze
   candidate choices using pre-holdout development data; do not inspect or tune
   against the reserved prospective period.
3. **Keep or reject with a predeclared rule.** Do not call a feature an
   improvement unless it beats the appropriate baseline on untouched
   chronological data and gains repeat across symbols/periods without harmful
   regressions. Keep forecast uncertainty and the 55% preview gate unchanged.
4. **Phase 4 — sentiment only after archive audit.** Check that the local
   headline archive has point-in-time publication timestamps, sufficient
   symbol/date coverage, deduplication and no future information. Compare
   technical-only versus technical-plus-FinBERT on the same samples. Sentiment
   polarity is not a probability of the stock rising.
5. **Phase 5 — paper-trading evaluation only if a forecast candidate survives.**
   Define rules before scoring and model brokerage/statutory charges, spread,
   slippage, liquidity, turnover, sizing and drawdown. Compare with simple
   alternatives and no trade. This is separate from forecast accuracy and does
   not authorize live orders.
6. **Keep Kite paused and HOLD enforced.** Public deployment still needs
   explicit hosting/domain and identity decisions, secure persistent
   per-user-session design, and operational controls. Do not enable order
   placement; any future change to HOLD requires explicit user authorization
   and separate safety review.

The current evidence does not show that the forecast is ready to drive stock
buy/sell decisions. First establish reproducible forecast gains; only then
evaluate whether a cost-aware paper strategy has decision value. Never treat a
model's `up`/`down` estimate alone as a trading instruction.

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

- `symbol` is the stock identifier passed to the forecast API (for example,
  `TCS`); `horizon` chooses the prediction window. The API does not infer a
  symbol from a company name in natural language.
- `horizon`: `next_day` (default), `week` (five sessions), or `custom`.
- Custom mode requires ISO string `start_date` and `end_date`, ordered and at
  most seven calendar days inclusive. Weekends are skipped; holiday dates and
  session offsets are approximate. Weekend-only ranges are rejected.
- For custom forecasts, history starts three calendar years before the start
  date and ends the day before it. Prices inside/after the forecast range are
  excluded, including for historical requests.
- Other horizons anchor the selected history window (default 60 months) to the
  current India date. `historyMonths` can be selected from 36 to 120; this
  changes total evaluation/calibration history, not the final LightGBM rolling
  fit length. At least 600 valid closes and coverage near the start are
  required. History more than ten calendar days old relative to its cutoff is
  rejected.
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

- Five years of actual NSE daily closes by default (`historyMonths: 60`, valid
  range 36–120); this supplies more walk-forward folds/residual history. The
  final LightGBM fit still uses the latest 14 months.
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
- The configured NSE forecast path applies available split/bonus adjustment
  records causally. Dividends are not adjusted. Unexplained large moves are
  reported as data-quality limitations; quality-screened candles are not
  silently rewritten or bridged over.
- Earlier predictions and observed outcomes are retained for evaluation and
  residual calibration. Predicted prices are NEVER substituted for true labels.
  This is the scientific correction to the user's initial suggestion of
  retraining with forecast data.
- Refit on the latest 14 months for the requested future forecast. Horizons are
  predicted directly, not by generating artificial future candles.
- Models are freshly fitted per request; no persisted stock-model weights or
  incremental booster continuation are implemented.

`model.training.folds` reports boundaries and row counts.
`model.training.outOfSampleForecasts` retains origin/target dates, LightGBM and
same-origin statistical-baseline predicted log returns, and actual log returns.
`backtest` summarizes the final requested horizon. The fixed 29-symbol Phase 1
benchmark command is `npm run forecast:benchmark`; reports are saved under
`node_modules/.cache/forecast-benchmark`. The separate
`npm run forecast:benchmark:gaps` diagnostic uses a three-month advance only
for benchmarking; default production forecasts retain the six-month advance.
The 36/60/120-month comparison uses `npm run forecast:history-windows` and
`npm run forecast:history-windows:export`.

Published benchmark artifacts:

- [Phase 1 aggregate metrics](../../results/forecast-benchmark-comparison.csv)
- [Phase 1 readable chart](../../results/forecast-benchmark-comparison.svg)
- [Phase 2 common-date comparison](../../results/forecast-history-window-comparison.csv)
- [Phase 2 readable chart](../../results/forecast-history-window-comparison.svg)
- [Phase 2 per-symbol metrics](../../results/forecast-history-window-by-symbol.csv)
- [Phase 2 eligibility and fold counts](../../results/forecast-history-window-eligibility.csv)
- [Phase 3 OHLC ablation results](../../results/forecast-feature-ablation-comparison.csv)
- [Phase 3 market-context ablation results](../../results/forecast-market-context-ablation-comparison.csv)
- [Phase 3 advanced technical ablation results](../../results/forecast-advanced-technical-ablation-comparison.csv)
- [Phase 3 volume ablation results](../../results/forecast-volume-ablation-comparison.csv)
- [Phase 3 volume per-symbol results](../../results/forecast-volume-ablation-by-symbol.csv)
- [Phase 3 volume feature eligibility](../../results/forecast-volume-ablation-eligibility.csv)
- [Phase 3 volume comparison chart](../../results/forecast-volume-ablation-comparison.svg)
- [Phase 3 prior-fold shrinkage comparison](../../results/forecast-prediction-shrinkage-comparison.csv)
- [Phase 3 prior-fold shrinkage by fold](../../results/forecast-prediction-shrinkage-by-fold.csv)
- [Phase 3 prior-fold shrinkage readable chart](../../results/forecast-prediction-shrinkage-comparison.svg)
- [Probability-target aggregate audit](../../results/forecast-probability-target-audit.csv)
- [Probability-target per-fold audit](../../results/forecast-probability-target-audit-by-fold.csv)
- [Holdout status](../../results/forecast-final-holdout.csv)
- [Full methodology and outcomes](FORECAST_IMPROVEMENT_PLAN.md)

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
- The 2026-10-07 local-data check found no configured or discoverable archive,
  so real archive coverage, duplicate rate, symbol relevance, publication
  provenance and history depth remain unmeasured. The current GLOBAL schema
  cannot attribute each article to a stock; timezone-valid `publishedAt` alone
  does not prove the saved title is the version available at that time. See
  the [sentiment archive audit checkpoint](../checkpoints/2026-10-07-phase4-sentiment-archive-audit.md).

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
| Forecast benchmark runner/exporters | [../../scripts/forecast/benchmark.ts](../../scripts/forecast/benchmark.ts), [../../scripts/forecast/history-window-benchmark.ts](../../scripts/forecast/history-window-benchmark.ts), [../../scripts/forecast/export-history-window-results.ts](../../scripts/forecast/export-history-window-results.ts), [../../scripts/forecast/feature-ablation.ts](../../scripts/forecast/feature-ablation.ts), [../../scripts/forecast/export-feature-ablation-results.ts](../../scripts/forecast/export-feature-ablation-results.ts), [../../scripts/forecast/market-context-ablation.ts](../../scripts/forecast/market-context-ablation.ts), [../../scripts/forecast/export-market-context-ablation-results.ts](../../scripts/forecast/export-market-context-ablation-results.ts), [../../scripts/forecast/advanced-technical-ablation.ts](../../scripts/forecast/advanced-technical-ablation.ts), [../../scripts/forecast/export-advanced-technical-ablation-results.ts](../../scripts/forecast/export-advanced-technical-ablation-results.ts) |
| Kite core and HTTP server | [../../src/kite/](../../src/kite/), [../../apps/kite/](../../apps/kite/) |
| Kite setup, gates and endpoints | [../kite/README.md](../kite/README.md), [../kite/CONTEXT.md](../kite/CONTEXT.md) |
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

Latest code verification after Phase 3 experiment 4: `npm run test:forecast`
passed 71 tests across seven files; `npm run test:kite` passed 44 tests;
`npm run typecheck:kite`, strict checks for the volume ablation and
`npm run build` passed. The current Phase 4 archive work was read-only and
documentation-only; no sentiment code or forecast behavior changed. Whole-suite
tests include live exchange calls; don't confuse network availability failures
with unit failures. ESLint has previously been blocked by the installed
ESLint 9 expecting a flat config absent from the repository.

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
- The Phase 2 comparison confirms that extending history to 120 months does not
  solve the baseline-performance or direction-accuracy problem.
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

The source proposal [feedtstock2forecastmodel.md](feedtstock2forecastmodel.md)
is a roadmap, not a feature checklist. Before any new candidate, check the
status table at its top and the benchmark decision in
[the forecast improvement plan](FORECAST_IMPROVEMENT_PLAN.md). The next
forecast-only task is a direction/threshold probability candidate compared
against the prior-only prevalence baseline; do not resume trading or order
execution.
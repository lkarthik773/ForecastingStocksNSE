# Forecasting and Training Handoff

**Snapshot date:** 2026-10-08  
**Purpose:** Preserve the forecasting, model-training, candle, indicator,
corporate-action, F&O, probability, evaluation, and validation work in this
workspace so its useful code and data contracts can be migrated into the
separate database/product-architecture workspace.

This is a working-tree handoff, not a release or a database specification.
There is no forecasting database, persisted model registry, training-job API,
or scheduled ingestion service in this project. Forecasts and research runs
currently fetch or read their inputs, calculate results in process, and emit
API responses or local artifacts. The recommendations below describe what to
preserve when the new architecture supplies durable storage.

## Executive status

- A causal, daily-bar NSE forecasting and historical walk-forward evaluation
  pipeline is implemented. The active technical model uses 12 close-derived
  features and Python LightGBM.
- Corrected historical evaluation shows that the technical model does **not**
  beat the zero-return/no-change baseline on pooled MAPE. Directional accuracy
  is about 50%, below the existing 55% preview threshold.
- Candle, market-context, advanced-technical, volume, shrinkage, F&O, and
  probability variants have been implemented and evaluated as research. None
  has been promoted to the standard forecast.
- Split/bonus adjustment and the extreme intraday-reversal quality screen are
  implemented. Dividends are not adjusted; unexplained large price moves are
  not fabricated into corporate actions.
- A benchmark-only daily probability tracker is collecting prospective
  forecasts. On 2026-10-08 it scored 87 matured probabilities from the first
  daily snapshot and captured a second snapshot containing 174 probabilities.
  This is too little data to evaluate model skill.
- Historical FinBERT inference code exists, but a suitable real news archive
  was not available or validated. Sentiment forecasting remains blocked.
- F&O archives, loaders, feature construction, validation, and paired
  experiments exist. The predeclared expanded-symbol direction criterion was
  not met. No F&O feature is part of the standard close-only model.
- No buy/sell strategy, cost-aware paper trading, order execution, or broker
  recommendation is established by these results. Kite remains in HOLD.

## Status at a glance

| Area | Status | What is available | Important boundary |
| --- | --- | --- | --- |
| NSE daily price history | Implemented | Historical OHLCV retrieval, normalization, eligibility and stale-history checks | Exchange fetch is not a durable ingestion pipeline; source revisions are not stored |
| Corporate actions | Implemented | Causal NSE bonus/split adjustment and action audit | Dividends are not adjusted; only supported split/bonus terms are transformed |
| Candle quality | Implemented | Keeps raw observations and flags extreme intraday reversals for affected-sample exclusion | A flagged candle is not claimed to be erroneous or deleted from the time series |
| Standard technical forecast | Implemented | Close-only LightGBM option, expected prices/returns, direction, intervals and walk-forward diagnostics | Default model skill did not beat no-change |
| Baseline forecast | Implemented | Statistical and no-change baselines for comparison; direct API model default is statistical baseline | Explorer's forecast default is technical; callers should explicitly choose |
| Technical indicators | Implemented | Twelve causal close-derived model features and report indicators | Indicator presence does not imply predictive value |
| OHLC/candle features | Tested; not adopted | Five causal daily-bar features and matched ablation | Internal benchmark variant only |
| NIFTYBEES market context | Tested; not adopted as a model feature | Four causal proxy features; descriptive context can also be reported | ETF proxy, not the NIFTY 50 index |
| Advanced price-path features | Tested; not adopted | Five causal volatility/path features | Research variant only |
| Volume | Audited and tested; not adopted | Five-year data audit and one causal relative-volume feature | Not in standard model |
| F&O | Implemented and tested; not adopted | NSE archive parsing, preflight, futures/options features and paired benchmarks | Data coverage and generalization remain limited |
| Probability classifier | Tested; not adopted | Historical logistic classifier and prior/neutral scoring | Does not produce production probabilities |
| Prospective probabilities | In progress | Daily capture/scoring scripts for 1- and 5-session events | Wait for 200 distinct matured origin dates; do not tune on this holdout |
| FinBERT sentiment | Implemented but blocked for real evaluation | Local headline archive loader and causal feature path | No issuer-relevant archive with point-in-time provenance was available |
| Database / persistence | Not implemented | Local CSV/JSON/SVG artifacts and ephemeral caches | Persist provenance and immutable outcomes in the new workspace |
| Trading strategy / orders | Out of scope | Forecast error evaluation only | No evidence here authorizes trading or order execution |

The feature roadmap's full 14-group status is in
[FORECAST_MODEL_ROADMAP_STATUS.md](./development/FORECAST_MODEL_ROADMAP_STATUS.md).

## Forecast execution and reusable code map

The main data path is:

1. [`NSEClient`](../src/nse/client/nse-client.ts) wires the historical-price
   API, corporate-action provider, context provider, and forecast API.
2. [`ForecastApi`](../src/forecast/forecast-api.ts) validates inputs, fetches
   historical data, normalizes dates/prices/candles, applies the configured
   corporate-action adjustment, prepares optional context/features, and
   assembles the response.
3. [`trainForecast`](../src/forecast/trained-forecast.ts) constructs
   origin-date feature vectors, generates chronological folds, trains the
   model and baselines, scores out-of-sample forecasts, estimates intervals,
   and returns training metadata and diagnostics.
4. [`rollingFolds`](../src/forecast/walk-forward.ts) defines calendar-based
   training/test windows and purges labels that would cross the boundary.
5. [`runLightGbm`](../src/forecast/lightgbm.ts) runs the official Python
   LightGBM implementation in a subprocess and returns the prediction and
   fold outputs.
6. [`scoreForecastReturns`](../src/forecast/evaluation.ts) measures model and
   no-change returns on the exact same forecast origins and targets.
7. The forecast API returns model inputs/metadata, indicator values,
   forecast points, uncertainty ranges, signal and evaluation summaries.

Important reusable pure or mostly-pure entry points:

| Function / module | Responsibility |
| --- | --- |
| `technicalFeatures` in [`trained-forecast.ts`](../src/forecast/trained-forecast.ts) | Calculate the standard 12-feature vector and current indicator values from closes |
| `ohlcFeatures` in [`trained-forecast.ts`](../src/forecast/trained-forecast.ts) | Calculate the five completed-candle features |
| `marketContextFeatures` in [`trained-forecast.ts`](../src/forecast/trained-forecast.ts) | Calculate exact-date NIFTYBEES returns and volatility |
| `advancedTechnicalFeatures` in [`trained-forecast.ts`](../src/forecast/trained-forecast.ts) | Calculate volatility, downside risk, autocorrelation and trend-efficiency features |
| `relativeVolumeFeature` in [`trained-forecast.ts`](../src/forecast/trained-forecast.ts) | Calculate log current volume versus prior-20-session median, with ex-date warmup |
| `calculateFnoFeatures` in [`fno-features.ts`](../src/forecast/fno-features.ts) | Build the 28 archive-derived F&O candidate features |
| `calculateFuturesFeatures` in [`futures-features.ts`](../src/forecast/futures-features.ts) | Build ten historical futures-only features |
| `loadHistoricalFnoArchive` / `inspectHistoricalFnoArchive` in [`fno-archive.ts`](../src/forecast/fno-archive.ts) | Parse, aggregate and validate local NSE archives |
| `forecastEventOccurred`, `priorEventProbability`, `scoreBinaryProbabilities` in [`target-outcomes.ts`](../src/forecast/target-outcomes.ts) | Define threshold labels and score binary probabilities |
| `fitLogisticClassifier` in [`probability-classifier.ts`](../src/forecast/probability-classifier.ts) | Fit the benchmark-only binary logistic classifier |
| `calibratePredictionShrinkage` in [`prediction-shrinkage.ts`](../src/forecast/prediction-shrinkage.ts) | Select a causal, prior-fold shrinkage factor |

The package also contains [`corporate-actions.ts`](../src/forecast/corporate-actions.ts),
[`forecast-context-api.ts`](../src/forecast/forecast-context-api.ts),
[`finbert.ts`](../src/forecast/finbert.ts),
[`finbert-history.ts`](../src/forecast/finbert-history.ts),
[`futures-data-fetcher.ts`](../src/forecast/futures-data-fetcher.ts), and
[`fno-data-fetcher.ts`](../src/forecast/fno-data-fetcher.ts).

### Current API contract

- Horizons are `next_day` (one session), `week` (five sessions), or `custom`.
  Custom date ranges are bounded to seven calendar days; the API excludes
  prices from and after the requested forecast range.
- History defaults to 60 months and can be configured from 36 to 120 months.
  The model requires at least 600 valid daily closes, coverage near the
  requested start, and recent-enough data.
- Supported model names include `baseline`, `technical`,
  `technical_finbert`, `technical_fno`, and `technical_futures`. These names
  expose selectable paths; they do not mean every path is validated for
  production.
- Context can be `auto` or `off`; `auto` can use NIFTYBEES. Sentiment is
  optional and local-only.
- A result can include history/data-quality metadata, current technical
  indicators, expected price/change, direction, 95% prediction range, signal,
  model/training details, historical backtest metrics, context and warnings.
- Explorer and library defaults differ: the Explorer selects `technical`,
  while a direct library call that omits `model` selects `baseline`.
- The point forecast or `up`/`down` direction is not a calibrated probability
  or a trading recommendation.

See the API types and validation in
[`forecast-api.ts`](../src/forecast/forecast-api.ts) and the existing operating
context in [CONTEXT.md](./development/CONTEXT.md).

## Price candles, data quality and corporate actions

### Daily candle input and normalization

The standard historical source is the NSE equity daily history. Rows can
provide date, symbol, series, open, high, low, close, and traded quantity.
The normalizer handles the current NSE field names and older uppercase aliases,
validates the requested symbol and `EQ` series, parses dates including
`DD-Mon-YYYY`, discards invalid/out-of-range rows, and reports data-quality
counts. A historical date is the exchange session date; in integrations,
preserve it as a date rather than deriving it from a UTC-midnight timestamp.

The standard LightGBM feature vector uses closes only. OHLC and volume remain
available to data-quality logic and separate experiments. Do not confuse
“the feed contains OHLCV” with “the standard model trains on OHLCV.”

### Corporate-action handling

- Recognized NSE bonus ratios and face-value split terms are converted to
  share-count factors.
- For a factor effective on ex-date `d`, historical OHLC before `d` is divided
  by the factor; values on/after `d` remain unchanged. Same-date factors
  multiply.
- A bonus `a:b` uses `1 + a/b`; a face-value split uses old face value divided
  by new face value.
- Adjusted history is used consistently for features, labels, baselines,
  residual calibration, and evaluation. A return crossing the action is not
  treated as a mechanical share-count move.
- Dividends are not adjusted. Provider failures and unparseable split/bonus
  terms are surfaced rather than silently assumed away.
- A date parser defect had skipped some NSE dates such as `01-Oct-2025`; it was
  fixed and the affected Phase 1-3 benchmarks were regenerated. Use the
  corrected data and metrics below, not superseded pre-fix checkpoint values.
- For a durable system, retain both original price rows and action records;
  derive or version adjusted values instead of destructively overwriting raw
  prices.

The correction and authoritative notes are in
[the 2026-10-07 corporate-action checkpoint](./checkpoints/2026-10-07-corporate-action-date-fix-volume-audit.md).

### Extreme intraday-reversal screen

Keep and report, but mark for sample exclusion, a candle when both conditions
hold:

```text
(high - low) / open >= 10%
abs(close - open) / (high - low) <= 50%
```

The time-series row is retained so deleting it does not shift session indexes
or accidentally redefine multi-session labels. A sample is excluded if its
60-session technical lookback or target window touches a flagged candle; a
flagged latest candle blocks a current forecast. The corrected 60-month
benchmark flagged 21 candles. A flag means “quality rule applied,” not “bad
market price.”

### Volume history audit

The five-year audit covered 29 symbols, 1,239 daily rows per symbol, and
35,931 rows total (2021-04-05 through 2026-04-02). The NSE quantity field was
present, positive, and valid on every audited row; dates were unique and
closes/equity classifications were valid. Eight ex-date groups covered nine
split/bonus actions. Short-window action-restated volume ratios varied and do
not prove the feed's historical share-unit convention or predictive value.

## Standard indicators and model features

The active technical model uses these twelve causal inputs, calculated from
close values available at the forecast origin:

1. One-session log return.
2. Five-session log return.
3. Log price / SMA20.
4. Log price / SMA50.
5. Log EMA12 / EMA26.
6. RSI14 / 100.
7. MACD histogram / current price.
8. Bollinger %B (20 sessions, two standard deviations).
9. Bollinger bandwidth / middle band.
10. Ten-session log rate of change.
11. Twenty-session log rate of change.
12. Twenty-session realized log-return volatility.

Current report indicator values include RSI14, EMA12/26, MACD histogram,
SMA20/50, Bollinger %B/bandwidth, ROC10/20, and volatility20. The shared
technical-indicator implementation requires at least 60 valid positive
closes. The Bollinger and longer ROC inputs were added and tested; their
presence did not establish improved out-of-sample forecast accuracy.

No active model claim is made for VWAP, intraday time-of-day, support/resistance,
validated sector features, ATR, full trend-stack signals, or 52-week position.
Daily bars cannot support true intraday VWAP or time-of-day features.

## Training and evaluation protocol

### Model and labels

- The technical regressor is Python LightGBM 4.6.0 invoked through a Node
  subprocess. The recorded configuration is 100 trees, 15 leaves, max depth 4,
  learning rate 0.05, minimum 20 child samples, seed 42, and two CPU threads.
- Labels are realized log returns over the requested future session horizon.
  Horizons are predicted directly; the model does not create synthetic future
  candles to feed back as labels.
- The historical evaluation horizons are one and five sessions.
- The point-in-time statistical baseline and zero-return/no-change baseline
  are evaluated on the same origin/target pairs as LightGBM.

### Walk-forward boundaries and leakage controls

- Default research/production training window: 14 calendar months.
- Each fold tests the following three calendar months; the default schedule
  advances six months, leaving three-month intervals between scored test
  windows. These gaps are not continuous evaluation coverage.
- A separate three-month-advance diagnostic fills those periods but changes
  refit cadence. It is not an independent holdout and does not replace the
  default.
- Fold models are frozen during each test block. Only completed labels strictly
  before a training cutoff can enter training; labels crossing a boundary are
  purged.
- Feature vectors for an origin use information available at that origin.
  Future data is excluded in tests for the candidate features. A subsequent
  corporate action is not applied early to a volume feature.
- The requested final model fit uses the latest available training window.
  Weights are fitted per request; persistent model weights or incremental
  booster continuation are not implemented.
- Intervals use earlier out-of-sample residual errors (95th-percentile
  absolute-error radius). Their observed coverage is a diagnostic, not a
  guarantee of future 95% calibration.

### Corrected 29-symbol default benchmark

The fixed NSE equity cohort contains 29 symbols; `TATAMOTORS` was excluded at
the user's direction after the endpoint returned a different instrument.
Symbols were not removed for poor scores. The corrected 60-month,
14/3/6-month run completed all 29 symbols:

| Horizon | Model | Paired samples | MAPE | No-change MAPE | Direction |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | LightGBM technical | 14,044 | 1.1320% | 1.0194% | 50.36% |
| Next day | Statistical baseline | 14,044 | 1.0201% | 1.0194% | 49.67% |
| Five sessions | LightGBM technical | 13,136 | 2.8892% | 2.3503% | 50.43% |
| Five sessions | Statistical baseline | 13,136 | 2.3543% | 2.3503% | 50.56% |

The technical model and statistical baseline both trail no-change on pooled
MAPE. The technical model is below the 55% preview threshold at both horizons.
The 95% empirical interval coverage was 95.05% (12,333 evaluated intervals)
next day and 94.54% (11,541 intervals) for five sessions; this does not prove
prospective calibration.

The corrected separate 14/3/3 diagnostic scored 25,885 next-day and 24,154
five-session pairs. Its technical MAPE (1.1649% and 2.9199%) also trailed
no-change (1.0554% and 2.4244%). It is a schedule sensitivity check, not an
independent validation set.

See [the corrected benchmark table and artifacts](./development/FORECAST_IMPROVEMENT_PLAN.md)
and [benchmark CSV/SVG outputs](../results).

## Tested forecast variants and measured outcomes

All comparisons below are research results on historical out-of-sample dates.
“Not adopted” means the standard close-only model remains unchanged. MAPE
values are percentages; differences between two MAPE values are percentage
points.

### Candle / OHLC features

Candidate inputs from completed daily bars:

- intraday high-low range / close;
- log close/open body return;
- close location within the day's range;
- overnight log opening gap from prior close;
- 20-session mean daily range / close.

The corrected matched-date experiment included 29 symbols and 13,997 next-day
/ 13,089 five-session pairs. Close-only MAPE was 1.1657% / 2.9970% versus
OHLC MAPE 1.1650% / 2.9784%; no-change was 1.0480% / 2.4372%. OHLC direction
was 49.99% / 50.00% (close-only 50.33% / 50.39%). Neither model beat
no-change; do not add OHLC features to the standard model based on the small
five-session MAPE difference.

### Market context

The tested context was NIFTYBEES, with exact-date same-session return,
five-session return, twenty-session return, and twenty-session return
volatility. It had 1,239 proxy sessions (2021-04-05 through 2026-04-02) and no
missing eligible matched-date proxy observations.

| Horizon | Close-only MAPE | Context MAPE | No-change MAPE | Context direction |
| --- | ---: | ---: | ---: | ---: |
| Next day | 1.1657% | 1.1681% | 1.0480% | 49.73% |
| Five sessions | 2.9970% | 3.0264% | 2.4372% | 49.70% |

Context worsened pooled MAPE and direction. It remains available as descriptive
proxy context; it is not an adopted predictive feature or the official NIFTY
index.

### Advanced technical / volatility and path features

The candidate added five causal close-only values: 5-session and 60-session
realized volatility, 20-session downside volatility, 20-session lag-one return
autocorrelation, and 20-session trend efficiency. The common-date sample was
13,997 next-day and 13,089 five-session pairs.

| Horizon | Close-only MAPE | Advanced MAPE | No-change MAPE | Advanced direction |
| --- | ---: | ---: | ---: | ---: |
| Next day | 1.1657% | 1.1808% | 1.0480% | 49.63% |
| Five sessions | 2.9970% | 3.0413% | 2.4372% | 50.44% |

It increased MAPE at both horizons and did not beat no-change. Keep
benchmark-only.

### Volume candidate

The one feature was
`log(current daily quantity / median(quantity over the prior 20 sessions))`.
It uses only prior observed quantities for its denominator. The feature is
unavailable on an action ex-date and the next 19 observed sessions, preventing
pre-ex-date use of a new share-unit regime.

| Horizon | Close-only MAPE | Volume MAPE | No-change MAPE | Volume direction |
| --- | ---: | ---: | ---: | ---: |
| Next day | 1.1650% | 1.1662% | 1.0477% | 49.97% |
| Five sessions | 2.9979% | 2.9919% | 2.4383% | 50.30% |

This small five-session difference is not persuasive; the candidate still
trails no-change and direction did not improve. Keep volume out of the standard
model.

### Training-window comparisons

The earlier common-date 36/60/120-month comparison did not beat no-change at
any window or horizon. Direction stayed near 50%; extending to 120 months
showed no meaningful improvement over 60 months.

A later controlled 8/14/20-month comparison held the 29-symbol cohort,
close-only features, three-month tests, six-month advances and identical
forecast origins constant. The 20-month window reduced MAPE versus 14 months,
but still trailed no-change and produced no conclusive direction improvement:

| Horizon | Shared pairs | 8-month MAPE / direction | 14-month MAPE / direction | 20-month MAPE / direction | No-change MAPE |
| --- | ---: | ---: | ---: | ---: | ---: |
| One session | 11,957 | 1.1481% / 50.36% | 1.1155% / 50.20% | 1.0995% / 50.28% | 1.0170% |
| Five sessions | 11,130 | 2.9519% / 51.05% | 2.8420% / 50.56% | 2.7623% / 50.64% | 2.3775% |

The paired 20-session block-bootstrap MAPE changes for 20 versus 14 months
were -0.0160 pp (95% interval [-0.0259, -0.0069]) at one session and -0.0797
pp ([-0.1266, -0.0250]) at five sessions. Direction intervals included zero.
Retain the 14-month setting unless a new untouched validation justifies a
change; do not select a production model using this comparison holdout.

### Prior-fold prediction shrinkage

A cohort-wide factor from 0.0 to 1.0 (steps of 0.1) shrank LightGBM log-return
predictions toward zero. Each fold's factor was selected only from earlier
out-of-sample predictions with matured targets; fewer than 100 prior examples
forced factor zero. It was zero for most folds and never exceeded 0.1.

For the 14/3/6 schedule, shrinkage MAPE was 1.0199% next day and 2.3503% for
five sessions, versus no-change 1.0194% and 2.3503%. It did not beat
no-change; direction collapsed toward zero. The apparent error reduction
versus LightGBM mostly suppresses the learned estimate back to no-change.

### Historical decision: no feature or window promoted

The corrected broad benchmark and these ablations show why the reusable
training/evaluation method is more valuable than assuming a candidate indicator
helps. All standard production behavior, preview gates, and Kite HOLD
behavior remained unchanged.

## F&O and futures work

### What is implemented

- [`fno-archive.ts`](../src/forecast/fno-archive.ts) accepts the inspected
  legacy and newer NSE archive layouts, rejects conflicting duplicate contract
  rows, aggregates options and active futures, and supports alternative
  options aggregation for ablations.
- [`fno-data-fetcher.ts`](../src/forecast/fno-data-fetcher.ts) and
  [`futures-data-fetcher.ts`](../src/forecast/futures-data-fetcher.ts) prepare
  historical observations and eligibility for benchmark/training code.
- [`validate-fno-archives.ts`](../scripts/forecast/validate-fno-archives.ts)
  runs archive schema, symbol, date coverage, spot overlap, missing session,
  and conflicting-contract checks.
- The F&O model candidate has 28 features:
  - Premium: `futuresPremiumPct`, `premiumTrendCh1Day`,
    `premiumTrendCh5Day`, `premiumSma5`.
  - Open interest: `totalOIChangePct`, `callOIChangePct`, `putOIChangePct`,
    `totalOISma5`, `totalOISma20`.
  - Put/call: `putCallRatio`, `putCallRatioTrend`, `putCallVolumeRatio`.
  - Price/open-interest combinations: `priceUpOIUp`, `priceUpOIDown`,
    `priceDownOIUp`, `priceDownOIDown`.
  - Extreme/skew: `callOIExtreme`, `putOIExtreme`, `oiSkewFavorsCall`,
    `oiSkewFavorsPut`.
  - Relative volume: `futuresVolumeRelative`, `spotVolumeRelative`,
    `callVolumeRelative`, `putVolumeRelative`, `volumeConvergence`.
  - OI strength: `oiMomentum`, `callPutStrength`, `oiBias`.
- The futures-only feature path has ten values: futures premium level and
  1-/5-session changes; futures OI 1-/5-session changes and 5-vs-20 momentum;
  and four price-up/down × OI-up/down indicators. It needs 21 matched
  observations. It uses nearest unexpired futures price and OI aggregated
  across active futures expiries; the futures-only path does not need options.
- Raw archive CSVs remain local under `downloads/`; do not assume they are
  committed or copy them without an explicit data-handling decision.

### F&O evaluation results

The initial five-symbol benchmark and its nine-variant ablation used the same
3,700 five-session pairs (740 per symbol):

| Variant | Direction | Change vs technical | MAPE | MAPE change |
| --- | ---: | ---: | ---: | ---: |
| Technical baseline | 50.41% | — | 2.955% | — |
| Historical futures | 51.00% | +0.59 pp | 2.971% | +0.016 pp |
| All archive F&O | 50.27% | -0.14 pp | 2.858% | -0.096 pp |
| Archive futures group only | 49.38% | -1.03 pp | 2.886% | -0.069 pp |
| Options group only | 51.14% | +0.73 pp | 2.885% | -0.069 pp |
| All F&O without PCR | 50.41% | 0.00 pp | 2.864% | -0.091 pp |
| All F&O without options volume | 51.00% | +0.59 pp | 2.863% | -0.092 pp |
| All F&O without futures premium | 50.30% | -0.11 pp | 2.859% | -0.096 pp |
| All F&O without futures OI/price-OI signals | 49.65% | -0.76 pp | 2.876% | -0.079 pp |

The result was mixed: archive F&O slightly reduced MAPE overall while mean
direction did not improve; no variant was a consistent winner across all five
symbols.

The extended 14-variant follow-up tested shorter lookbacks and front-expiry
options aggregations. A 3/10-day OI variant lowered MAPE on aggregate but
direction changes were inconsistent across three chronological slices.
Front-expiry and front-expiry-ATM variants also did not establish a stable
directional gain.

The more informative expanded-symbol comparison used 13 validated archives
and 9,502 matched symbol-origin pairs (five-session horizon). Its predeclared
primary comparison was options-only versus technical on eight added symbols,
with 1,648 pairs:

- Direction change: +1.33 percentage points; 95% moving-block interval
  [-0.79, +4.07] points.
- MAPE change: -0.108 percentage points; 95% interval [-0.164, -0.045].
- Five of eight symbols had positive direction changes.
- The direction interval included zero, so the predeclared success criterion
  was not met. No F&O feature was promoted.

The full current implementation status, cohort makeup, and result tables are
in [FNO_INTEGRATION_STATUS.md](./fno/FNO_INTEGRATION_STATUS.md). Earlier F&O
feature-guide tiers and predicted gains are hypotheses, not measured or
validated results.

## Probability and outcome work

### Historical probability classifier

A standardized logistic classifier was evaluated on the corrected 29-symbol
historical cohort (27,180 symbol/origin/horizon outcomes), using the same
chronological folds and close-only technical inputs. Events were:
`up` (return > 0), `gain_over_1pct` (return > +1%), and
`loss_below_minus_1pct` (return < -1%), at one- and five-session horizons.
Scores were compared with a causal earlier-outcome prior and a neutral 50%
baseline:

| Horizon / event | N | Classifier Brier | Prior Brier | Classifier log loss | Prior log loss |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 session: up | 14,044 | 0.2598 | 0.2504 | 0.7163 | 0.6940 |
| 1 session: gain > 1% | 14,044 | 0.1653 | 0.1694 | 0.5192 | 0.5206 |
| 1 session: loss < -1% | 14,044 | 0.1579 | 0.1628 | 0.5004 | 0.5055 |
| 5 sessions: up | 13,136 | 0.2788 | 0.2521 | 0.7734 | 0.6974 |
| 5 sessions: gain > 1% | 13,136 | 0.2604 | 0.2373 | 0.7384 | 0.6682 |
| 5 sessions: loss < -1% | 13,136 | 0.2498 | 0.2292 | 0.7180 | 0.6513 |

The classifier modestly improved next-day threshold-event scores, but worsened
next-day direction and all five-session events. It was not adopted. Historical
probability scoring is a separate benchmark from forecast direction or the
report's point estimates.

### Prospective probability tracker

- Each capture contains 29 symbols × three events × two horizons = 174
  probabilities. Horizons are one and five sessions.
- The capture trains the fixed close-only logistic classifier from the latest
  14-month window; there is no separate daily training command.
- As of 2026-10-08, the scorer processed 87 matured probabilities from the
  2026-10-07 snapshot; the five-session labels were still pending. It then
  captured 174 predictions for 2026-10-08.
- Run `npm run forecast:probability-score` first, then
  `npm run forecast:probability-capture` after each NSE close at/after 16:00
  IST. Do not recapture a date to overwrite it.
- The scorecard withholds paired bootstrap intervals until 200 distinct
  matured origin dates; after that it uses 20-session moving blocks and 2,000
  replicates. These are distinct dates, not symbol-level prediction counts.
- This collection is a frozen, benchmark-only evaluation. Do not tune the
  classifier on these outcomes or treat early snapshots as evidence of skill.

Follow [DAILY_RUN_TASKS.md](./development/DAILY_RUN_TASKS.md) and the saved
snapshots/scorecards under
[`results/forecast-probability-prospective/`](../results/forecast-probability-prospective).

## FinBERT / historical sentiment

The optional local path uses the ProsusAI/FinBERT model through
Transformers.js/ONNX. `loadFinBertArchive` accepts a version-1, symbol-scoped
or `GLOBAL` JSON archive, at most 2,000 titles and 5 MB, with timezone-qualified
publication timestamps. Historical features exclude articles at/after the
forecast cutoff, deduplicate exact timestamp/title pairs, aggregate the prior
three calendar days, and require at least three articles per price date and
coverage on at least 180 price dates spanning 180 calendar days.

The archive schema does not currently establish issuer relevance, article
capture time, or whether old text was edited. No real qualifying archive was
available in this workspace; no news was fetched for the audit. Therefore
there is no real-data sentiment performance result, and joint
`technical_finbert` training must not be described as validated.

See [the sentiment archive audit](./checkpoints/2026-10-07-phase4-sentiment-archive-audit.md)
and [FinBERT code](../src/forecast/finbert-history.ts).

## Artifacts, commands and recorded validation

### Main research outputs

The `results/` directory contains the exported aggregate/per-symbol/fold
CSVs, eligibility and coverage files, uncertainty outputs, snapshots, and
readable SVG charts. Important groups:

- `forecast-benchmark-*`: corrected default and gap-free evaluation, action
  and reversal audits, eligibility, and raw-versus-adjusted comparisons.
- `forecast-history-window-*`: common-date history comparisons.
- `forecast-feature-ablation-*`, `forecast-market-context-ablation-*`,
  `forecast-advanced-technical-ablation-*`, `forecast-volume-ablation-*`:
  candidate metrics and eligibility.
- `forecast-prediction-shrinkage-*`: aggregate and per-fold shrinkage results.
- `forecast-fno-ablation-*` and `fno-expanded-2026-10-07/`: five- and
  thirteen-symbol F&O results, per-symbol/time-slice results, and bootstrap
  uncertainty.
- `forecast-training-windows/`: full JSON run, scorecard, coverage and paired
  uncertainty for the 8/14/20-month run.
- `forecast-probability-classifier/` and
  `forecast-probability-prospective/`: historical classifier outputs and
  prospective snapshots/scorecards.

The dated source-of-truth documents are
[the forecast improvement plan](./development/FORECAST_IMPROVEMENT_PLAN.md),
[the 2026-10-07 development baseline](./checkpoints/2026-10-07-development-baseline.md),
and [the F&O integration status](./fno/FNO_INTEGRATION_STATUS.md). Earlier
checkpoints that explicitly say their metrics were superseded must not be used
as the corrected scorecard.

### Useful commands

| Purpose | Command |
| --- | --- |
| Build ESM and CommonJS package | `npm run build` |
| Focused forecast tests | `npm run test:forecast` |
| Full repository tests | `npm test` |
| Install local Python/LightGBM environment | `npm run setup:lightgbm` |
| Standard historical benchmark | `npm run forecast:benchmark` |
| Gap-free schedule diagnostic | `npm run forecast:benchmark:gaps` |
| Export core benchmark artifacts | `npm run forecast:benchmark:export` |
| Compare history windows | `npm run forecast:history-windows` |
| Compare OHLC/candle features | `npm run forecast:feature-ablation` |
| Compare market context | `npm run forecast:market-context-ablation` |
| Compare advanced technical features | `npm run forecast:advanced-technical-ablation` |
| Audit volume history / run volume ablation | `npm run forecast:volume-audit` / `npm run forecast:volume-ablation` |
| Run shrinkage analysis | `npm run forecast:prediction-shrinkage` |
| Run historical probability benchmark | `npm run forecast:probability-classifier` |
| Score matured daily probabilities | `npm run forecast:probability-score` |
| Capture today's probability snapshot | `npm run forecast:probability-capture` |
| Compare training windows | `npm run forecast:training-windows` |
| Validate local F&O archives | `npm run forecast:fno-validate` |
| Run F&O ablation / generalization analysis | `npm run forecast:fno-ablation` / `npm run forecast:fno-generalization` |
| Render a forecast report | `npm run forecast:report -- SYMBOL` |

Recorded focused validations from the development checkpoints include
successful package builds, strict TypeScript checks, benchmark-script checks,
future-data-invariance tests, and the following suites:

- Forecast/corporate-action tests: 70 passed in the corrected-date rerun.
- Forecast regression tests after archive integration: 79 passed.
- F&O archive/data/futures/training targeted tests: 25 passed; the later
  F&O/data/training regression run recorded 28 passed.
- Refinement-focused F&O tests: 13 passed; probability snapshot/scoring tests:
  11 passed.
- Kite tests: 44 passed; `typecheck:kite` passed.
- A historical whole-repository run recorded 168 passing and 12 failing tests;
  the extra failures were live NSE network tests returning HTTP 404, not
  forecasting/F&O unit failures.
- ESLint was not successfully run because the installed ESLint 9 expects a
  flat config while this repository has legacy `.eslintrc.js`.

These are prior recorded results, not a fresh test run for this documentation
change. Network-dependent exchange tests can vary with provider availability.

## Database migration handoff

No database engine or schema is assumed here. Preserve the domain contracts
and point-in-time provenance in the target architecture rather than directly
copying the current file/cache layout.

### Suggested durable record groups

| Record group | Minimum information to preserve | Why it matters |
| --- | --- | --- |
| Instrument / exchange symbol | Stable instrument ID, exchange, symbol, series, currency, valid-from/to mapping | Names and symbols can change; do not key all history only by display text |
| Raw daily candle | Instrument, exchange session date, raw OHLC, raw quantity, source/provider, fetched-at, source revision/hash, validation status | Supports audit/replay and prevents corrected data from silently changing old results |
| Corporate-action event | Instrument, action type, source terms, ex-date, factor/parsed terms, provider timestamps, parse/validation status | Makes adjustments reproducible and preserves raw versus adjusted history |
| Derived adjusted candle | Raw-candle reference, adjustment policy/version, action cutoff/as-of date, adjusted OHLC | Supports consistent labels/features without destructive raw-data edits |
| Raw F&O contract row | Instrument, trade date, expiry, option type/strike or futures contract, price, OI, volume, source layout/version, source file/hash | Keeps full contract-level evidence available for alternate aggregation |
| Daily F&O aggregate / feature row | Instrument/date/as-of cutoff, selected expiry/aggregation policy, source row coverage, named features, feature-code/version | Makes futures/options features comparable and replayable |
| Feature definition/version | Feature-set name, ordered feature names, lookbacks, code/config version, source dependencies | Prevents same-named but differently computed vectors being mixed |
| Forecast run / training run | Run ID, symbol/cohort, as-of time, history range, horizons, model/config, feature version, data/action snapshot IDs, software version | Reproduces each fit and separates production-like runs from experiments |
| Fold and prediction | Run/fold ID, train/test boundaries, origin date, target date, predicted return/price, baseline prediction, actual outcome when mature, quality/eligibility state | Preserves leakage-safe validation and exact paired comparisons |
| Prospective probability snapshot | Unique origin date + instrument + horizon + event + protocol/model version, generated-at, probability, training counts, source snapshot | Supports immutable daily capture and avoids duplicate/overwrite errors |
| Matured outcome / score | Prediction ID, target date, outcome value/event, maturity/scoring time, scorer version, Brier/log loss/calibration inputs | Keeps predictions distinct from later-observed truth and permits rescoring |
| Experiment / result artifact | Predeclared comparison, cohort, schedule, matched-pair rule, metrics, intervals, artifact URI/hash, decision | Retains rejected experiments as evidence rather than losing them after migration |

### Migration invariants

1. Treat raw market observations as append-only or revisioned. A provider
   correction should create a traceable revision, not silently rewrite the
   candle used by an old benchmark.
2. Store session dates as exchange-local dates, with fetch/generated timestamps
   separately in UTC. NSE date parsing previously caused a real
   corporate-action adjustment defect.
3. Keep raw prices and corporate actions; derive adjusted histories with a
   named policy/version and an as-of cutoff. Do not apply future actions to
   feature origins before their effective date.
4. Persist feature-set identity, ordered feature names, lookbacks, model
   parameters, fold boundaries, code/version, and input-data references with
   every training/evaluation run.
5. Persist forecast origins and target dates explicitly. A five-session
   outcome is not the same target as five calendar days, and its outcome is
   not known when the prediction is made.
6. Keep `predicted`, `actual`, and `matured` values in distinct fields/records.
   Never feed a predicted price back as a future training label.
7. Match model and baseline scores on the same symbols, origins, targets, and
   actual returns. Save the pairing keys and uncertainty/bootstrap protocol.
8. Make prospective snapshots immutable and idempotent by exchange session
   date and prediction identity. The existing capture command rejects a
   duplicate date rather than overwriting it.
9. For F&O, retain contract-level rows or a reproducible source artifact in
   addition to aggregates. Record archive layout and aggregation policy
   because the legacy/new NSE schemas and front-expiry variants differ.
10. Keep benchmark-only models and production defaults explicitly labeled.
    The standard model remains close-only until new, predeclared, independent
    evidence justifies a change.
11. Keep source provenance and data-quality exclusions visible in downstream
    APIs and reports. Do not hide an exclusion by dropping its raw row.
12. Store probabilities and their maturity/scoring as separate lifecycle
    events. A snapshot with pending targets is not a score or evidence of
    accuracy.

## Open limitations and recommended continuation

- No database-backed ingestion, caching, model persistence, job queue,
  scheduler, or point-in-time data versioning exists yet.
- Price coverage uses a fixed user-selected 29-symbol cohort, not historical
  index membership; survivorship/selection bias remains possible.
- Dividends, all corporate/event impacts, exchange-holiday calendars,
  provider revisions, and regime changes are not comprehensively modeled.
- The 55% directional figure is an existing forecast-preview threshold, not
  proof of profitability or a universal acceptance criterion.
- Prospective probability tracking needs at least 200 distinct mature origins;
  at the time of this handoff the scorecard is still an early pipeline check.
- Sentiment work must wait until a local archive supports issuer relevance and
  verifiable point-in-time publication/capture provenance.
- New feature or model work should declare cohort, targets, benchmark,
  eligibility, matching, uncertainty method, and success criteria before
  looking at evaluation results.
- A successful forecast experiment would still need separate cost-aware,
  risk-limited paper evaluation and human review before any trading or broker
  integration.

For detailed development history and the current next-step ordering, start at
[the forecast improvement plan](./development/FORECAST_IMPROVEMENT_PLAN.md),
[the roadmap status](./development/FORECAST_MODEL_ROADMAP_STATUS.md), and
[the development baseline](./checkpoints/2026-10-07-development-baseline.md).

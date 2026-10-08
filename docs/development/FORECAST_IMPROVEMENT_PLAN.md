# Forecast Improvement Plan

Status: Phase 1 adjusted benchmark, symbol eligibility, and metric reporting
complete. The Phase 2 common-date 36/60/120-month history comparison is
complete. Phase 3's matched-date OHLC, broad-market-context, close-only
volatility/path-structure, causal volume, and prior-fold prediction-shrinkage
experiments are complete; none was adopted as the production feature set. A
probability-target base-rate and prior-only baseline audit is now complete;
a benchmark-only logistic probability classifier has completed its
walk-forward run and was not adopted as a general model. A frozen prospective
replication is now collecting predictions. All eligible benchmark symbols
were retained; unresolved ADANIENT price moves remain explicitly flagged, not
silently adjusted. The controlled 8/14/20-month training-window comparison is
complete: 20 months reduced MAPE versus 14 months on both horizons, but did
not improve directional accuracy and still trailed the no-change baseline.
The production 14-month schedule remains unchanged.

Consolidated development starting point: [Checkpoint 1](../checkpoints/2026-10-07-development-baseline.md).

**Data correction (2026-10-07):** the NSE historical endpoint returns dates
such as `01-Oct-2025`; the action-adjustment code had truncated these before
parsing, silently skipping split/bonus adjustments. The parser is fixed and
Phase 1-3 benchmark outputs were regenerated. Metrics recorded before this
correction, including older dated checkpoints, are superseded. The corrected
CSV/SVG outputs and corrected result tables below are authoritative.

Corrected Phase 1 default schedule (29 symbols; 60-month history; 14-month
train / 3-month frozen test / 6-month advance):

| Horizon | Model | Samples | MAPE | No-change MAPE | Direction accuracy |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | LightGBM technical | 14,044 | 1.1320% | 1.0194% | 50.36% |
| Next day | Statistical baseline | 14,044 | 1.0201% | 1.0194% | 49.67% |
| Next 5 sessions | LightGBM technical | 13,136 | 2.8892% | 2.3503% | 50.43% |
| Next 5 sessions | Statistical baseline | 13,136 | 2.3543% | 2.3503% | 50.56% |

Neither model beats no-change. The regenerated benchmark, per-symbol and
per-fold exports are in `results/forecast-benchmark-*`.

Development focus: NSE forecast quality and evaluation. Kite feature work is
paused until this plan is reviewed and the user asks to resume it. The existing
Kite service remains in HOLD mode; this plan does not authorize order execution.

## Objective

Improve the reliability and usefulness of NSE forecasts through measurable,
leakage-resistant experiments. Do not assume that more history, more features,
or sentiment will improve accuracy. Compare every candidate with the existing
no-change baseline and keep price accuracy, direction quality, uncertainty, and
simulated trading performance as distinct outcomes.

## Starting Evidence

The user-provided TCS one-session preview on 2026-10-06 reported:

- 248 out-of-sample samples.
- Model mean absolute percentage error (MAPE): 1.25598%.
- No-change baseline MAPE: 1.14754%; lower is better.
- Directional accuracy: 52.42%.
- The model did not beat the baseline; the preview gate requires at least 55%
  directional accuracy.
- The central estimate pointed down, but the prediction interval crossed the
  last close and the forecast signal was therefore `uncertain`.

This is one symbol/horizon result, not evidence about all stocks, horizons, or
future performance. It motivates better evaluation before feature expansion.

## Phase 1 Initial Benchmark Findings

Run date: 2026-10-06. The 29 included symbols completed; `TATAMOTORS` was
excluded at the user's direction after the historical endpoint returned a
different symbol. The full prediction-level JSON and partial-progress output
are stored locally (ignored by Git) at
`node_modules/.cache/forecast-benchmark/benchmark-2026-10-06T16-49-43-445Z.json`.

### Initial Three-Year Benchmark (Historical Snapshot)

These results came from the original 36-month history run and are retained as
a historical baseline. The 60-month default was subsequently benchmarked
separately below.

| Horizon | Model | Samples | Model MAPE | No-change MAPE | Direction accuracy | Symbols beating no-change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| next_day | LightGBM technical | 7,192 | 1.3721% | 1.2347% | 50.25% | 0 / 29 |
| next_day | Statistical baseline | 7,192 | 1.2363% | 1.2347% | 49.83% | 10 / 29 |
| week | LightGBM technical | 6,728 | 4.2384% | 3.4766% | 50.34% | 0 / 29 |
| week | Statistical baseline | 6,728 | 3.4926% | 3.4766% | 49.61% | 9 / 29 |

The technical model's pooled MAPE exceeded no-change at both horizons. The
statistical baseline also had slightly higher pooled MAPE than no-change,
despite beating it for some individual symbols. Directional accuracy remained
near 50%; this historical sample does not establish future performance or
profitability.

Coverage audit: each successful symbol had four scored test folds per horizon
and no missing predictions inside those fold test windows (116 folds per
horizon across 29 symbols). There were 87 between-fold gaps per horizon,
averaging 91.7 calendar days. These are genuine periods not scored by the
current schedule; zero missing rows inside test windows does not mean
continuous historical coverage.

### Separate Gap-Free Diagnostic

At the user's direction, a separate diagnostic kept the 14-month training and
3-month test lengths but advanced by three months; the production/default
six-month schedule was not changed. Results are at
`node_modules/.cache/forecast-benchmark/benchmark-gap-free-diagnostic-2026-10-06T16-57-06-667Z.json`.

| Horizon | Model | Samples | Model MAPE | No-change MAPE | Direction accuracy | Symbols beating no-change |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| next_day | LightGBM technical | 12,383 | 1.3354% | 1.1951% | 50.08% | 0 / 29 |
| next_day | Statistical baseline | 12,383 | 1.1965% | 1.1951% | 50.14% | 8 / 29 |
| week | LightGBM technical | 11,571 | 3.8703% | 3.1136% | 49.96% | 0 / 29 |
| week | Statistical baseline | 11,571 | 3.1259% | 3.1136% | 50.38% | 8 / 29 |

All seven test windows per symbol/horizon were contiguous, and all scored rows
were present (203 folds and zero missing predictions per horizon). The 10,034
additional samples fell in the three-month windows skipped by the current
schedule. On those added windows alone, LightGBM MAPE was 1.2846% vs no-change
1.1402% for next_day, and 3.3588% vs 2.6094% for week. It still did not beat
no-change.

The 13,920 predictions on dates shared with the six-month schedule had exactly
matching LightGBM predictions, baseline predictions and actual returns in both
runs. The lower all-sample MAPE under the diagnostic schedule must not be
credited to a model improvement: it includes different additional dates, and
no-change MAPE also fell. The diagnostic changes refit cadence as well as
coverage; it is evidence about coverage under that schedule, not proof that
the production training schedule should change.

### Five-Year Benchmark and Data-Quality Audit

The initial 60-month snapshot below predates the OHLC reversal screen and
corporate-action adjustment. Retain it as a historical baseline, not as the
final cleaned benchmark. Full prediction-level results (ignored local
artifacts):

- Current 6-month schedule:
  `node_modules/.cache/forecast-benchmark/benchmark-current-schedule-2026-10-06T17-16-02-446Z.json`
- Separate 3-month-advance diagnostic:
  `node_modules/.cache/forecast-benchmark/benchmark-gap-free-diagnostic-2026-10-06T17-21-51-941Z.json`

| Schedule | Horizon | Model | Samples | Model MAPE | No-change MAPE | Direction accuracy |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 6-month advance | next_day | LightGBM technical | 14,442 | 1.2941% | 1.1425% | 50.28% |
| 6-month advance | next_day | Statistical baseline | 14,442 | 1.1438% | 1.1425% | 49.81% |
| 6-month advance | week | LightGBM technical | 13,514 | 3.6748% | 2.9514% | 50.49% |
| 6-month advance | week | Statistical baseline | 13,514 | 2.9596% | 2.9514% | 51.07% |
| 3-month advance | next_day | LightGBM technical | 26,506 | 1.2789% | 1.1342% | 50.19% |
| 3-month advance | next_day | Statistical baseline | 26,506 | 1.1352% | 1.1342% | 50.44% |
| 3-month advance | week | LightGBM technical | 24,766 | 3.4749% | 2.8079% | 50.96% |
| 3-month advance | week | Statistical baseline | 24,766 | 2.8152% | 2.8079% | 51.46% |

LightGBM and the statistical baseline did not beat no-change at either horizon
under either schedule. The extra samples in the 3-month diagnostic do not
establish a model improvement: all 27,956 predictions on dates shared with the
6-month schedule matched exactly, while the diagnostic added 23,316 predictions
from formerly unscored windows. All 15 diagnostic test folds per symbol and
horizon were contiguous and had zero missing predictions. The default
production schedule remains unchanged.

All 29 symbols returned exactly 1,237 observations (35,873 rows total); there
were no duplicate, invalid, out-of-range, or non-EQ rows. There was one
calendar interval longer than four days per symbol, each no longer than five
days. These are not classified as missing sessions because exchange holidays
are not modeled. Nine close-to-close changes exceeded 25% across eight symbols:
RELIANCE, HDFCBANK, KOTAKBANK, WIPRO, TATASTEEL, POWERGRID, ADANIENT (two
consecutive moves), and BAJFINANCE. A direct query to NSE's equity
corporate-action endpoint on 2026-10-06 found actions matching seven
intervals: RELIANCE bonus 1:1; HDFCBANK bonus 1:1; KOTAKBANK face-value split
Rs 5 to Rs 1; WIPRO bonus 1:1; TATASTEEL face-value split Rs 10 to Rs 1;
POWERGRID bonus 1:3; BAJFINANCE face-value split Rs 2 to Rs 1 and bonus 4:1 on
the same ex-date. NSE historical close records show the pre-action close
followed by the lower post-action nominal close (for example RELIANCE 2,655.70
to 1,334.35 across its bonus ex-date). This confirms these close series are
**not adjusted across these corporate actions**. Applying action share factors
makes adjacent returns small (about -3.57% to +4.60%), rather than the nominal
-27.67% to -89.95%.

For ADANIENT, no matching equity corporate action was returned for 2023-01-31
through 2023-02-02; its two drops (-28.1970%, -26.6982%) remain unexplained by
this corporate-action endpoint and should not be silently adjusted.

A per-interval record with raw closes, action terms, share factors and
arithmetic post-action comparisons is in the
[corporate-action audit CSV](../../results/forecast-corporate-action-audit.csv).
The historical CSV is an audit-only calculation; the causal adjustment and
benchmark rerun are now implemented as described below.

The original OHLC-screened but unadjusted result is preserved in the preceding
snapshot table. The comparison chart and summary CSV now show action-adjusted
results.

### OHLC-Screened Benchmark

On 2026-10-06, both 60-month schedules were rerun with the approved intraday
reversal rule. All 29 symbols completed. The screen flagged 21 candles across
HDFCBANK, BHARTIARTL, ITC, POWERGRID, ADANIENT, ADANIPORTS, and EICHERMOT.
Folds with fewer than 120 eligible training rows or 20 eligible test rows
were explicitly skipped rather than failing the whole symbol or lowering the
minimum:

| Schedule | Horizon | Model | Samples | Model MAPE | No-change MAPE | Direction accuracy |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 6-month advance | next_day | LightGBM technical | 14,046 | 1.2727% | 1.1199% | 50.42% |
| 6-month advance | next_day | Statistical baseline | 14,046 | 1.1211% | 1.1199% | 49.98% |
| 6-month advance | week | LightGBM technical | 13,138 | 3.6249% | 2.8894% | 50.21% |
| 6-month advance | week | Statistical baseline | 13,138 | 2.8961% | 2.8894% | 51.39% |
| 3-month advance | next_day | LightGBM technical | 25,918 | 1.2631% | 1.1166% | 50.26% |
| 3-month advance | next_day | Statistical baseline | 25,918 | 1.1176% | 1.1166% | 50.41% |
| 3-month advance | week | LightGBM technical | 24,188 | 3.4296% | 2.7588% | 50.60% |
| 3-month advance | week | Statistical baseline | 24,188 | 2.7652% | 2.7588% | 51.46% |

Neither forecast model beat no-change. The production schedule scored 227 folds
and skipped 5 per horizon. The diagnostic scored 428 next-day and 427 week
folds, skipping 7 and 8 respectively. There were 47 and 29 otherwise-eligible
rows in skipped production folds, and 50 and 47 in skipped diagnostic folds.
Quality-excluded rows are separately counted in the fold CSV. All 27,184
predictions on shared origins matched exactly between schedules; the
diagnostic added 22,922 predictions. Split/bonus adjustment remains
unapplied in this historical snapshot; the results below supersede it for
corporate-action-adjusted performance.

The chart and machine-readable exports are described in the action-adjusted
section below.

### Causal Corporate-Action Adjustment and Final Phase 1 Rerun

The production `NSEClient` forecast now retrieves the symbol's corporate
actions and recognizes NSE bonus ratios and face-value split terms. For a
share-count factor `f` effective on ex-date `d`, historical OHLC prices before
`d` are divided by `f`; prices on/after `d` are unchanged. Multiple events on
one date multiply their share factors. Bonus `a:b` uses `1 + a/b`, and split
factor is old face value divided by new face value. The transformed history is
used consistently for technical features, labels, statistical baseline,
interval calibration and scored actuals. Since the model features are
price-ratio based, back-scaling all observations before a later event by a
constant does not change pre-event feature ratios; returns crossing an event
exclude its mechanical share-count discontinuity. Dividends are not adjusted.
The API reports `corporateActionAdjustment` and parsed
`corporateActionAdjustments`; provider failures or unparseable split/bonus
terms fail explicitly. A directly constructed `ForecastApi` without a
corporate-action provider remains unadjusted and reports that status.

The benchmark fetched 8 share-adjustment records across 7 ex-dates in the
60-month history. The seven known raw moves were converted to ordinary
post-action returns in the range -3.57% to +4.60%. Both schedules completed
for all 29 symbols. The unchanged objective eligibility rule is: require NSE `EQ` history, at
least 600 valid daily observations spanning the requested history, successful
corporate-action endpoint validation (all returned split/bonus records must
parse), and at least one scored fold for each horizon (each scored fold needs
at least 120 eligible train rows and 20 test rows). A symbol is not removed
for poor MAPE or directional accuracy. All 29 passed; ADANIENT, ADANIPORTS and
EICHERMOT have some folds omitted because quality-screened samples leave those
folds below minimum, but each retains scored folds. `TATAMOTORS` remains
excluded at the user's earlier direction because the endpoint did not return
the requested instrument.

| Schedule | Horizon | LightGBM samples | LightGBM MAPE | No-change MAPE | Statistical MAPE | LightGBM MAE (log-return pp) | LightGBM direction | 95% interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6-month advance | next_day | 14,044 | 1.1320% | 1.0194% | 1.0201% | 1.1313 | 50.36% | 95.05% (12,333) |
| 6-month advance | week | 13,136 | 2.8892% | 2.3503% | 2.3543% | 2.8813 | 50.43% | 94.54% (11,541) |
| 3-month advance diagnostic | next_day | 25,885 | 1.1649% | 1.0554% | 1.0557% | 1.1640 | 50.47% | 94.32% (24,191) |
| 3-month advance diagnostic | week | 24,154 | 2.9199% | 2.4244% | 2.4260% | 2.9160 | 50.77% | 94.24% (22,576) |

Neither forecast model beats no-change; directional accuracy remains below
the 55% preview gate. The production run scored 227 folds and skipped 5 per
horizon; the diagnostic scored 428 next-day and 427 week folds, skipping 7 and
8. Fold and per-symbol MAE (mean absolute log-return error in percentage
points), MAPE, directional accuracy and calibrated interval-coverage counts
are reported with their denominators.

Raw-vs-adjusted metrics are computed on shared origins/targets in
[forecast-benchmark-raw-vs-adjusted.csv](../../results/forecast-benchmark-raw-vs-adjusted.csv).
This isolates the label/data treatment change and makes the date intersection
explicit. Machine-readable outputs include aggregate
[comparison](../../results/forecast-benchmark-comparison.csv),
[per-symbol](../../results/forecast-benchmark-by-symbol.csv),
[per-fold](../../results/forecast-benchmark-folds.csv),
[symbol eligibility](../../results/forecast-benchmark-eligibility.csv),
[corporate-action adjustment audit](../../results/forecast-corporate-action-adjustment.csv),
[intraday reversal audit](../../results/forecast-intraday-reversal-audit.csv),
and the [ADANIENT investigation](../../results/forecast-adanient-move-investigation.csv).

The [comparison chart](../../results/forecast-benchmark-comparison.svg) uses
plain-language descriptions of the error measure, simplified method names,
and a 55% preview-minimum line alongside chance-level reference.

### ADANIENT Move Investigation

The 2023-01-31 and 2023-02-01 close moves remain -28.1970% and -26.6982%,
respectively; NSE returned no matching split or bonus. Its corporate
announcements endpoint returned contemporaneous filings: an exchange
clarification request on 2023-01-30 regarding news about anchor-investor
allotments; a Regulation 30 update filed late on 2023-02-01; and an FPO
withdrawal filing on 2023-02-02. These provide relevant event context but do
not prove the cause of either daily move. The prices are not mathematically
corporate-action-adjusted. ADANIENT stays in the benchmark because it is a
valid NSE equity with sufficient history and scored folds; affected OHLC
windows are excluded by the approved data-quality screen. No performance-
based symbol deletion is applied.

### Intraday Reversal Quality Rule

NSE's historical rows provide open, trade-high, trade-low and close. Per the
user-approved rule, retain and report candles where `(high - low) / open >=
10%` and `abs(close - open) / (high - low) <= 50%`, but exclude any model
sample whose 60-session technical-feature lookback or forecast target window
touches such a candle. The raw date remains in the time series; removing it
outright would shift session indexes and turn multi-session price changes into
misleading one-session labels. A flagged latest close blocks forecast
generation. Fold metadata reports excluded train/test rows; recent baseline
backtests report excluded outcomes.

This screen does not declare observations erroneous and is not used to hide
volatile outcomes. The benchmark reports flagged rows and resulting
eligible-sample denominators. Split/bonus actions are now separately adjusted;
unexplained moves remain visible and their affected samples are screened.

## Phase 1 Benchmark Specification

- Universe: user-selected fixed cohort, now 29 included NSE symbols:
  `RELIANCE`, `HDFCBANK`, `ICICIBANK`, `SBIN`, `AXISBANK`, `KOTAKBANK`,
  `BHARTIARTL`, `TCS`, `INFY`, `HCLTECH`, `WIPRO`, `LT`, `M&M`, `MARUTI`,
  `SUNPHARMA`, `CIPLA`, `ITC`, `HINDUNILVR`, `TITAN`,
  `ASIANPAINT`, `TATASTEEL`, `JSWSTEEL`, `NTPC`, `POWERGRID`, `ADANIENT`,
  `ADANIPORTS`, `BAJFINANCE`, `EICHERMOT`, `ULTRACEMCO`.
- Horizons: `next_day` (one session) and `week` (five sessions).
- History: default 60 months, configurable from 36 to 120 months with
  `historyMonths`, subject to data availability and minimum-history/fold
  requirements. The history length changes total evaluation/calibration history;
  rolling train/test/advance lengths remain fixed at 14/3/6 months. Record any
  symbol that cannot be evaluated; do not silently substitute it.
- The original 60-month audit found no malformed/duplicate/non-EQ/out-of-range
  rows. The updated run uses corporate-action-adjusted closes for benchmark
  metrics; ADANIENT's two price moves remain unexplained by split/bonus actions
  and are documented separately.
- This fixed list was selected by the user for a benchmark, not generated from
  historical index membership. Any survivorship/selection bias must be noted.
- `TATAMOTORS` was in the original requested list, but the NSE historical
  response identified a different symbol. At the user's direction, exclude it
  from this benchmark rather than silently substituting another company.
- Existing scoring uses identical LightGBM out-of-sample predictions to compare
  model MAPE with a zero-return (no-change) baseline. Directional accuracy is
  the fraction of those samples whose predicted and actual log-return signs
  match; exact zero/zero counts as a match. This definition is now factored
  into a focused helper and tested with hand-calculated values and invalid
  inputs. It does not establish profitability.
- Technical forecast metadata now includes a causal statistical-baseline
  log-return estimate at each LightGBM out-of-sample origin. The Phase 1
  benchmark runner scores LightGBM, the existing statistical model and
  no-change on identical origin/target samples; it reports per-symbol and
  pooled metrics, fold sample accounting, and calendar gaps. The runner writes
  progress/results below `node_modules/.cache/forecast-benchmark`.
- The six-month fold advance and three-month test interval are unchanged.
  `rollingFolds` tests establish the calendar boundaries and boundary purging;
  unscored gaps remain a measurement item, not changed by this phase.
- The user approved a separate three-month-advance diagnostic only. The new
  `npm run forecast:benchmark:gaps` command keeps the 14-month training and
  three-month test windows, advances by three months, and does not change the
  production/default six-month schedule.
- Forecast history now defaults to five years (`historyMonths: 60`) and
  accepts 36–120 months. The final forecast still trains on the latest 14
  months; history length supplies more/less walk-forward evaluation and
  residual-calibration data. API responses and benchmark records now include
  row-quality counts, long calendar intervals, large daily moves, and
  corporate-action adjustment events/status. Direct `ForecastApi`
  construction without a provider still reports "not applied by forecast";
  the production NSE client configures the NSE action provider.
- The approved OHLC screen flags candles with a high-low range at least 10% of
  open and an open-close body at most 50% of that range. Candidate dates remain
  in raw history; affected training/evaluation windows are omitted and
  reported. The 60-month rerun flagged 21 candles. Five production folds and
  7–8 diagnostic folds per horizon were skipped for insufficient eligible
  samples, while all 29 symbols retained scored folds.
- The 36-month benchmark remains an earlier baseline snapshot. The final
  60-month benchmark now includes causal split/bonus adjustment and same-date
  raw-versus-adjusted comparisons. Unadjusted older CSVs are retained as
  historical artifacts, not current performance claims.
- Objective symbol eligibility is based on NSE EQ identity, valid 60-month
  data with at least 600 closes, an action-provider response that can be
  parsed, and at least one scored fold per horizon. No symbol is excluded for
  poor benchmark scores. The eligibility export has 60 rows: all 58
  symbol/schedule combinations for the 29-symbol cohort pass; the two explicit
  TATAMOTORS schedule rows remain excluded under the user's earlier direction.

## Phase 2 — History Window and Data Quality (History Comparison Complete)

The first Phase 2 experiment compared 36-, 60-, and 120-month histories while
keeping the model, 14-month training / 3-month test / 6-month advance schedule,
corporate-action treatment, OHLC screen, symbol cohort, and cutoff fixed.
Results are scored only on the intersection of exact symbol/origin/target
pairs available under all three windows. Baselines use the same pairs.
Per-symbol history rows and skipped-fold reasons are exported so performance
cannot be hidden by changing the ticker or sample mix.

This development comparison ends before 2026-04-06. The 2026-04-06 through
2026-10-06 period is excluded from this comparison, but is **not an untouched
holdout** because earlier Phase 1 reports already included that time range.
A genuinely unseen prospective evaluation is reserved for 2026-10-07 through
2027-04-06; it cannot be scored until future observations exist. Do not tune
model choices or thresholds against that prospective holdout before it is
available.

Run with `npm run forecast:history-windows`; export with
`npm run forecast:history-windows:export`. The completed run evaluated 87
symbol/window combinations with no errors. On the common-date comparison
cohort, all 29 symbols and 6,915 next-day / 6,467 week origin-target pairs were
shared across the three history lengths. The scored dates span 2024-06-05 to
2026-03-04. The OHLC screen and corporate-action treatment were held fixed.

| Horizon | History | Technical MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Next day | 36 months | 1.1357% | 1.0218% | 50.11% | 95.86% |
| Next day | 60 months | 1.1275% | 1.0218% | 50.15% | 95.66% |
| Next day | 120 months | 1.1274% | 1.0218% | 50.15% | 96.91% |
| Next 5 trading days | 36 months | 2.9592% | 2.4269% | 49.93% | 94.73% |
| Next 5 trading days | 60 months | 2.9505% | 2.4269% | 50.49% | 94.94% |
| Next 5 trading days | 120 months | 2.9524% | 2.4269% | 50.35% | 96.37% |

No technical-model or statistical-baseline history setting beat no-change on
pooled MAPE, and no symbol beat no-change with the technical model in either
horizon/window comparison. All directional results remain near chance and
below the current 55% preview gate. Longer histories changed fold availability
and interval coverage but did not produce a meaningful forecast-quality gain.
In particular, 120 months only marginally lowered technical MAPE versus 60
months, while both remained worse than no-change. **Keep the 60-month default;
do not switch to 120 months based on these results.** This is a cautious
development choice, not evidence that 60 months is optimal.

The comparison CSV reports aggregate MAPE, MAE, direction and interval
coverage. The per-symbol CSV preserves stock-level differences. The eligibility
CSV records scored/skipped folds; 36/60/120-month runs had respectively
112/227/503 next-day scored folds and 4/5/19 skipped folds (week: 112/227/500
scored, 4/5/22 skipped). These fold totals describe each run's full history,
not the smaller common-date aggregate cohort.

Published results:
[history-window comparison](../../results/forecast-history-window-comparison.csv),
[per-symbol metrics](../../results/forecast-history-window-by-symbol.csv),
[eligibility](../../results/forecast-history-window-eligibility.csv),
[holdout status](../../results/forecast-final-holdout.csv), and the readable
[history comparison chart](../../results/forecast-history-window-comparison.svg).
The production schedule and forecast preview gates remain unchanged.

## Principles And Guardrails

1. Use only information available at each historical forecast origin. Prevent
   look-ahead leakage from prices, corporate actions, news timestamps, or
   feature normalization.
2. Keep forecast predictions, observed outcomes, training labels, residual
   calibration, and sentiment probabilities distinct.
3. Compare candidates and baselines on identical symbols, horizons, origins,
   and eligible samples. Report missing/filtered samples rather than silently
   changing denominators.
4. Keep a final chronological holdout untouched during model/feature selection.
   Do not repeatedly tune against it.
5. Do not claim accuracy gains from in-sample metrics or a single favorable
   ticker. Report uncertainty and variation across time and symbols.
6. Preserve conservative `uncertain` behavior when the prediction interval
   overlaps the reference close or the model/risk checks do not justify a
   directional signal.
7. No experiment in this plan enables Kite order placement. Keep Kite work
   paused and HOLD enforced unless separately authorized.

## Phased Work

### Phase 1 — Establish a reproducible benchmark

- Define a benchmark set of liquid NSE equities and the supported forecast
  horizons (`next_day` and `week`); record symbol inclusion and exclusions.
- Generate chronological out-of-sample predictions for each stock/horizon with
  actual forecast origins and targets.
- Audit rolling fold coverage. The current 3-month test / 6-month advance
  schedule leaves 3-month periods unscored. Measure the impact and propose
  continuous or otherwise explicit coverage without changing the schedule
  until the user approves the split semantics.
- Compare LightGBM with no-change and the existing statistical baseline using
  exactly the same dates and targets.
- Report per-stock, per-horizon, per-fold and aggregate MAPE, MAE where useful,
  directional accuracy, sample counts, interval coverage and forecast
  availability. Explain each denominator.
- Check the scoring implementation with hand-calculated small fixtures,
  including flat actual/predicted returns and no-sample cases.
- Re-run both schedules after the user-approved OHLC reversal screen and record
  flagged candles plus affected training/test samples. Do not silently bridge
  across a removed session.
- Before declaring the benchmark final, adjust known split/bonus events
  causally, investigate the unexplained ADANIENT moves, and compare raw and
  action-adjusted results on the same eligible dates.
- Complete per-stock/per-fold reporting for MAE and interval coverage in
  addition to the current MAPE and directional accuracy; report exclusions and
  sample denominators explicitly.

**Exit criteria:** reproducible predictions and metric reports; matching
baselines; confirmed chronological separation; explicit treatment of fold gaps
and edge cases. **Status: complete for this fixed cohort and 60-month window.**
The action-adjusted runner, objective eligibility report, same-date raw
comparison, and per-symbol/per-fold MAE and interval denominators are now
checked in. The unexplained ADANIENT moves remain flagged limitations, not
automatic grounds to drop an otherwise-eligible equity.

### Phase 2 — Audit and characterize historical data

- Check date parsing, duplicate/conflicting rows, missing sessions, stale
  coverage, unexpected price discontinuities, symbol history and exchange
  calendar assumptions.
- Determine whether the available close series is adjusted for splits, bonuses
  and dividends. Do not interpret corporate-action jumps as ordinary returns.
- Compare 36-, 60-, and longer-month total history windows on common evaluation
  dates. More history is a candidate experiment, not an assumed improvement;
  older market regimes may be less representative. **Completed:** all three
  history lengths were compared on 29 stocks and common next-day/week samples;
  the technical model did not beat no-change, so 60 months remains the default.
- Document data limitations and invalidate or separately flag samples that
  cannot be scored reliably.

**Exit criteria:** a data-quality report and a justified decision on whether
history length, adjustment, or filtering needs a code change. The available
comparison supports no history-window change. The 60-month window is retained
as the configured default, without claiming it is statistically optimal.

### Phase 3 — Test focused model and feature candidates (In Progress)

- Keep the current technical model as the control.
- Test candidate inputs one group at a time: OHLCV-derived features, broad
  market/sector context, and alternative causal technical features. Verify
  source reliability, timestamp availability, and missing-data behavior first.
- Compare direct return/direction targets or probability estimates only as
  separately named candidates; do not conflate price direction with calibrated
  probability or the current interval-based signal.
- Tune model complexity only within chronological training/validation periods.
  Preserve the final holdout.
- Record each experiment, code/data version, parameters, score and baseline
  comparison. Retain a candidate only if gains are repeatable across symbols,
  folds and horizons and are not offset by substantially worse cases.

**Exit criteria:** evidence-based keep/reject decision for each feature/model
group, with no silent fallback or model identity changes.

#### Experiment 1 — OHLC candle features (completed; not adopted)

The first controlled candidate adds five causal, end-of-session candle
features to the existing 12 close-derived features:
intraday range/close, log(close/open), close location within the day's range,
log(open/prior close), and mean daily range/close over 20 sessions. These use
the existing historical open/high/low/close rows; no volume feature was added.
The control remains close-only. Both modes use the same 60-month history, 29
symbols, causal split/bonus adjustment, reversal screen, 14/3/6 fold schedule,
cutoff and model parameters. Evaluation retains only exact origin/target pairs
scored by both modes; both baselines use those same pairs.

Run with `npm run forecast:feature-ablation`; export with
`npm run forecast:feature-ablation:export`. The run completed 58/58 model
fits (29 per feature set) without error. All symbols had complete OHLC in the
audited history and the OHLC candidate lost no additional test rows. Matched
samples were 13,997 next-day and 13,089 five-session origin/target pairs,
covering 2022-06-06 through 2026-03-04.

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | OHLC candidate | 13,997 | 1.1650% | 1.0480% | 49.99% | 95.99% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | OHLC candidate | 13,089 | 2.9784% | 2.4372% | 50.00% | 95.70% |

The OHLC candidate's MAPE improved by about 0.0006 percentage points next day
and 0.0186 points for five sessions against the close-only control. OHLC had
lower MAPE than close-only for 16/29 symbols next day and 17/29 for five sessions, but
neither feature set beat no-change for any symbol in this comparison (0/29),
and neither reached the 55% directional preview gate. Direction accuracy was
lower with OHLC at both horizons. The statistical baseline also remained
slightly worse than no-change.

**Decision:** retain close-only in production. The small, horizon-specific
week MAPE change is mixed evidence, not a reliable forecast improvement; this
development sample is not the reserved prospective holdout. Keep the OHLC
variant behind the benchmark-only internal hook for reproducibility, but do not
expose it as a forecast API option or enable it in Kite. This experiment does
not authorize relaxing safety gates.

Published results:
[aggregate metrics](../../results/forecast-feature-ablation-comparison.csv),
[per-symbol comparison](../../results/forecast-feature-ablation-by-symbol.csv),
[feature/data eligibility](../../results/forecast-feature-ablation-eligibility.csv),
and [readable chart](../../results/forecast-feature-ablation-comparison.svg).

#### Experiment 2 — NIFTYBEES market context (completed; not adopted)

The second controlled candidate adds four causal features computed from
same-date and earlier NIFTYBEES closes: one-, five-, and 20-session log returns
and 20-session return volatility. The fixed 60-month history, 29-symbol
cohort, split/bonus handling, reversal screen, 14/3/6 folds, cutoff and model
parameters were unchanged. The market proxy supplied 1,239 sessions from
2021-04-05 through 2026-04-02, with zero recognized split/bonus adjustments.
All symbols had complete market features at every eligible training and test
origin (zero feature-unavailable rows). Evaluation retained exact common
origin/target pairs, and both baselines used the same pairs. A test also
verified that changes to future proxy closes do not alter earlier frozen-fold
forecasts.

Run with `npm run forecast:market-context-ablation`; export with
`npm run forecast:market-context-ablation:export`. All 58 fits completed
without error. Both models were evaluated on 13,997 next-day and 13,089
five-session pairs across 29 symbols, covering 2022-06-06 through 2026-03-04.

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | Market-context candidate | 13,997 | 1.1681% | 1.0480% | 49.73% | 95.89% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | Market-context candidate | 13,089 | 3.0264% | 2.4372% | 49.70% | 96.46% |

Market context increased pooled MAPE versus close-only by 0.0024 percentage
points next day and 0.0294 points for five sessions. It had lower MAPE than
close-only for 13/29 symbols at each horizon, indicating mixed per-symbol
results. Neither model beat no-change
for any symbol or pooled horizon. Directional accuracy declined with market
features at both horizons and remained below the 55% preview gate. Higher
five-session interval coverage is descriptive only and does not establish
future calibration.

**Decision:** do not adopt market context in production. Keep the close-only
model, public forecast contract, no-change gate and Kite HOLD behavior
unchanged. The experiment uses only an internal benchmark switch and does not
enable order execution.

Published results:
[aggregate metrics](../../results/forecast-market-context-ablation-comparison.csv),
[per-symbol metrics](../../results/forecast-market-context-ablation-by-symbol.csv),
[feature availability and eligibility](../../results/forecast-market-context-ablation-eligibility.csv),
and [readable chart](../../results/forecast-market-context-ablation-comparison.svg).

#### Experiment 3 — Close-only volatility and path structure (completed; not adopted)

The third candidate adds five causal, close-derived features to the existing
12-feature control:

- realized volatility of the past 5 log returns;
- realized volatility of the past 60 log returns;
- downside volatility over the past 20 returns (root-mean-square of negative
  returns);
- lag-one autocorrelation of the past 20 daily returns;
- 20-session trend efficiency (absolute cumulative return divided by total
  absolute daily movement).

No OHLC, volume, market context, or sentiment inputs were included. The longer
lookback requires 61 observed closes; it excludes one initial candidate row
from each scored training fold, but no test rows. The control and candidate
were compared on the exact same forecast origins and targets. The 60-month
history, 29-symbol cohort, split/bonus treatment, reversal screen, 14/3/6
schedule, development cutoff, model parameters, and no-change/statistical
baselines stayed fixed. A future-close mutation test confirmed that later
prices do not change forecasts from earlier frozen test blocks.

Run with `npm run forecast:advanced-technical-ablation`; export with
`npm run forecast:advanced-technical-ablation:export`. All 58 fits completed
without error. The shared evaluation set contained 13,997 next-day and 13,089
five-session origin/target pairs across 29 symbols, from 2022-06-06 through
2026-03-04.

| Horizon | Feature set | Samples | Model MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 13,997 | 1.1657% | 1.0480% | 50.33% | 95.87% |
| Next day | Advanced technical candidate | 13,997 | 1.1808% | 1.0480% | 49.63% | 96.02% |
| Next 5 sessions | Close-only control | 13,089 | 2.9970% | 2.4372% | 50.39% | 95.81% |
| Next 5 sessions | Advanced technical candidate | 13,089 | 3.0413% | 2.4372% | 50.44% | 95.77% |

The candidate's pooled MAPE was worse than close-only at both horizons by
about 0.015 and 0.044 percentage points. It had lower MAPE than close-only for 8/29
symbols next day and 10/29 for five sessions. Next-day direction accuracy
declined by 0.41 points; five-session accuracy rose by only 0.19 points and
remained near chance. Neither candidate nor control beat no-change for any
symbol or pooled horizon. Interval coverage did not improve consistently.

**Decision:** reject this feature group for production. Retain the 12-feature
close-only control and all preview/Kite safety gates unchanged.

Published results:
[aggregate metrics](../../results/forecast-advanced-technical-ablation-comparison.csv),
[per-symbol metrics](../../results/forecast-advanced-technical-ablation-by-symbol.csv),
[eligibility and missing-feature counts](../../results/forecast-advanced-technical-ablation-eligibility.csv),
and [readable chart](../../results/forecast-advanced-technical-ablation-comparison.svg).

### Historical Volume Audit (Completed)

Audited the raw NSE `chTotTradedQty` field over five years for the same 29
symbols: 1,239 daily rows per symbol (35,931 total), 2021-04-05 through
2026-04-02. All rows had positive volume, valid closes, unique dates and equity
classification; no quantity value was missing, invalid or zero. Eight
ex-date groups covered nine split/bonus actions.

For action dates, prior quantities were restated using the cumulative share
factor. Median five-session restated-volume ratios after/before action ranged
from about 0.56 to 2.39, while adjusted-close ratios ranged from about 0.957
to 1.127. These short windows include real changes in market activity and
price; they do not prove the provider's adjusted share units are correct or
that volume is predictive. No volume feature was added or used in a benchmark.

Published audit outputs:
[per-symbol volume quality](../../results/forecast-volume-history-audit-by-symbol.csv)
and [corporate-action event windows](../../results/forecast-volume-corporate-action-audit.csv).
The audit can be repeated with `npm run forecast:volume-audit`.

Any later feature experiment must be point-in-time: a feature row at origin
`t` cannot use a split/bonus factor for an action effective after `t`.
Historical volume rows may only be restated for actions already effective by
that feature origin; if action announcement availability is unknown, do not
apply it before its ex-date. Consider resetting or warming up the rolling
normalizer after an action rather than silently introducing a unit jump.

### Experiment 4 — Relative-volume feature (completed; not adopted)

Test one causal feature against the close-only control: `log(current daily
quantity / median(quantity over the prior 20 sessions))`. The denominator
uses only prior observations. Raw quantity remains in its observed share units;
to avoid using actions before they are effective, feature origins on the ex-date
and the following 19 observed sessions are unavailable. After that warmup,
the trailing window contains only same-unit quantities. Corporate-action
events after a feature origin do not affect that feature.

The experiment uses the same 29-symbol cohort, 60-month history, 14-month
training / 3-month frozen test / 6-month advance schedule, intraday-reversal
screen, cutoff and model settings as the other Phase 3 ablations. Candidate and
control results are compared only on common origin/target pairs. Report sample
loss from the 20-session action warmup, MAPE versus no-change, direction and
interval coverage at next-day and five-session horizons, and per-symbol
differences. The volume mode is available only through the internal benchmark
switch; it does not alter the public forecast or production model. This is a
daily-bar benchmark and does not evaluate an intraday target while the market
is open.

Run with `npm run forecast:volume-ablation`; export with
`npm run forecast:volume-ablation:export`. All 58 symbol/feature runs
completed successfully. The matched common-date cohort contained all 29
symbols and 13,913 next-day / 13,010 five-session origin/target pairs:

| Horizon | Feature set | MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 1.1650% | 1.0477% | 50.32% | 95.86% |
| Next day | Relative-volume candidate | 1.1662% | 1.0477% | 49.97% | 95.92% |
| Next 5 sessions | Close-only control | 2.9979% | 2.4383% | 50.38% | 95.79% |
| Next 5 sessions | Relative-volume candidate | 2.9919% | 2.4383% | 50.30% | 95.56% |

The candidate's next-day MAPE was 0.0012 percentage points worse than
close-only; five-session MAPE was only 0.0059 points lower. It was lower-MAPE
than close-only for 13/29 symbols next day and 17/29 for five sessions.
Direction declined slightly at both horizons. Neither candidate nor control
beat no-change on pooled MAPE or for any of the 29 symbols. Feature warmup and
missing-volume eligibility excluded 163 training and 245 test feature rows
summed across both horizons/folds; exact matched denominators are reported in
the comparison outputs.

**Decision:** do not adopt the volume feature. The tiny five-session MAPE
change is not persuasive, the candidate remains worse than no-change, and
directional accuracy did not improve. Keep it benchmark-only; production
features, forecast parameters and Kite HOLD gates remain unchanged.

Published results:
[aggregate comparison](../../results/forecast-volume-ablation-comparison.csv),
[per-symbol comparison](../../results/forecast-volume-ablation-by-symbol.csv),
[eligibility and unavailable rows](../../results/forecast-volume-ablation-eligibility.csv),
and [readable chart](../../results/forecast-volume-ablation-comparison.svg).

#### Experiment 5 — Causal Prior-Fold Prediction Shrinkage (completed; not adopted)

Tested whether shrinking each LightGBM log-return prediction toward zero
(no-change) using a single cohort-wide factor per horizon could improve
accuracy. Factors were selected from `0.0` through `1.0` in `0.1` increments
using only predictions whose target dates were strictly earlier than the next
test fold's start. Fewer than 100 prior predictions forced the factor to zero.
Each factor was then frozen for that test fold. The evaluation reused the
corrected 60-month benchmark's same origins, targets, and symbols; it did not
alter the API forecast or use the prospective holdout.

| Schedule | Horizon | Samples | LightGBM MAPE | Shrinkage MAPE | No-change MAPE | Statistical baseline MAPE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Current 14/3/6 | Next day | 14,044 | 1.1320% | 1.0199% | 1.0194% | 1.0201% |
| Current 14/3/6 | Next 5 sessions | 13,136 | 2.8892% | 2.3503% | 2.3503% | 2.3543% |
| Gap-free 14/3/3 diagnostic | Next day | 25,885 | 1.1649% | 1.0555% | 1.0554% | 1.0557% |
| Gap-free 14/3/3 diagnostic | Next 5 sessions | 24,154 | 2.9199% | 2.4259% | 2.4244% | 2.4260% |

The selected factor was zero in most folds and never exceeded 0.1. Shrinkage
did not beat no-change on any pooled schedule/horizon; its directional accuracy
also collapsed toward zero because predictions were reduced to zero or near
zero. The gap-free schedule is a sensitivity check over overlapping historical
data, not an independent validation set.

**Decision:** reject shrinkage as a forecast improvement and leave production
forecasting, model settings, the no-change comparison/gate, prospective holdout,
and Kite HOLD unchanged. This result reinforces that the current model's
estimated return signal is not useful enough to retain after calibration.

Reproduce with `npm run forecast:prediction-shrinkage`. Results:
[aggregate comparison](../../results/forecast-prediction-shrinkage-comparison.csv),
[per-fold factors and scores](../../results/forecast-prediction-shrinkage-by-fold.csv),
and [readable comparison chart](../../results/forecast-prediction-shrinkage-comparison.svg).

#### Probability target audit — Completed (base rates only)

The proposal [Feed Stock 2 Forecast Model](./feedtstock2forecastmodel.md)
identifies direction and threshold-event probabilities as preferred outputs.
The existing API reports expected price change, direction, and uncertainty
intervals, but does not produce calibrated probabilities for those events.
Before fitting a classifier, audited the available corrected walk-forward
outcomes for three explicit labels: positive simple return, simple return
strictly above +1%, and simple return strictly below -1%. Only next-day and
five-session horizons are included because those are the outcomes present in
the existing artifacts; no three-session claim is made.

For a deployable reference baseline, each test fold receives the observed
event prevalence from earlier OOS outcomes of the same horizon whose targets
matured strictly before the test start. A Laplace correction is applied once
at least 100 prior outcomes exist; otherwise the baseline uses 50%. Scores
are Brier score and log loss. This is a causal prevalence baseline, not a
feature-conditioned probability forecast.

| Horizon | Event | OOS samples | Observed event rate | Prior-only Brier | Prior-only log loss |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Return > 0% | 14,044 | 49.70% | 0.2504 | 0.6940 |
| Next day | Return > +1% | 14,044 | 19.40% | 0.1694 | 0.5206 |
| Next day | Return < -1% | 14,044 | 18.73% | 0.1628 | 0.5055 |
| Next 5 sessions | Return > 0% | 13,136 | 50.61% | 0.2521 | 0.6974 |
| Next 5 sessions | Return > +1% | 13,136 | 35.47% | 0.2373 | 0.6682 |
| Next 5 sessions | Return < -1% | 13,136 | 34.54% | 0.2292 | 0.6513 |

This establishes label frequencies and a leakage-safe benchmark, not model
skill. Outcome frequencies vary by fold; daily and five-session outcomes also
overlap in time. The gap-free diagnostic is a schedule sensitivity check on
the same historical period, not independent evidence. The audit does not
change API output or Kite behavior.

Run with `npm run forecast:probability-target-audit`. Results:
[aggregate target audit](../../results/forecast-probability-target-audit.csv)
and [per-fold target rates and scores](../../results/forecast-probability-target-audit-by-fold.csv).

#### Probability classifier — Benchmark-only implementation

The candidate is standardized logistic regression trained independently per
symbol, event, and horizon. It uses the existing close-only technical feature
vectors, data-quality masks, and frozen 14-month training / 3-month test /
6-month advance folds. Only next-day and five-session horizons are included;
each event classifier requires at least 10 positive and 10 negative labels in
its training fold. Configuration is fixed (L2 penalty 0.01), not tuned on the
prospective holdout.

The benchmark compares Brier score and log loss with both the causal
prior-only event prevalence and a neutral 50% probability on identical test
rows. It also writes event counts/rates, fixed-width calibration bins,
per-fold metrics, and paired 20-session moving-block-bootstrap intervals.
Run with `npm run forecast:probability-classifier`; timestamped artifacts are
written under
[`results/forecast-probability-classifier/`](../../results/forecast-probability-classifier/).

The 2026-10-07 run covered all 29 symbols. Exact symbol/origin/horizon keys
matched the corrected benchmark (14,044 next-day and 13,136 five-session rows
per event). The classifier improved next-day threshold-event Brier scores
versus the prior-only baseline by 0.0041 for gains above 1% and 0.0049 for
losses below -1%; only the downside log-loss interval excluded zero. It was
worse for next-day direction and every five-session event. Therefore it is
not adopted. Detailed [aggregate](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/summary.csv),
[fold](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/by-fold.csv),
[calibration](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/calibration.csv),
and [uncertainty](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/uncertainty.csv)
artifacts are retained. Keep production unchanged; require a new forward-period
replication before reconsideration, and do not tune on the prospective holdout.

#### Prospective probability tracking — Started 2026-10-07

Benchmark-only daily capture and maturity scoring are implemented. The first
snapshot contains 29 symbols × 3 events × 2 horizons (174 probabilities), all
originating on 2026-10-07; no labels have matured, so there is no prospective
score yet. Capture uses the fixed logistic configuration and the existing
corporate-action-adjusted, quality-screened close-only features. It stores
causal prior probabilities and their available outcome counts at capture time.

After the first capture, run `npm run forecast:probability-score` and then
`npm run forecast:probability-capture` after each trading-day close (16:00 IST
or later). Scoring first updates matured outcomes for the next snapshot's
causal prior. Bootstrap intervals are withheld until at least 200 distinct
forecast origins; then use paired 20-session blocks and 2,000 replicates.
Duplicate symbol/origin snapshots are rejected. This tracking is local and
benchmark-only; it does not modify production forecast output or execute
trades.

Commands: `npm run forecast:probability-capture` and
`npm run forecast:probability-score`. Snapshots and the current scorecard are
under
[`results/forecast-probability-prospective/`](../../results/forecast-probability-prospective/).
For the repeatable daily run order, checks, and evaluation milestone, see
[DAILY_RUN_TASKS.md](./DAILY_RUN_TASKS.md).

### Phase 4 — Audit Historical Sentiment Data (Blocked: Archive Unavailable)

The archive-availability audit was started on 2026-10-07. No
`FINBERT_NEWS_ARCHIVE` environment setting or local archive was found in the
workspace's conventional project data/cache locations. The only root dotenv
file found is Kite-specific and does not configure news. No external news was
fetched. This is an unavailable-data result, not an archive-quality pass or a
sentiment experiment.

Code-level readiness findings:

- The loader accepts a single-symbol archive or `GLOBAL`, requires an ISO
  timestamp with timezone and a non-empty title, and caps the file at 5 MB /
  2,000 headlines. Historical scoring excludes publication times at or after
  the forecast cutoff and deduplicates exact timestamp plus trimmed-title
  pairs.
- Historical daily sentiment requires at least three headlines in the prior
  three calendar days per covered price date; preprocessing requires 180
  covered price dates spanning at least 180 calendar days. Each fold then has
  its own minimum eligible training/test-row requirements.
- The current archive contract does not define, validate, or use per-article
  ticker, issuer, source, or relevance metadata. The code therefore cannot
  establish that `GLOBAL` headlines concern the forecast symbol or distinguish
  unrelated market news, even if an input happens to contain extra fields.
- Publication timestamp validation proves parseability and timezone syntax,
  not when the headline was first captured or whether the archived text was
  edited later. The current schema cannot certify point-in-time text
  authenticity. Synthetic unit tests prove future-timestamp exclusion, not
  real-archive coverage or forecasting value.

**Decision:** do not run a sentiment forecast ablation without a real local
archive whose symbol relevance and historical availability can be assessed.
Do not treat the existing synthetic tests as model-quality evidence. A future
eligible archive audit should report coverage by symbol/date, duplicate rate,
timestamp/timezone validity, relevant-article counts, capture/edit provenance,
the number of dates meeting the three-headline threshold, and chronological
coverage before any FinBERT scoring or model comparison. Do not fetch hosted
news or add a provider implicitly. Sentiment outputs remain distinct from
stock-return probabilities.

**Exit criteria:** retain sentiment only if point-in-time evaluation shows
repeatable out-of-sample benefit; otherwise document insufficient evidence or
reject it.

### Phase 5 — Evaluate decision usefulness separately

- If forecasting candidates survive, run a historical paper simulation with
  explicit entry/exit rules and no access to future prices at decision time.
- Include realistic brokerage, statutory charges, spread, slippage, liquidity,
  turnover and position sizing assumptions; compare with simple alternatives.
- Report drawdowns and risk as well as net results. Include a no-trade outcome.
- Keep simulation results separate from statistical forecast metrics and from
  any real brokerage activity.

**Exit criteria:** reproducible, cost-aware paper results and a user review.
This is not authorization to place live trades.

## Acceptance And Reporting

Set thresholds before each experiment, based on the benchmark and use case,
rather than selecting thresholds after seeing test outcomes. A model candidate
should not be described as improved unless it:

- beats the relevant baseline on untouched chronological evaluation data for
  the declared metric;
- shows repeatable results across multiple periods and a representative set
  of symbols, with sample counts and variation disclosed;
- does not rely on leakage, cherry-picked stocks, or a changed denominator;
- reports calibration/interval coverage honestly and retains uncertainty when
  evidence is weak.

Directional accuracy of 55% is the current Kite preview gate, not proof of
profitability or a universal model acceptance threshold. Revisit that gate only
as a separate, explicit product/safety decision after robust evaluation; never
weaken it just to make previews pass.

### Training-window comparison — complete (as of 2026-10-07)

The benchmark-only comparison evaluates 8-, 14-, and 20-month LightGBM
training windows on the same 29-symbol universe. It holds the close-only
technical feature set, quality filters, corporate-action adjustment,
three-month frozen test windows, and six-month advance constant. To keep the
test dates identical, the first common test window begins after a 20-month
history anchor; each candidate's training window ends at that same date.
Horizon-specific predictions must match on symbol, origin, target, and actual
return before aggregate metrics are reported. Each run freezes one NSE as-of
date for every window. The scorecard uses the exact shared forecast origins;
folds skipped for insufficient eligible training samples are excluded from
paired scores and reported separately in per-symbol coverage output.

All 87 window/symbol runs completed. Every window used the same as-of date
(2026-10-07) and identical test-fold boundaries. Scores use only exact shared
symbol/horizon/origin/target rows. The 14-month results from this common-date
comparison are not directly comparable to the published 14-month benchmark
that includes earlier test windows.

| Horizon | Matched samples | No-change MAPE | 8-month MAPE / direction | 14-month MAPE / direction | 20-month MAPE / direction |
|---|---:|---:|---:|---:|---:|
| 1 session | 11,957 | 1.0170% | 1.1481% / 50.36% | 1.1155% / 50.20% | 1.0995% / 50.28% |
| 5 sessions | 11,130 | 2.3775% | 2.9519% / 51.05% | 2.8420% / 50.56% | 2.7623% / 50.64% |

Paired 20-session moving-block bootstrap (2,000 replicates; changes are
candidate minus 14 months):

| Candidate | Horizon | MAPE change, pp (95% interval) | Direction change, pp (95% interval) |
|---|---:|---:|---:|
| 8 months | 1 | +0.0325 [+0.0206, +0.0429] | +0.15 [-0.85, +0.93] |
| 20 months | 1 | -0.0160 [-0.0259, -0.0069] | +0.08 [-0.78, +0.76] |
| 8 months | 5 | +0.1099 [+0.0141, +0.1919] | +0.49 [-1.38, +2.60] |
| 20 months | 5 | -0.0797 [-0.1266, -0.0250] | +0.08 [-0.76, +1.16] |

The 20-month window reduced MAPE versus 14 months on both horizons, with
paired intervals excluding zero; directional changes remain inconclusive.
Every trained window had worse MAPE than the no-change baseline. The 8-month
window also had more skipped folds: H1 11,957/12,431 eligible rows and 11
skips; H5 11,130/11,619 rows and 12 skips. The 14- and 20-month windows each
had 4 skipped folds per horizon. Per-symbol coverage is in the coverage CSV.
This is a research result, not a production change or permission to tune on
the test windows; retain the 14-month production default pending independent
validation.

Run with `npm run forecast:training-windows`. Outputs are written under
`results/forecast-training-windows/`. The as-of date is captured once in NSE
time and frozen for the run; `FORECAST_TRAINING_WINDOW_AS_OF_DATE=YYYY-MM-DD`
can set it explicitly. The earlier HTTP/1.1 partial run crossed an NSE date
boundary and remains only for audit. The corrected run shares fetched
history/actions across windows, uses a 60-second timeout, and writes a
per-symbol coverage CSV.

Corrected results: [full JSON](../../results/forecast-training-windows/training-window-benchmark-2026-10-07T18-49-00-282Z.json),
[aggregate CSV](../../results/forecast-training-windows/summary-2026-10-07T18-49-00-282Z.csv),
[paired uncertainty CSV](../../results/forecast-training-windows/uncertainty-2026-10-07T18-49-00-282Z.csv),
and [fold coverage CSV](../../results/forecast-training-windows/coverage-2026-10-07T18-49-00-282Z.csv).

## Next Steps

1. Continue the prospective probability run after each NSE trading-day close,
   scoring first and capturing second, as specified in
   [DAILY_RUN_TASKS.md](./DAILY_RUN_TASKS.md). The first snapshot already
   exists for 2026-10-07; the next run is after the next trading-day close.
2. Keep the production training window at 14 months. Before reconsidering 20
   months, predeclare a new untouched validation period and acceptance criteria;
   do not reuse the comparison holdout to select a production setting.
3. Collect outcomes until at least 200 distinct forecast-origin dates have
   matured. The first scorecard has no matured outcomes; it is a pipeline
   check, not a model result. One-session targets mature after one later
   observed session and five-session targets after five.
4. At the milestone, evaluate Brier score, log loss, calibration, and the
   paired bootstrap intervals against both the causal prior and neutral 50%
   baselines. Keep the prospective data frozen for evaluation; do not tune on
   it or change production based on immature or inconclusive results.
5. Phase 4 historical-news research remains blocked until an issuer-relevant
   archive with publication/capture provenance is available through
   `FINBERT_NEWS_ARCHIVE` or `forecastTraining.newsArchivePath`. This is
   separate from daily probability tracking; no additional F&O data is needed
   for the tracking work.

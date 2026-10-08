# Checkpoint: Five-Year Forecast History and Data-Quality Audit

Date: 2026-10-06

> Superseded metrics: NSE `DD-Mon-YYYY` corporate-action dates were not being
> parsed correctly. Phase 1/2 benchmarks were rerun after the fix; use
> [the 2026-10-07 correction checkpoint](2026-10-07-corporate-action-date-fix-volume-audit.md)
> and the corrected living context.

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Changes

- Forecast history now defaults to 60 months and accepts `historyMonths` from
  36 through 120. The selected amount of history affects walk-forward
  evaluation and residual calibration; the production fold remains 14-month
  training / 3-month testing / 6-month advance, and the final model still fits
  the latest 14 months.
- Added `history.requestedMonths` and historical data-quality diagnostics to
  forecast results and the 29-stock benchmark output. Diagnostics include raw,
  duplicate, invalid, out-of-range and non-EQ row counts; daily close changes
  above 25%; calendar intervals longer than four days; maximum observed
  interval; and corporate-action adjustment status/events.
- Explorer input validation and numeric controls accept `historyMonths` from
  36 to 120. Updated README and development handoff documentation.
- Kept Kite work paused and HOLD behavior unchanged.

## Five-Year Benchmark

Both schedules completed successfully for all 29 selected symbols, with no
symbol failures. Prediction-level artifacts are local and ignored by Git:

- Six-month schedule:
  `node_modules/.cache/forecast-benchmark/benchmark-current-schedule-2026-10-06T17-16-02-446Z.json`
- Three-month-advance diagnostic:
  `node_modules/.cache/forecast-benchmark/benchmark-gap-free-diagnostic-2026-10-06T17-21-51-941Z.json`

| Schedule | Horizon | Samples | LightGBM MAPE | No-change MAPE | Direction accuracy |
| --- | --- | ---: | ---: | ---: | ---: |
| 6-month advance | next_day | 14,442 | 1.2941% | 1.1425% | 50.28% |
| 6-month advance | week | 13,514 | 3.6748% | 2.9514% | 50.49% |
| 3-month advance | next_day | 26,506 | 1.2789% | 1.1342% | 50.19% |
| 3-month advance | week | 24,766 | 3.4749% | 2.8079% | 50.96% |

LightGBM failed to beat no-change for both horizons and schedules. The
statistical baseline also failed to beat no-change. All 27,956 predictions on
dates shared by the schedules matched exactly; the gap-free diagnostic added
23,316 predictions. Its 15 test folds per symbol and horizon were contiguous,
with no missing predictions. This does not justify changing the production
six-month advance.

## User-Approved OHLC Reversal Screen and Rerun

The user's rule flags a candle when `(high - low) / open >= 10%` and
`abs(close - open) / (high - low) <= 50%`. Raw observations remain intact;
affected 60-session feature/target windows are excluded so session indexes are
not shifted. This heuristic marks candidates, not proven bad data. The
original pre-adjustment forecast reported corporate-action adjustment as "not
applied by forecast"; the later section records the updated client behavior.

Both schedules were rerun on the 60-month history. All 29 symbols completed;
21 candidate candles were flagged across HDFCBANK, BHARTIARTL, ITC, POWERGRID,
ADANIENT, ADANIPORTS, and EICHERMOT. Folds with fewer than 120 eligible
training or 20 eligible test rows were skipped and reported.

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

Neither model beat no-change. The production schedule scored 227 folds and
skipped 5 per horizon. The diagnostic scored 428 next-day and 427 week folds,
skipping 7 and 8 respectively. Eligible-but-unscored rows were 47/29 in the
production schedule and 50/47 in the diagnostic (next-day/week). All 27,184
predictions on shared origins matched between schedules; the diagnostic added
22,922 predictions. Metrics remain provisional because split/bonus adjustment
is not applied.

## Data-Quality Audit

- Each symbol supplied exactly 1,237 observations; 35,873 rows total.
- Duplicate, invalid, out-of-range and non-EQ row counts were all zero.
- Each symbol had one calendar interval longer than four days; the maximum was
  five days. These intervals are not marked as missing sessions because
  exchange holidays are not modeled.
- Nine close-to-close changes exceeded 25% across eight symbols:
  - RELIANCE: 2024-10-25 to 2024-10-28, -49.7552%
  - HDFCBANK: 2025-08-25 to 2025-08-26, -50.4404%
  - KOTAKBANK: 2026-01-13 to 2026-01-14, -80.2588%
  - WIPRO: 2024-12-02 to 2024-12-03, -50.1069%
  - TATASTEEL: 2022-07-27 to 2022-07-28, -89.5403%
  - POWERGRID: 2023-09-11 to 2023-09-12, -27.6749%
  - ADANIENT: 2023-01-31 to 2023-02-01, -28.1970%; 2023-02-01 to
    2023-02-02, -26.6982%
  - BAJFINANCE: 2025-06-13 to 2025-06-16, -89.9475%
- Queried NSE's equity corporate-action endpoint for the flagged intervals.
  Seven intervals matched corporate actions: RELIANCE bonus 1:1, HDFCBANK
  bonus 1:1, KOTAKBANK Rs 5 to Rs 1 split, WIPRO bonus 1:1, TATASTEEL Rs 10
  to Rs 1 split, POWERGRID bonus 1:3 and BAJFINANCE Rs 2 to Rs 1 split plus
  bonus 4:1. The NSE daily closes retain the pre-action and post-action nominal
  prices, confirming the series is not adjusted across these events.
- For ADANIENT (2023-01-31 to 2023-02-02), no matching equity action was
  returned; its two large declines remain unexplained by the corporate-action
  endpoint.
- At that audit stage, action-normalized adjacent comparisons ranged from
  -3.5665% to +4.5966%; this audit-only calculation preceded the adjusted
  benchmark and is retained as historical context.

## Causal Adjustment and Adjusted Benchmark

- `NSEClient` forecasts and benchmark runs now fetch NSE equity actions and
  back-adjust pre-ex-date OHLC prices by recognized bonus/split share factors.
  Same-date events multiply; dividends are not adjusted. Provider failures or
  unparseable split/bonus terms fail explicitly. Direct `ForecastApi`
  construction without a provider remains unadjusted and reports that status.
- Eight share-adjustment records over seven ex-dates were applied. The 7
  previously confirmed >25% share-count jumps now correspond to ordinary
  action-adjusted changes from -3.57% to +4.60%.
- All 29 symbols pass objective eligibility: NSE EQ history, at least 600
  valid closes spanning the selected history, parsable corporate-action
  responses, and at least one scored fold in each horizon. No symbol is
  excluded for weak backtest metrics. ADANIENT, ADANIPORTS and EICHERMOT have
  some folds omitted for insufficient eligible samples but remain represented
  by scored folds.

| Schedule | Horizon | LightGBM samples | LightGBM MAPE | No-change MAPE | Statistical MAPE | LightGBM MAE (log-return pp) | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6-month advance | next_day | 14,044 | 1.2685% | 1.1186% | 1.1198% | 1.2024 | 50.46% | 94.74% (12,333) |
| 6-month advance | week | 13,136 | 3.6285% | 2.8958% | 2.9027% | 3.2585 | 50.64% | 93.80% (11,541) |
| 3-month advance diagnostic | next_day | 25,885 | 1.2574% | 1.1185% | 1.1194% | 1.2189 | 50.47% | 94.12% (24,191) |
| 3-month advance diagnostic | week | 24,154 | 3.4380% | 2.7616% | 2.7681% | 3.2369 | 50.71% | 93.85% (22,576) |

Neither model beat no-change, and all directions remain below the 55% preview
gate. The production schedule scored 227 folds and skipped 5 per horizon; the
diagnostic scored 428 next-day/427 week folds and skipped 7/8. Per-symbol,
per-fold MAPE, MAE in log-return percentage points, directional accuracy and
interval coverage have explicit sample denominators.

The official-action endpoint returned no matching split/bonus for ADANIENT's
2023-01-31/-28.1970% and 2023-02-01/-26.6982% moves. NSE announcements showed
an exchange clarification regarding anchor-investor allotments on 2023-01-30,
a Regulation 30 update late on 2023-02-01, and an FPO withdrawal on
2023-02-02. These are event context, not proof of causation. ADANIENT remains
eligible and the affected intraday-quality windows stay excluded.

## Verification

- `npm run test:forecast`: 63 passed, including corporate-action parser and
  provider-failure coverage.
- `npm run test:kite`: 44 passed.
- Strict TypeScript check for the benchmark/exporter and affected forecast
  source/tests: passed.
- `npm run build`: passed for ESM and CommonJS outputs.
- Final exports validated at 12 aggregate, 348 per-symbol, 1,334 per-fold,
  60 eligibility, 8 corporate-action, 21 intraday-audit, 12 matched-date
  comparison-model rows, and 2 ADANIENT investigation rows. All 58
  selected-symbol/schedule checks pass; the two explicit TATAMOTORS exclusion
  rows are false.
- Chart parses as SVG/XML; every rounded MAPE and directional label matches
  the aggregate CSV. Browser render visually checked.
- ESLint could not run because this repository has no ESLint 9 flat
  `eslint.config.*`; the existing `npm run lint` setup is incompatible with the
  installed ESLint 9 and was not changed as unrelated tooling work.
- Both five-year benchmark schedules: 29/29 symbols completed.
- Queried NSE actions and daily closes for all eight flagged symbols/date
  ranges; seven move intervals match announced bonus/split ex-dates.

## Deliverables

- [Benchmark comparison chart](../../results/forecast-benchmark-comparison.svg)
- [Benchmark results CSV](../../results/forecast-benchmark-comparison.csv)
- [Per-symbol results CSV](../../results/forecast-benchmark-by-symbol.csv)
- [Per-fold results CSV](../../results/forecast-benchmark-folds.csv)
- [Intraday reversal audit CSV](../../results/forecast-intraday-reversal-audit.csv)
- [Corporate-action audit CSV](../../results/forecast-corporate-action-audit.csv)
- [Adjusted corporate-action CSV](../../results/forecast-corporate-action-adjustment.csv)
- [Raw-vs-adjusted same-date CSV](../../results/forecast-benchmark-raw-vs-adjusted.csv)
- [Symbol eligibility CSV](../../results/forecast-benchmark-eligibility.csv)
- [ADANIENT investigation CSV](../../results/forecast-adanient-move-investigation.csv)

## Next

Phase 1 is complete for this fixed cohort and 60-month window. Next compare
36-, 60-, and longer-month history windows on the same dates, preserving a
final chronological holdout. Keep forecast signal gates and the production
fold schedule unchanged.

# Checkpoint: Forecast Benchmark Foundations

Date: 2026-10-06

> Superseded: the NSE `DD-Mon-YYYY` corporate-action date parsing defect was
> fixed on 2026-10-07 and the benchmarks were rerun. Use the corrected metrics
> and artifact links in [the 2026-10-07 correction checkpoint](2026-10-07-corporate-action-date-fix-volume-audit.md).

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Changes

- Started Phase 1 using the user's fixed NSE cohort and `next_day` / `week`
  horizons. `TATAMOTORS` was excluded after the API returned a different
  symbol, per user choice; no substitute was silently introduced.
- Factored the existing model-vs-no-change MAPE and directional-accuracy
  calculation into `src/forecast/evaluation.ts` and added hand-calculated
  tests, including exact flat-return and invalid-sample cases.
- Added a causal statistical-baseline log-return estimate for each technical
  model out-of-sample forecast origin. It uses only observations through that
  origin, allowing all three models to be scored on identical dates.
- Added `npm run forecast:benchmark`, which fetches each symbol once, scores
  LightGBM/statistical/no-change predictions at identical origins and targets,
  records per-symbol/per-horizon metrics and fold sample counts, and writes
  prediction-level output/progress under ignored
  `node_modules/.cache/forecast-benchmark`.
- No model features or forecast signal rules changed. The production/default
  six-month advance is unchanged; a separate configurable step was added for
  diagnostics only. Kite remains paused and in HOLD mode.

## Initial Benchmark Result

- 29/29 included symbols completed.
- next_day: 7,192 samples. LightGBM MAPE 1.3721%, no-change MAPE 1.2347%,
  directional accuracy 50.25%; LightGBM beat no-change for 0/29 symbols.
  Statistical-baseline MAPE 1.2363%, directional accuracy 49.83%, beat
  no-change for 10/29 symbols.
- week: 6,728 samples. LightGBM MAPE 4.2384%, no-change MAPE 3.4766%,
  directional accuracy 50.34%; LightGBM beat no-change for 0/29 symbols.
  Statistical-baseline MAPE 3.4926%, directional accuracy 49.61%, beat
  no-change for 9/29 symbols.
- Four folds per symbol/horizon had no missing predictions inside test
  windows. The schedule leaves 87 gaps per horizon across the cohort, averaging
  91.7 calendar days between test windows. Coverage is not continuous.
- Full output: `node_modules/.cache/forecast-benchmark/benchmark-2026-10-06T16-49-43-445Z.json`
  (local ignored data; not committed or checked into the repository).
- Separate three-month-advance diagnostic completed 29/29:
  - next_day: 12,383 samples; LightGBM MAPE 1.3354%, no-change 1.1951%,
    direction 50.08%, beats baseline for 0/29 symbols. Statistical baseline
    MAPE 1.1965%, direction 50.14%, beats baseline for 8/29.
  - week: 11,571 samples; LightGBM MAPE 3.8703%, no-change 3.1136%,
    direction 49.96%, beats baseline for 0/29 symbols. Statistical baseline
    MAPE 3.1259%, direction 50.38%, beats baseline for 8/29.
  - Seven contiguous folds per stock/horizon had zero missing test predictions.
    The diagnostic added 10,034 samples in formerly skipped periods.
  - All 13,920 predictions on shared dates match exactly between schedules.
    Differences in all-sample metrics come from added dates, not changes to
    predictions on existing folds. Production/default remains six months.
  - Full output:
    `node_modules/.cache/forecast-benchmark/benchmark-gap-free-diagnostic-2026-10-06T16-57-06-667Z.json`.

## Verification

- Focused forecast metric/fold/API tests: 28 passed.
- `npm run build`: passed (ESM and CommonJS).
- Benchmark runner strict TypeScript check: passed.
- Benchmark completed successfully for all 29 included symbols.

## Next

Proceed with the Phase 1 data-quality audit. Do not change production split
semantics without a separate explicit decision.

# 2026-10-07 - Prior-Fold Prediction Shrinkage Experiment

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Scope

Continued forecast-only development after the causal relative-volume candidate
and local news-archive audit. This benchmark-only experiment tests whether
shrinking LightGBM's predicted log returns toward zero can improve price-error
metrics. It does not change the public forecast, production model, prospective
holdout, or Kite HOLD behavior. No buying, selling, paper trading, or order
execution was started.

## Method

- Reused the latest corrected 60-month benchmark artifacts for the current
  14-month train / 3-month test / 6-month advance schedule and the separate
  14/3/3 gap-free diagnostic.
- Verified that all 29 successful symbol histories report corporate-action
  adjustments as applied in both source artifacts.
- Compared the existing LightGBM, same-origin statistical baseline, zero-return
  no-change baseline, and a cohort-wide causal shrinkage candidate on identical
  origin/target rows.
- For each horizon and test fold, selected a factor from 0.0 to 1.0 in 0.1
  increments using only earlier OOS predictions whose targets were observed
  strictly before that fold's test start. Fewer than 100 past observations
  selects factor 0.0. The selected factor is frozen for that fold.
- Kept all evaluation targets out of their own factor selection. The
  gap-free diagnostic shares the historical period with the primary benchmark
  and is a schedule sensitivity check, not an independent holdout.

Run with `npm run forecast:prediction-shrinkage`.

## Results

| Schedule | Horizon | Samples | LightGBM MAPE | Shrinkage MAPE | No-change MAPE | Statistical baseline MAPE |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Current 14/3/6 | Next day | 14,044 | 1.1320% | 1.0199% | 1.0194% | 1.0201% |
| Current 14/3/6 | Next 5 sessions | 13,136 | 2.8892% | 2.3503% | 2.3503% | 2.3543% |
| Gap-free 14/3/3 diagnostic | Next day | 25,885 | 1.1649% | 1.0555% | 1.0554% | 1.0557% |
| Gap-free 14/3/3 diagnostic | Next 5 sessions | 24,154 | 2.9199% | 2.4259% | 2.4244% | 2.4260% |

The chosen factor was zero in most folds and never exceeded 0.1. Shrinkage did
not beat no-change for any pooled schedule/horizon. Directional accuracy for
the candidate collapsed toward zero because zero/near-zero outputs rarely
match a nonzero realized direction.

**Decision:** reject this calibration candidate. Its small MAPE reductions
versus LightGBM mostly come from suppressing model predictions back to the
no-change forecast, not from a useful learned return signal. Leave production
forecasting and the preview gate unchanged.

Artifacts:

- [Aggregate comparison](../../results/forecast-prediction-shrinkage-comparison.csv)
- [Per-fold factors and scores](../../results/forecast-prediction-shrinkage-by-fold.csv)
- [Readable comparison chart](../../results/forecast-prediction-shrinkage-comparison.svg)

## Verification

- The analysis rejects missing benchmark coverage, unapplied corporate-action
  status, missing fold boundaries, missing statistical baselines, duplicate
  origins; the tested calibration selector excludes targets on or after the
  current test-fold start.
- Focused unit tests cover factor selection, the minimum-history no-change
  fallback, conservative tie-breaking, and the exact target-maturity boundary.
- `npm run test:forecast`: passed, 75 tests across 8 files.
- `npm run test:kite`: passed, 44 tests.
- Strict TypeScript check for the new code and `npm run build`: passed.
- `npm run forecast:prediction-shrinkage`: passed and regenerated the reported
  CSV and SVG outputs from the corrected benchmark artifacts.

## Next

Continue price-only with a predeclared LightGBM complexity comparison, fitting
candidate configurations only inside chronological training/validation windows.
Keep outer test folds and the prospective holdout untouched. Resume sentiment
only if a suitable existing local archive becomes available and passes
point-in-time provenance and issuer-relevance checks.

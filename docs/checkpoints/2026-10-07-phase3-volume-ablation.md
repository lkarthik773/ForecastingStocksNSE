# 2026-10-07 - Phase 3 Relative-Volume Ablation

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).
Corporate-action correction: [date fix and volume audit](2026-10-07-corporate-action-date-fix-volume-audit.md).

## Scope and Feature

Compared the 12-feature close-only model with one benchmark-only candidate:

`log(current daily quantity / median daily quantity over the prior 20 sessions)`

The median uses only preceding observations. Raw quantities remain in their
observed share units. To avoid using a split/bonus factor before its ex-date,
feature rows at the ex-date and following 19 observed sessions are unavailable;
the 20-session trailing baseline is therefore from the current share-unit
regime. An action after a historical origin does not affect that origin's
feature. No volume values were back-adjusted with future actions.

The internal `volume` feature-set switch does not change the public forecast
contract or default model.

## Benchmark and Results

- 29 symbols, 60-month history; rolling 14-month train / 3-month frozen test /
  6-month advance; evaluation cutoff exclusive 2026-04-06.
- Same corporate-action-adjusted close data, reversal screen, baseline models
  and model configuration as prior feature ablations.
- 58/58 symbol/feature runs completed without errors.
- Exact common origin/target pairs: 13,913 next-day and 13,010 five-session
  pairs, across all 29 symbols (2022-06-06 through 2026-03-04).
- This experiment evaluates next-day and five-session targets from daily bars;
  it does not evaluate an intraday forecast made while the market is open.

| Horizon | Feature set | MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Close-only control | 1.1650% | 1.0477% | 50.32% | 95.86% |
| Next day | Relative-volume candidate | 1.1662% | 1.0477% | 49.97% | 95.92% |
| Next 5 sessions | Close-only control | 2.9979% | 2.4383% | 50.38% | 95.79% |
| Next 5 sessions | Relative-volume candidate | 2.9919% | 2.4383% | 50.30% | 95.56% |

Volume was lower-MAPE than close-only for 13/29 symbols next day and 17/29
for five sessions, but lower than no-change for 0/29 symbols at either
horizon. Fold eligibility reported 163 unavailable training and 245
unavailable test rows across both horizons due to action warmup/feature
availability. These are fold-row counts, not unique dates.

**Decision:** reject the feature for production. Its five-session MAPE
reduction versus close-only was only 0.0059 percentage points, the next-day
MAPE was worse, direction declined slightly at both horizons, and neither
version beat no-change. Leave the public model, preview criteria, prospective
holdout and Kite HOLD behavior unchanged.

## Outputs

- [Aggregate comparison](../../results/forecast-volume-ablation-comparison.csv)
- [Per-symbol metrics](../../results/forecast-volume-ablation-by-symbol.csv)
- [Fold eligibility and feature availability](../../results/forecast-volume-ablation-eligibility.csv)
- [Readable chart](../../results/forecast-volume-ablation-comparison.svg)
- Repeatable commands: `npm run forecast:volume-ablation` and
  `npm run forecast:volume-ablation:export`

The next forecast-only step is the local historical headline archive
availability and point-in-time coverage audit. Do not start buy/sell strategy
work; the forecast has not demonstrated an improvement over no-change.

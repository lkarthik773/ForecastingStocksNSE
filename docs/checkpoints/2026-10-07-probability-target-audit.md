# 2026-10-07 - Probability Target Foundation Audit

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).
Source proposal: [Feed Stock 2 Forecast Model](../development/feedtstock2forecastmodel.md).

## Proposal Review

The proposal was checked against existing code and benchmark decisions before
starting new work. Already implemented or tested: LightGBM, chronological
walk-forward validation, corporate-action adjustment and data-quality
reporting, close-derived trend/momentum/volatility indicators, five OHLC
candle features, one relative-volume feature, and a four-feature NIFTYBEES
market proxy. The tested OHLC, volume, market-context, advanced technical and
prior-fold shrinkage candidates did not beat no-change and remain unadopted.

Still unimplemented or blocked: calibrated probabilities for direction and
threshold events; sector-index history and relative strength; true intraday
VWAP/time-of-day features; F&O/open interest; and comparison against other
tree model families. Daily data does not supply true VWAP or time-of-day
features. Existing headline data is unavailable and fails the current
point-in-time provenance/relevance prerequisites. Trading rules and orders
remain paused.

## Work Started: Probability Outcome Baselines

The existing result artifacts contain next-day and five-session walk-forward
targets, but not three-session results. Defined auditable labels from simple
returns:

- `up`: return strictly above 0%;
- `gain_over_1pct`: return strictly above +1%;
- `loss_below_minus_1pct`: return strictly below -1%.

For every test fold, a prior-only prevalence probability is estimated from
earlier OOS outcomes of the same horizon whose target dates are strictly
before the fold start. The probability uses Laplace smoothing after 100
matured outcomes; before that it falls back to 50%. Brier score and log loss
are computed on the test fold. This baseline contains no stock features and
is not a learned forecast model.

Primary current 14-month train / 3-month test / 6-month advance results:

| Horizon | Event | Samples | Observed rate | Prior-only Brier | Prior-only log loss |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Return > 0% | 14,044 | 49.70% | 0.2504 | 0.6940 |
| Next day | Return > +1% | 14,044 | 19.40% | 0.1694 | 0.5206 |
| Next day | Return < -1% | 14,044 | 18.73% | 0.1628 | 0.5055 |
| Next 5 sessions | Return > 0% | 13,136 | 50.61% | 0.2521 | 0.6974 |
| Next 5 sessions | Return > +1% | 13,136 | 35.47% | 0.2373 | 0.6682 |
| Next 5 sessions | Return < -1% | 13,136 | 34.54% | 0.2292 | 0.6513 |

These class rates are cohort aggregates, not stock-specific priors. Daily and
five-session outcomes overlap in time. The additional gap-free schedule covers
the same history and is only a schedule sensitivity check. The 3-session
horizon was deliberately not inferred from 1- and 5-session outcomes.

No production API output, model, no-change gate, prospective holdout, or Kite
behavior changed. The following files provide the reproducible audit:

- [Aggregate CSV](../../results/forecast-probability-target-audit.csv)
- [Per-fold CSV](../../results/forecast-probability-target-audit-by-fold.csv)
- Run command: `npm run forecast:probability-target-audit`

## Probability Classifier Benchmark — Completed

A benchmark-only standardized logistic classifier now reuses the exact
close-only technical feature vectors, data-quality masks, and frozen
14-month-train / 3-month-test / 6-month-advance folds in `trainForecast`.
Separate classifiers predict each of the three audited events for next-day
and five-session outcomes. Each fold requires at least 10 positive and 10
negative training labels; probabilities are scored only on the existing
eligible outer-test rows.

The runner reports Brier score, log loss, event counts/rates, fixed-width
calibration bins, fold metrics, and paired 20-session moving-block-bootstrap
intervals. Comparators are the existing causal prior-only prevalence and a
neutral 50% probability. The learned-model choice is fixed (logistic
regression, train-only standardization, L2 penalty 0.01); no tuning is done on
the prospective holdout. The probability task is opt-in for benchmark code
only; public forecast output and Kite behavior are unchanged.

- Run command: `npm run forecast:probability-classifier`
- Detailed progress and timestamped prediction/metric artifacts are written
  under `results/forecast-probability-classifier/`.
- Do not infer a three-session horizon from these labels.

### Current-schedule results

Run completed on 2026-10-07 for all 29 symbols. The candidate produced 14,044
next-day and 13,136 five-session predictions for each event. Its distinct
symbol/origin/horizon keys exactly match the corrected regression benchmark's
27,180 corresponding outcomes. Brier and log-loss deltas below are
classifier-minus-prior; negative favors the classifier. Confidence intervals
are paired 20-session moving-block bootstrap 95% intervals with 2,000
replicates.

| Horizon | Event | Events / samples | Classifier Brier | Prior Brier | Δ Brier [95% CI] | Classifier log loss | Prior log loss | Δ log loss [95% CI] |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Next day | Return > 0% | 6,980 / 14,044 | 0.2598 | 0.2504 | +0.0094 [+0.0075, +0.0108] | 0.7163 | 0.6940 | +0.0223 [+0.0178, +0.0258] |
| Next day | Return > +1% | 2,725 / 14,044 | 0.1653 | 0.1694 | -0.0041 [-0.0062, -0.0017] | 0.5192 | 0.5206 | -0.0014 [-0.0069, +0.0063] |
| Next day | Return < -1% | 2,631 / 14,044 | 0.1579 | 0.1628 | -0.0049 [-0.0073, -0.0036] | 0.5004 | 0.5055 | -0.0051 [-0.0105, -0.0009] |
| Next 5 sessions | Return > 0% | 6,648 / 13,136 | 0.2788 | 0.2521 | +0.0267 [+0.0186, +0.0287] | 0.7734 | 0.6974 | +0.0760 [+0.0539, +0.0812] |
| Next 5 sessions | Return > +1% | 4,659 / 13,136 | 0.2604 | 0.2373 | +0.0231 [+0.0172, +0.0266] | 0.7384 | 0.6682 | +0.0702 [+0.0535, +0.0785] |
| Next 5 sessions | Return < -1% | 4,537 / 13,136 | 0.2498 | 0.2292 | +0.0206 [+0.0125, +0.0231] | 0.7180 | 0.6513 | +0.0667 [+0.0459, +0.0782] |

The classifier is worse for next-day direction and all three five-session
events. It modestly improves next-day threshold-event Brier scores over the
prior-only baseline; the log-loss interval excludes zero only for downside
events. The neutral 50% reference is beaten on next-day thresholds, but that
does not offset the weak direction result or five-session degradation.

**Decision:** do not adopt this model in production and do not change API or
Kite behavior. Keep the candidate fixed and require a new forward-period
replication before considering it further; do not tune against the prospective
holdout.

Artifacts:

- [Aggregate scores](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/summary.csv)
- [Per-fold scores](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/by-fold.csv)
- [Calibration bins](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/calibration.csv)
- [Bootstrap uncertainty](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/uncertainty.csv)
- [Prediction-level results](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/predictions.json)

## Prospective Replication — Tracking Started

To avoid tuning against the historical sample, a separate snapshot path now
fits the same frozen close-only logistic models on the latest completed
14-month label window. It records 1-session and 5-session probabilities for
all three events, the causal prior probability and its sample count, the model
version, and the symbol/origin date. This path applies the forecast's normal
corporate-action normalization and quality checks, and does not run or alter
production forecasts.

The first live capture completed after the 2026-10-07 NSE close: 29 symbols,
174 probabilities, all with origin date 2026-10-07. No target has matured yet;
the scorecard correctly reports zero scored rows and 29 pending symbol targets
per horizon. This is capture validation, not evidence of predictive skill.

Run procedure (after 16:00 IST):

1. First session only: `npm run forecast:probability-capture`.
2. On each later trading session: run
   `npm run forecast:probability-score` first, then
   `npm run forecast:probability-capture`. Scoring first updates matured
   outcomes used by that session's causal-prior predictions.
3. Continue unchanged until at least 200 distinct forecast origins are
   available. Until then, report scores but do not emit bootstrap intervals.
   At 200 or more origins, report paired 20-session block-bootstrap intervals
   with 2,000 replicates.

Snapshots append under
`results/forecast-probability-prospective/snapshots/`. The latest
`scorecard.csv`, `calibration.csv`, `uncertainty.csv`, prediction-level
`scorecard.json`, and `matured-outcomes.json` are stored in the prospective
results directory. A second capture for an already-used symbol/origin is
rejected rather than overwriting the record.

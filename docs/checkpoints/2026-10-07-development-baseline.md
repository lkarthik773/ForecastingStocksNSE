# Development Checkpoint 1: Forecasting Baseline

**As of:** 2026-10-07  
**Purpose:** Record the forecasting development completed to date and establish
the starting baseline for subsequent work.

This checkpoint is a documentation baseline, not a git commit. Detailed
protocols and per-experiment artifacts remain in the linked status and plan
documents.

## Product state

No experimental feature or probability model has been adopted into production.
Public forecast behavior, forecast gates, and trading behavior remain
unchanged. The development objective remains measurable out-of-sample forecast
improvement; benchmark results alone do not establish readiness to deploy.

## Completed work and decisions

### Corrected technical forecast evaluation

The historical-date parser issue that skipped some corporate-action
adjustments was fixed, and the affected benchmark results were regenerated.
The current 29-symbol technical benchmark still does not beat the no-change
baseline on pooled MAPE:

| Horizon | Technical MAPE | No-change MAPE | Technical direction |
|---|---:|---:|---:|
| Next day | 1.1320% | 1.0194% | 50.36% |
| Five sessions | 2.8892% | 2.3503% | 50.43% |

Phase 3 feature experiments (OHLC, market context, volume, advanced technical
features, and prediction shrinkage) did not establish a general improvement.
They remain unadopted. The [forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md)
contains the protocols and detailed results.

### F&O data and model experiments

Thirteen symbol archives were validated, and the importer supports both
recognized NSE layouts. The expanded 14-variant comparison completed on
9,502 matched symbol-origin pairs. Its predeclared unseen-symbol test
(`options_only` versus `technical`, eight added symbols) produced:

- Direction change: +1.33 percentage points; 95% moving-block interval
  [-0.79, +4.07] points.
- MAPE change: -0.108 percentage points; 95% interval [-0.164, -0.045].
- The direction interval includes zero, so the predeclared success criterion
  was not met. No F&O feature was promoted.

The raw archives remain in `downloads/`. No additional archive data is needed
for probability tracking. See [F&O integration status](../fno/FNO_INTEGRATION_STATUS.md)
for archive details, validation, and all comparison results.

### Historical probability classifier

A standardized logistic classifier was evaluated on the same 29-symbol,
27,180 symbol/origin/horizon outcomes as the corrected benchmark. It modestly
improved next-day threshold-event Brier scores versus the causal prior, but
was worse on next-day direction and all five-session events. It was not
adopted; production remains unchanged. Full scores and confidence intervals
are in the [probability target audit](./2026-10-07-probability-target-audit.md).

### Prospective probability tracking

The fixed benchmark-only prospective procedure is implemented. The first
snapshot, captured after the 2026-10-07 NSE close, contains 29 symbols and 174
probabilities (three events across two horizons). No outcomes had matured at
the initial score, so that scorecard is only a pipeline check, not model
evidence.

On each following NSE trading day, run `npm run forecast:probability-score`
first and `npm run forecast:probability-capture` second, at or after 16:00 IST.
The capture fits the fixed classifier using the latest 14-month training
window; there is no separate daily training command. The scorer requires at
least 200 distinct matured forecast-origin dates before reporting bootstrap
intervals. This is approximately 200 trading sessions, not 200 symbol rows.
Follow the [daily run checklist](../development/DAILY_RUN_TASKS.md).

## Validation baseline

The recorded focused validation passed:

- Package build and benchmark-script type-check.
- 11 probability/snapshot-focused tests.
- 28 forecast and corporate-action regression tests.
- F&O/data/training regression tests and refinement-focused tests, as detailed
  in the [F&O status](../fno/FNO_INTEGRATION_STATUS.md).

ESLint was not successfully run because the installed ESLint 9 setup does not
load the repository's legacy `.eslintrc.js` configuration. No lint
configuration change was made.

## Starting point for next development

1. Resume after the next NSE trading-day close with the score-then-capture
   sequence in [DAILY_RUN_TASKS.md](../development/DAILY_RUN_TASKS.md).
2. Preserve prospective predictions as a frozen evaluation set; do not tune
   the classifier against it.
3. At the 200-distinct-origin milestone, evaluate each event and horizon
   against both the causal prior and neutral 50% baseline using Brier score,
   log loss, calibration, and paired uncertainty intervals.
4. Keep production unchanged unless a future result demonstrates a
   repeatable, predeclared improvement.
5. Historical-news research remains blocked until a relevant, point-in-time
   archive is available. This is separate from the daily probability run.

The earlier [Top 6 opportunities list](../fno/Top%206%20Opportunities%20for%20Better%20Forecasti.txt)
is a proposal backlog, not validated expected gains. The F&O and probability
items have since been tested; their current status is summarized above.

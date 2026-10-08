# 2026-10-07 - Phase 3 OHLC Feature Ablation

> Superseded metrics: benchmark results were regenerated after fixing NSE
> `DD-Mon-YYYY` corporate-action parsing. See
> [the correction checkpoint](2026-10-07-corporate-action-date-fix-volume-audit.md)
> for authoritative metrics and artifacts.

## Scope

Started Phase 3 with one point-in-time, causal feature experiment. Compared the
existing 12 close-only technical inputs against the same model with five daily
OHLC-derived inputs:

- intraday range divided by close;
- log close/open return;
- close location within the day's range;
- log opening gap from the prior close;
- 20-session average daily range divided by close.

No volume, market-context, sentiment, target, LightGBM hyperparameter, sample,
fold schedule, or preview-gate changes were included. Features are computed
from completed daily candles only. The production forecast API has no new
feature-set parameter; the OHLC option is an internal benchmark hook.

## Benchmark

- 29 NSE symbols, 60-month history, next-day and five-session horizons.
- Causal split/bonus adjustments and the existing intraday-reversal screen.
- Rolling 14-month training, 3-month frozen tests, 6-month advances.
- Evaluation cutoff exclusive: 2026-04-06. This is development data, not the
  reserved prospective holdout.
- All 58 model runs completed with zero errors. OHLC was available on all
  audited observations.
- Matched common samples: 13,997 next-day and 13,089 five-session pairs,
  2022-06-06 through 2026-03-04.

| Horizon | Feature set | MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Close-only | 1.3501% | 1.2089% | 50.20% | 95.65% |
| Next day | OHLC | 1.3505% | 1.2089% | 49.85% | 95.78% |
| Next 5 sessions | Close-only | 4.0516% | 3.2847% | 50.39% | 94.95% |
| Next 5 sessions | OHLC | 4.0000% | 3.2847% | 50.08% | 94.96% |

OHLC MAPE was lower than close-only for 16/29 symbols at each horizon, but
neither feature set beat no-change for any symbol (0/29). The slight
five-session pooled MAPE reduction does not establish repeatable benefit;
next-day MAPE and both directional scores were worse with OHLC. Keep the
close-only production model and all safety gates unchanged.

## Implementation and Outputs

- Added causal OHLC feature generation and fold-level counts for unavailable
  experimental inputs to `src/forecast/trained-forecast.ts`.
- Historical normalization retains valid OHLC rows for training while
  preserving close-only as the default. Corporate-action adjustment is applied
  before normalization and feature generation.
- Added the internal benchmark switch in `src/forecast/forecast-api.ts`.
- Added scripts and npm commands:
  `forecast:feature-ablation` and `forecast:feature-ablation:export`.
- Added a causality test proving future OHLC edits do not change earlier
  frozen-fold forecasts.
- Published aggregate, per-symbol, eligibility CSVs and readable SVG in
  `results/forecast-feature-ablation-*`.
- Updated `docs/development/FORECAST_IMPROVEMENT_PLAN.md`, the main
  `docs/development/CONTEXT.md`, and README commands.

## Verification

- `npm run test:forecast`: 65 tests passed across seven files.
- `npm run test:kite`: 44 tests passed.
- `npm run typecheck:kite`: passed.
- Strict TypeScript check for experiment source/scripts/tests: passed.
- `npm run build`: ESM and CommonJS build passed.
- Exported SVG parsed as XML and its MAPE labels matched the CSV.

## Next

Continue Phase 3 with a separate causal broad-market-context ablation. Verify
the historical source and as-of coverage first. Do not combine context with
OHLC or sentiment; use the same control, symbols, schedule, baselines, and
matched-origin comparison. Keep the prospective holdout reserved and Kite in
HOLD mode.

# 2026-10-07 - Phase 3 Advanced Technical Ablation

> Superseded metrics: benchmark results were regenerated after fixing NSE
> `DD-Mon-YYYY` corporate-action parsing. See
> [the correction checkpoint](2026-10-07-corporate-action-date-fix-volume-audit.md)
> for authoritative metrics and artifacts.

## Scope

Compared the 12-feature close-only LightGBM control with an experimental
close-only candidate that adds:

- 5-session realized volatility;
- 60-session realized volatility;
- 20-session downside volatility;
- 20-session lag-one return autocorrelation;
- 20-session trend efficiency.

These are computed from returns available at the forecast origin. The
candidate adds no OHLC, volume, broad-market, or sentiment inputs. Its
61-close warmup excludes one initial training row per scored fold and no test
rows. The public forecast contract and production model remain unchanged.

## Benchmark

- 29 NSE equities; 60-month history; next-day and five-session horizons.
- Rolling 14-month training, 3-month frozen test, 6-month advance.
- Causal split/bonus adjustment and the existing intraday-reversal screen.
- Development cutoff exclusive: 2026-04-06; prospective holdout not fetched or
  scored.
- All 58 model runs completed without errors.
- Matched samples: 13,997 next-day and 13,089 five-session origin/target pairs,
  across all 29 symbols, from 2022-06-06 through 2026-03-04.

| Horizon | Feature set | MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Close-only | 1.3501% | 1.2089% | 50.20% | 95.65% |
| Next day | Advanced technical | 1.3740% | 1.2089% | 49.79% | 95.47% |
| Next 5 sessions | Close-only | 4.0516% | 3.2847% | 50.39% | 94.95% |
| Next 5 sessions | Advanced technical | 4.0753% | 3.2847% | 50.58% | 94.64% |

The candidate increased pooled MAPE by about 0.024 percentage points at both
horizons. MAPE was lower than close-only for only 8/29 symbols next day and
12/29 for five sessions. Direction fell 0.41 percentage points next day and
rose 0.19 points for the week, remaining close to chance. Neither control nor
candidate beat no-change for any symbol or pooled horizon.

**Decision:** reject the advanced technical feature group for production.
Keep close-only as the active model and preserve all current forecast-preview
and Kite HOLD gates.

## Implementation and Outputs

- Added the `advanced_technical` benchmark-only feature set and causal
  calculations in `src/forecast/trained-forecast.ts`.
- Added direct feature-boundary and future-price invariance tests.
- Added benchmark and export commands:
  `forecast:advanced-technical-ablation` and
  `forecast:advanced-technical-ablation:export`.
- Published aggregate, per-symbol, eligibility CSVs and a readable SVG at
  `results/forecast-advanced-technical-ablation-*`.
- Updated the README command table, forecast improvement plan and main
  development context.

## Verification

- `npm run forecast:advanced-technical-ablation`: 58/58 runs, zero errors.
- `npm run forecast:advanced-technical-ablation:export`: exported matched
  results for 13,997/13,089 pairs.
- `npm run test:forecast`: 69 tests passed across seven files.
- `npm run test:kite`: 44 tests passed.
- `npm run typecheck:kite`: passed.
- Strict TypeScript check for affected source, scripts and tests: passed.
- `npm run build`: ESM and CommonJS builds passed.
- Future-data invariance test passed; chart labels and sample counts were
  checked against the aggregate CSV.

## Next

Audit historical volume availability, validity, and corporate-action
consistency before deciding whether volume-derived features are suitable for a
separate benchmark. Keep the prospective holdout reserved and do not change
production forecasting or Kite safety gates based on this experiment.

# 2026-10-07 - Phase 3 Market-Context Ablation

> Superseded metrics: benchmark results were regenerated after fixing NSE
> `DD-Mon-YYYY` corporate-action parsing. See
> [the correction checkpoint](2026-10-07-corporate-action-date-fix-volume-audit.md)
> for authoritative metrics and artifacts.

## Scope

Compared the existing 12-feature close-only LightGBM control against an
experimental model adding four causal NIFTYBEES features:

- same-session proxy log return;
- five-session proxy log return;
- 20-session proxy log return;
- 20-session proxy-return volatility.

The four features require exact date matching and use only proxy closes through
the forecast origin. OHLC and sentiment were not combined with this candidate.
The production model, public forecast parameters, Kite gates and HOLD behavior
were not changed.

## Benchmark

- 29 NSE equities; 60-month history; next-day and five-session horizons.
- Rolling 14-month training, 3-month frozen test, 6-month advance.
- Causal split/bonus handling and the existing reversal-candle screen.
- Development cutoff exclusive: 2026-04-06; reserved prospective holdout not
  fetched or scored.
- NIFTYBEES supplied 1,239 sessions, 2021-04-05 through 2026-04-02, with zero
  recognized split/bonus adjustments.
- All 58 model runs completed without errors. No eligible train/test row
  lacked a same-date market close or sufficient proxy lookback.
- Matched-date sample: 13,997 next-day and 13,089 five-session
  origin/target pairs, across all 29 symbols, from 2022-06-06 through
  2026-03-04.

| Horizon | Feature set | MAPE | No-change MAPE | Direction accuracy | Interval coverage |
| --- | --- | ---: | ---: | ---: | ---: |
| Next day | Close-only | 1.3501% | 1.2089% | 50.20% | 95.65% |
| Next day | Market context | 1.3498% | 1.2089% | 49.80% | 95.69% |
| Next 5 sessions | Close-only | 4.0516% | 3.2847% | 50.39% | 94.95% |
| Next 5 sessions | Market context | 4.0293% | 3.2847% | 49.68% | 95.64% |

Market context reduced pooled MAPE versus close-only by only 0.0003 percentage
points next day and 0.0223 points for five sessions. Its MAPE was lower than
close-only for 14/29 symbols next day and 17/29 symbols for five sessions.
Neither model beat no-change for any symbol or pooled horizon, and market
context lowered directional accuracy at both horizons. Direction remained
below the 55% preview gate. Better five-session interval coverage is not proof
of future calibration.

**Decision:** reject this feature group for production for now. Keep close-only
as the production model and keep the no-change gate and Kite HOLD behavior
unchanged. The market-context mode remains internal to the benchmark switch.

## Implementation and Outputs

- Added market feature construction and availability accounting to
  `src/forecast/trained-forecast.ts`, with market rows supplied by the existing
  forecast context path.
- Added the NIFTYBEES market-context benchmark and matched-date exporter, plus
  npm commands `forecast:market-context-ablation` and
  `forecast:market-context-ablation:export`.
- Added a test ensuring later market-price changes cannot alter an earlier
  frozen test-fold forecast.
- Published aggregate metrics, per-symbol results, eligibility and a readable
  chart under `results/forecast-market-context-ablation-*`.
- Updated the forecast improvement plan, development context and README command
  table.

## Verification

- `npm run forecast:market-context-ablation`: 58/58 completed, zero errors.
- `npm run forecast:market-context-ablation:export`: exported matched results
  for 13,997/13,089 pairs.
- `npm run test:forecast`: 67 tests passed across seven files.
- `npm run test:kite`: 44 tests passed.
- `npm run typecheck:kite`: passed.
- `npm run build`: ESM and CommonJS builds passed.
- Market feature future-data invariance test passed.
- SVG labels and sample counts were checked against the exported comparison
  CSV.

## Next

Continue Phase 3 with a distinct group of causal technical features. Do not
combine OHLC, NIFTYBEES context, or sentiment. Keep the prospective holdout
reserved; do not change production forecasting or Kite safety gates unless
subsequent evidence and explicit user authorization justify it.

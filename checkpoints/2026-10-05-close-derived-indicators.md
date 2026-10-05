# Checkpoint: Close-Derived Forecast Indicators

Date: 2026-10-05

Living context: [Development Context](../DEVELOPMENT_CONTEXT.md).
Status: implemented in the shared working tree; not committed or released.

## Change

Expanded the technical LightGBM model from eight to twelve causal features:

- Bollinger %B (20-session bands, two standard deviations)
- Bollinger bandwidth (20-session bands)
- 10-session log return
- 20-session log return

The original return, moving-average, RSI, MACD-histogram, and volatility
features remain. Current indicator values are returned with the forecast and
the feature names appear in model metadata. The optional FinBERT joint model
adds its two sentiment features on top of these twelve.

Only historical closes are retained by the forecast observation pipeline, so
these additions are close-derived. ATR, ADX, OBV, VWAP, and other indicators
that require high, low, or volume data are not part of this change. BSE stock
forecasting remains unsupported.

## Verification

- `npx vitest run tests/nse/trained-forecast.test.ts`: 4 tests passed, including
  LightGBM fitting and frozen-fold causal invariance.
- `npm run test:forecast`: 46 tests passed across six files, including joint
  FinBERT training and explorer coverage.
- `npm run build`: ESM and CommonJS builds passed.
- No comparative backtest was run to establish that these features improve
  forecasting accuracy. Existing TCS evidence still showed the model did not
  beat the no-change baseline.
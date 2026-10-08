import type { ForecastResult } from '../../src/forecast/forecast-api.js';

export type ForecastReportInput = Pick<
  ForecastResult,
  | 'symbol'
  | 'generatedAt'
  | 'lastClose'
  | 'context'
  | 'model'
  | 'analysis'
  | 'forecast'
  | 'summary'
  | 'backtest'
>;

function signedPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function trendLabel(
  close: number,
  sma20: number,
  sma50: number
): string {
  if (close > sma20 && sma20 > sma50) return 'BULLISH';
  if (close < sma20 && sma20 < sma50) return 'BEARISH';
  return 'MIXED';
}

export function formatForecastReport(result: ForecastReportInput): string {
  const oneSession = result.forecast.find(
    (point) => point.tradingSession === 1
  );
  const threeSessions = result.forecast.find(
    (point) => point.tradingSession === 3
  );
  if (!oneSession || !threeSessions)
    throw new Error(
      'The forecast report requires one- and three-session forecast points.'
    );

  const market = result.context?.market;
  const marketSummary =
    market?.status === 'available' &&
    market.recentChange5Pct !== null &&
    Number.isFinite(market.recentChange5Pct)
      ? `${signedPercent(market.recentChange5Pct)} over 5 sessions (${market.proxy} proxy; overlay ${market.applied ? 'applied' : 'not applied'})`
      : 'Unavailable';

  return [
    result.symbol,
    `As of close ${result.lastClose.date} | Generated ${result.generatedAt}`,
    '',
    'Next 1D',
    'UP probability       Not validated',
    'DOWN probability     Not validated',
    `Expected return      ${signedPercent(oneSession.expectedChangePct)}`,
    '',
    'Next 3D (trading sessions)',
    '> +1% probability    Not validated',
    '< -1% probability    Not validated',
    `Expected return      ${signedPercent(threeSessions.expectedChangePct)}`,
    '',
    `Trend                ${trendLabel(result.lastClose.price, result.analysis.sma20, result.analysis.sma50)} (close vs SMA20/SMA50)`,
    `Market               ${marketSummary}`,
    'Sector               Not available; no validated sector input',
    'Volume               Not used by the current model',
    `Volatility           ${result.model.dailyVolatilityPct.toFixed(2)}% daily (model estimate)`,
    `Forecast signal      ${result.summary.signal.toUpperCase()}`,
    'Model confidence     Not calibrated; no score reported',
    '',
    'Historical performance of similar setups:',
    'Not available; similar setups have not been evaluated out of sample.',
    '',
    `${result.backtest.horizonSessions}-session walk-forward diagnostics:`,
    `Sample size: ${result.backtest.samples}`,
    `Directional accuracy: ${result.backtest.directionalAccuracyPct.toFixed(1)}%`,
    `Model MAPE: ${result.backtest.meanAbsolutePercentageError.toFixed(2)}%`,
    `No-change MAPE: ${result.backtest.naiveMeanAbsolutePercentageError.toFixed(2)}%`,
    `Beat no-change baseline: ${result.backtest.beatsNaive ? 'Yes' : 'No'}`,
    '',
    'Threshold probabilities and confidence scores are withheld until calibrated and validated.',
    'This experimental forecast is not investment advice.',
  ].join('\n');
}

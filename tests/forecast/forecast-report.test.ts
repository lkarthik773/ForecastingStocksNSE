import { describe, expect, it } from 'vitest';
import type { ForecastReportInput } from '../../scripts/forecast/report-format.js';
import { formatForecastReport } from '../../scripts/forecast/report-format.js';

function reportInput(): ForecastReportInput {
  return {
    symbol: 'RELIANCE',
    generatedAt: '2026-10-08T01:00:00.000Z',
    lastClose: { date: '2026-10-07', price: 150 },
    context: {
      asOf: '2026-10-08T01:00:00.000Z',
      market: {
        provider: 'NSE',
        proxy: 'NIFTYBEES',
        status: 'available',
        observations: 100,
        applied: true,
        beta: 1.1,
        recentChange5Pct: 1.25,
        volatilityRatio: 0.9,
        dailyDriftAdjustmentPct: 0.01,
      },
      news: {
        provider: 'Local archive',
        status: 'not_configured',
        scope: 'RELIANCE',
        requestedFrom: '2026-09-24',
        requestedTo: '2026-10-08',
        articles: [],
        scoredArticles: 0,
        averagePolarity: null,
        todayArticles: 0,
        sampleLimited: false,
        sentimentEngine: 'off',
        sentimentStatus: 'not_requested',
      },
      warnings: [],
      newsVarianceMultiplier: 1,
      elevatedRisk: false,
    },
    model: {
      name: 'LightGBM rolling technical-indicator model',
      dailyDriftPct: 0.1,
      dailyVolatilityPct: 1.25,
      intervalAssumptions: 'Past out-of-sample errors.',
    },
    analysis: { sma20: 140, sma50: 130 },
    forecast: [
      {
        tradingSession: 1,
        estimatedClose: 151,
        expectedChangePct: 0.67,
        estimatedDirection: 'up',
        predictionInterval95: { lower: 145, upper: 157 },
      },
      {
        tradingSession: 2,
        estimatedClose: 152,
        expectedChangePct: 1.33,
        estimatedDirection: 'up',
        predictionInterval95: { lower: 144, upper: 160 },
      },
      {
        tradingSession: 3,
        estimatedClose: 153,
        expectedChangePct: 2,
        estimatedDirection: 'up',
        predictionInterval95: { lower: 142, upper: 164 },
      },
    ],
    summary: {
      estimatedDirection: 'up',
      signal: 'uncertain',
      expectedChangePct: 2,
      reason: 'Test forecast.',
    },
    backtest: {
      horizonSessions: 3,
      samples: 250,
      qualityExcludedSamples: 0,
      unscoredEligibleSamples: 0,
      meanAbsolutePercentageError: 1.2,
      naiveMeanAbsolutePercentageError: 1.1,
      directionalAccuracyPct: 52,
      intervalCoveragePct: 95,
      beatsNaive: false,
      includesNews: false,
    },
  };
}

describe('formatForecastReport', () => {
  it('formats forecasts while withholding unsupported probability claims', () => {
    const report = formatForecastReport(reportInput());
    expect(report).toContain('UP probability       Not validated');
    expect(report).toContain('Expected return      +0.67%');
    expect(report).toContain('> +1% probability    Not validated');
    expect(report).toContain('Expected return      +2.00%');
    expect(report).toContain('Trend                BULLISH (close vs SMA20/SMA50)');
    expect(report).toContain('NIFTYBEES proxy; overlay applied');
    expect(report).toContain('Sample size: 250');
    expect(report).toContain('Beat no-change baseline: No');
    expect(report).toContain('similar setups have not been evaluated out of sample');
  });

  it('reports missing context and refuses a forecast without required horizons', () => {
    const input = reportInput();
    const { context: _context, ...withoutContext } = input;
    const noContextReport = formatForecastReport(withoutContext);
    expect(noContextReport).toContain('Market               Unavailable');
    expect(noContextReport).toContain('Sector               Not available');

    expect(() =>
      formatForecastReport({
        ...input,
        forecast: input.forecast.filter((point) => point.tradingSession !== 3),
      })
    ).toThrow('requires one- and three-session forecast points');
  });
});

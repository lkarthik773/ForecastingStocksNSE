import { describe, expect, it, vi } from 'vitest';
import { ForecastApi } from '../../src/forecast/index.js';
import { ForecastApi as NseForecastApi } from '../../src/nse/index.js';
import type { ForecastContext } from '../../src/forecast/forecast-context-api.js';

const NOW = new Date('2026-10-05T06:00:00Z');
function history(drift = 0.001, noise = 0) {
  const rows: Record<string, unknown>[] = [];
  let price = 100;
  for (
    const date = new Date('2023-10-05T00:00:00Z');
    date < NOW;
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    price *= Math.exp(drift + noise * Math.sin(rows.length * 1.7));
    rows.push({
      mtimestamp: date.toISOString().slice(0, 10),
      chClosingPrice: price,
      chSymbol: 'TCS',
      chSeries: 'EQ',
    });
  }
  return rows;
}
function setup(rows = history()) {
  const fetchEquityHistoricalData = vi.fn().mockResolvedValue(rows);
  const api = new ForecastApi({ fetchEquityHistoricalData }, () => NOW);
  return { api, fetchEquityHistoricalData };
}

describe('stock forecast', () => {
  it('preserves the existing NSE forecast export after module separation', () => {
    expect(NseForecastApi).toBe(ForecastApi);
  });

  it('runs the three-year LightGBM API with the requested rolling fold schedule', async () => {
    const result = await setup().api.forecastStock({
      symbol: 'TCS',
      model: 'technical',
      context: 'off',
    });
    expect(result.model.name).toContain('LightGBM');
    expect(result.model.training?.folds).toHaveLength(4);
    expect(result.model.training?.trainMonths).toBe(14);
    expect(result.model.training?.testMonths).toBe(3);
    expect(result.model.training?.stepMonths).toBe(6);
    expect(result.model.training?.outOfSampleForecasts.length).toBeGreaterThan(
      200
    );
  });

  it('rejects unconfigured joint training rather than silently returning another model', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    await expect(
      api.forecastStock({ symbol: 'TCS', model: 'technical_finbert' })
    ).rejects.toThrow('FINBERT_NEWS_ARCHIVE');
    expect(fetchEquityHistoricalData).not.toHaveBeenCalled();
    await expect(
      api.forecastStock({
        symbol: 'TCS',
        model: 'technical_finbert',
        context: 'off',
      })
    ).rejects.toThrow('Joint training');
    await expect(
      api.forecastStock({ symbol: 'TCS', model: 'bad' as 'technical' })
    ).rejects.toThrow('model');
  });

  it('uses broad market moves, but news only increases risk and never dictates price direction', async () => {
    const rows = history(0.0005, 0.01);
    const context: ForecastContext = {
      asOf: NOW.toISOString(),
      market: {
        provider: 'NSE',
        proxy: 'NIFTYBEES',
        status: 'available',
        observations: rows.map((row) => ({
          date: String(row.mtimestamp),
          close: Number(row.chClosingPrice),
        })),
      },
      news: {
        provider: 'Local archive',
        status: 'available',
        scope: 'Global financial news',
        requestedFrom: '2026-09-21',
        requestedTo: '2026-10-05',
        articles: [],
        scoredArticles: 10,
        averagePolarity: -0.8,
        todayArticles: 2,
        sampleLimited: false,
      },
      warnings: [],
    };
    const provider = { getContext: vi.fn().mockResolvedValue(context) };
    const historical = {
      fetchEquityHistoricalData: vi.fn().mockResolvedValue(rows),
    };
    const api = new ForecastApi(historical, () => NOW, provider);
    const risky = await api.forecastStock({ symbol: 'TCS' });
    expect(risky.context?.market.applied).toBe(true);
    expect(risky.context?.market.beta).toBeCloseTo(1);
    expect(risky.summary.signal).toBe('uncertain');
    expect(risky.context?.newsVarianceMultiplier).toBeGreaterThan(1);
    expect(risky.backtest.includesNews).toBe(false);
    context.news.averagePolarity = 0;
    const neutral = await api.forecastStock({ symbol: 'TCS' });
    context.market.observations.push({ date: '2026-10-06', close: 999999 });
    const withFutureMarketRow = await api.forecastStock({ symbol: 'TCS' });
    expect(withFutureMarketRow.forecast).toEqual(neutral.forecast);
    expect(withFutureMarketRow.backtest).toEqual(neutral.backtest);
    expect(risky.forecast[0].estimatedClose).toBe(
      neutral.forecast[0].estimatedClose
    );
    expect(risky.forecast[0].predictionInterval95.upper).toBeGreaterThan(
      neutral.forecast[0].predictionInterval95.upper
    );
    expect(risky.forecast[0].estimatedClose).not.toBe(
      (await api.forecastStock({ symbol: 'TCS', context: 'off' })).forecast[0]
        .estimatedClose
    );
  });

  it('uses India-midnight context cutoffs for custom history and supports context opt-out', async () => {
    const provider = {
      getContext: vi.fn().mockRejectedValue(new Error('Offline')),
    };
    const historical = {
      fetchEquityHistoricalData: vi.fn().mockResolvedValue(history()),
    };
    const api = new ForecastApi(historical, () => NOW, provider);
    const result = await api.forecastStock({
      symbol: 'TCS',
      horizon: 'custom',
      start_date: '2026-09-28',
      end_date: '2026-10-02',
    });
    expect(provider.getContext).toHaveBeenCalledWith(
      expect.objectContaining({
        asOf: '2026-09-27T18:30:00.000Z',
        toDate: '2026-09-27',
      })
    );
    expect(result.warnings.join(' ')).toContain('price-only');
    provider.getContext.mockClear();
    await api.forecastStock({ symbol: 'TCS', context: 'off' });
    expect(provider.getContext).not.toHaveBeenCalled();
  });

  it('anchors custom training strictly before the start and returns only requested weekdays', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    const result = await api.forecastStock({
      symbol: 'TCS',
      horizon: 'custom',
      start_date: '2026-10-05',
      end_date: '2026-10-11',
    });
    expect(fetchEquityHistoricalData).toHaveBeenCalledWith({
      symbol: 'TCS',
      from_date: new Date('2023-10-05T12:00:00'),
      to_date: new Date('2026-10-04T12:00:00'),
      series: ['EQ'],
    });
    expect(result.lastClose.date).toBe('2026-10-02');
    expect(result.forecast.map((point) => point.date)).toEqual([
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]);
    expect(result.forecast.map((point) => point.tradingSession)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(result.forecastRange?.calendarDays).toBe(7);
  });

  it('supports past custom windows without using prices inside or after the forecast range', async () => {
    const input = {
      symbol: 'TCS',
      horizon: 'custom' as const,
      start_date: '2026-09-28',
      end_date: '2026-10-02',
    };
    const rows = history();
    const baseline = await setup(rows).api.forecastStock(input);
    const changed = rows.map((row) =>
      String(row.mtimestamp) >= input.start_date
        ? { ...row, chClosingPrice: 999999 }
        : row
    );
    const result = await setup(changed).api.forecastStock(input);
    expect(result.forecast).toEqual(baseline.forecast);
    expect(result.history.requestedFrom).toBe('2023-09-28');
    expect(result.history.requestedTo).toBe('2026-09-27');
    expect(result.lastClose.date).toBe('2026-09-25');
  });

  it('counts intervening weekdays before a future custom range in projection offsets', async () => {
    const result = await setup().api.forecastStock({
      symbol: 'TCS',
      horizon: 'custom',
      start_date: '2026-10-08',
      end_date: '2026-10-09',
    });
    expect(result.forecast.map((point) => point.tradingSession)).toEqual([
      3, 4,
    ]);
    expect(result.backtest.horizonSessions).toBe(4);
  });

  it('rejects missing, invalid, reversed, over-week and weekend-only custom dates before fetching', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    for (const dates of [
      {},
      { start_date: '2026-10-05' },
      { start_date: '2026-02-30', end_date: '2026-03-02' },
      { start_date: '2026-10-05T00:00:00Z', end_date: '2026-10-06' },
      { start_date: '2026-10-06', end_date: '2026-10-05' },
      { start_date: '2026-10-05', end_date: '2026-10-12' },
      { start_date: '2026-10-10', end_date: '2026-10-11' },
    ])
      await expect(
        api.forecastStock({ symbol: 'TCS', horizon: 'custom', ...dates })
      ).rejects.toThrow();
    await expect(
      api.forecastStock({
        symbol: 'TCS',
        start_date: '2026-10-05',
        end_date: '2026-10-06',
      })
    ).rejects.toThrow('only supported');
    expect(fetchEquityHistoricalData).not.toHaveBeenCalled();
  });

  it('fetches three calendar years of EQ history and defaults to one trading session', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    const result = await api.forecastStock({ symbol: ' tcs ' });
    expect(fetchEquityHistoricalData).toHaveBeenCalledWith({
      symbol: 'TCS',
      from_date: new Date('2023-10-05T12:00:00'),
      to_date: new Date('2026-10-05T12:00:00'),
      series: ['EQ'],
    });
    expect(result.forecast).toHaveLength(1);
    expect(result.summary.estimatedDirection).toBe('up');
    expect(result.backtest.samples).toBe(60);
    expect(result.backtest.beatsNaive).toBe(true);
    expect(result.history.observations).toBeGreaterThan(600);
  });

  it('forecasts five sessions for a week and detects decreasing prices', async () => {
    const { api } = setup(history(-0.001));
    const result = await api.forecastStock({ symbol: 'TCS', horizon: 'week' });
    expect(result.forecast.map((point) => point.tradingSession)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(result.summary.estimatedDirection).toBe('down');
    expect(result.backtest.horizonSessions).toBe(5);
    expect(result.forecast[4].estimatedClose).toBeLessThan(
      result.lastClose.price
    );
  });

  it('sorts, deduplicates and accepts the current NSE date format', async () => {
    const rows = history();
    rows[0].mtimestamp = '05-Oct-2023';
    const { api } = setup([
      ...rows.reverse(),
      rows[0],
      { mtimestamp: 'invalid', chClosingPrice: -1 },
    ]);
    const result = await api.forecastStock({ symbol: 'TCS' });
    expect(result.history.firstDate).toBe('2023-10-05');
    expect(result.history.discardedRows).toBe(2);
  });

  it('reports uncertainty for noisy and flat histories without fabricating confidence', async () => {
    const { api } = setup(history(0.0001, 0.025));
    const result = await api.forecastStock({ symbol: 'TCS', horizon: 'week' });
    expect(result.summary.signal).toBe('uncertain');
    expect(result.forecast[4].predictionInterval95.lower).toBeLessThan(
      result.lastClose.price
    );
    expect(result.forecast[4].predictionInterval95.upper).toBeGreaterThan(
      result.lastClose.price
    );
    const flat = await setup(history(0)).api.forecastStock({ symbol: 'TCS' });
    expect(flat.summary.estimatedDirection).toBe('flat');
    expect(flat.summary.signal).toBe('uncertain');
  });

  it('rejects invalid requests before fetching', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    await expect(api.forecastStock({ symbol: '' })).rejects.toThrow('symbol');
    await expect(
      api.forecastStock({ symbol: 'TCS', horizon: 'month' as 'week' })
    ).rejects.toThrow('horizon');
    await expect(
      api.forecastStock({ symbol: 'TCS', context: 'invalid' as 'auto' })
    ).rejects.toThrow('context');
    await expect(
      api.forecastStock({ symbol: 'TCS', sentiment: 'bad' as 'finbert' })
    ).rejects.toThrow('sentiment');
    expect(fetchEquityHistoricalData).not.toHaveBeenCalled();
  });

  it('rejects incomplete, stale and conflicting histories', async () => {
    await expect(
      setup(history().slice(-100)).api.forecastStock({ symbol: 'TCS' })
    ).rejects.toThrow('Insufficient');
    await expect(
      setup(history().slice(0, -20)).api.forecastStock({ symbol: 'TCS' })
    ).rejects.toThrow('stale');
    const rows = history();
    await expect(
      setup([...rows, { ...rows[0], chClosingPrice: 7 }]).api.forecastStock({
        symbol: 'TCS',
      })
    ).rejects.toThrow('Conflicting');
    await expect(
      setup([{ chSymbol: 'INFY', chClosingPrice: 1 }]).api.forecastStock({
        symbol: 'TCS',
      })
    ).rejects.toThrow('different stock');
  });

  it('withholds signals when a potential corporate-action jump is present', async () => {
    const rows = history();
    for (const row of rows.slice(250))
      row.chClosingPrice = Number(row.chClosingPrice) / 2;
    const result = await setup(rows).api.forecastStock({ symbol: 'TCS' });
    expect(result.summary.signal).toBe('uncertain');
    expect(result.warnings.join(' ')).toContain('25%');
  });

  it('propagates exchange errors rather than producing invented forecasts', async () => {
    const { api, fetchEquityHistoricalData } = setup();
    fetchEquityHistoricalData.mockRejectedValueOnce(
      new Error('Exchange unavailable')
    );
    await expect(api.forecastStock({ symbol: 'TCS' })).rejects.toThrow(
      'Exchange unavailable'
    );
  });
});

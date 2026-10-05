import { describe, expect, it, vi } from 'vitest';
import { ForecastContextApi } from '../../src/nse/api/forecast-context-api.js';

const request = {
  symbol: 'TCS',
  fromDate: '2023-10-05',
  toDate: '2026-10-04',
  asOf: '2026-10-05T06:00:00Z',
};
function setup(configured = false) {
  const historical = {
    fetchEquityHistoricalData: vi.fn().mockResolvedValue([]),
  };
  const scorer = {
    score: vi
      .fn()
      .mockImplementation(async (texts) =>
        texts.map(() => ({
          positive: 0.2,
          negative: 0.7,
          neutral: 0.1,
          polarity: -0.5,
        }))
      ),
  };
  const archiveLoader = vi.fn().mockResolvedValue({
    symbol: 'TCS',
    articles: [
      { publishedAt: '2026-10-05T05:00:00Z', title: 'Earlier headline' },
      { publishedAt: '2026-10-05T07:00:00Z', title: 'Future headline' },
    ],
  });
  const api = new ForecastContextApi(
    historical,
    configured ? { newsArchivePath: 'local.json' } : {},
    () => Date.parse(request.asOf),
    scorer,
    archiveLoader
  );
  return { api, historical, scorer, archiveLoader };
}

describe('free market and local archive context', () => {
  it('does not load or score any news by default', async () => {
    const { api, scorer, archiveLoader } = setup(true);
    const result = await api.getContext(request);
    expect(result.news.sentimentEngine).toBe('off');
    expect(scorer.score).not.toHaveBeenCalled();
    expect(archiveLoader).not.toHaveBeenCalled();
  });

  it('scores only archive headlines published before the captured cutoff', async () => {
    const { api, scorer } = setup(true);
    const result = await api.getContext({ ...request, sentiment: 'finbert' });
    expect(scorer.score).toHaveBeenCalledWith(['Earlier headline']);
    expect(result.news.provider).toBe('Local archive');
    expect(result.news.averagePolarity).toBe(-0.5);
    expect(result.news.todayArticles).toBe(1);
  });

  it('reports missing archives and local failures without assuming sentiment', async () => {
    const { api } = setup();
    expect(
      (await api.getContext({ ...request, sentiment: 'finbert' })).news.status
    ).toBe('not_configured');
    const configured = setup(true);
    configured.scorer.score.mockRejectedValueOnce(new Error('Failed'));
    expect(
      (await configured.api.getContext({ ...request, sentiment: 'finbert' }))
        .news.averagePolarity
    ).toBeNull();
  });

  it('caches recent cutoffs but never serves a snapshot newer than the requested timestamp', async () => {
    const { api, historical } = setup();
    await api.getContext(request);
    await api.getContext({ ...request, asOf: '2026-10-05T06:00:30Z' });
    expect(historical.fetchEquityHistoricalData).toHaveBeenCalledTimes(1);
    await api.getContext({ ...request, asOf: '2026-10-05T05:59:30Z' });
    expect(historical.fetchEquityHistoricalData).toHaveBeenCalledTimes(2);
  });

  it('normalizes the free NSE market proxy and excludes out-of-window rows', async () => {
    const { api, historical } = setup();
    const rows = Array.from({ length: 80 }, (_, index) => ({
      mtimestamp: new Date(Date.parse('2026-06-01') + index * 86400000)
        .toISOString()
        .slice(0, 10),
      chClosingPrice: 100 + index,
    }));
    historical.fetchEquityHistoricalData.mockResolvedValueOnce([
      ...rows,
      { mtimestamp: '05-Oct-2026', chClosingPrice: 999 },
    ]);
    const result = await api.getContext(request);
    expect(result.market.status).toBe('available');
    expect(result.market.observations).toHaveLength(80);
  });
});

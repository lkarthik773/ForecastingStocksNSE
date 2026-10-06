import { describe, expect, it, vi } from 'vitest';
import { FinBertScorer } from '../../src/forecast/finbert.js';
import { historicalFinBertFeatures } from '../../src/forecast/finbert-history.js';
import { trainForecast } from '../../src/forecast/trained-forecast.js';

const labels = [
  { label: 'negative', score: 0.2 },
  { label: 'neutral', score: 0.1 },
  { label: 'positive', score: 0.7 },
];

describe('Prosus FinBERT scoring adapter', () => {
  it('prepares pre-cutoff historical features and trains a joint model with sufficient synthetic coverage', async () => {
    const observations = Array.from({ length: 1096 }, (_, index) => ({
      date: new Date(Date.parse('2023-10-05') + index * 86400000)
        .toISOString()
        .slice(0, 10),
      close: 100 * Math.exp(index * 0.001 + Math.sin(index / 5) * 0.01),
    }));
    const articles = observations.flatMap((row) =>
      [5, 6, 7].map((hour) => ({
        publishedAt: `${row.date}T0${hour}:00:00Z`,
        title: `Synthetic earnings report ${hour}`,
      }))
    );
    articles.push({
      publishedAt: '2027-01-01T05:00:00Z',
      title: 'Future article must never be scored',
    });
    const scorer = {
      score: vi.fn().mockImplementation(async (texts) =>
        texts.map(() => ({
          positive: 0.7,
          negative: 0.2,
          neutral: 0.1,
          polarity: 0.5,
        }))
      ),
    };
    const features = await historicalFinBertFeatures(
      { symbol: 'TCS', articles },
      observations,
      '2026-10-05T23:59:59Z',
      scorer
    );
    expect(features.length).toBeGreaterThan(180);
    expect(scorer.score.mock.calls.flatMap((call) => call[0])).not.toContain(
      'Future article must never be scored'
    );
    const result = await trainForecast(observations, [1], features);
    expect(result.training.includesFinBert).toBe(true);
    expect(result.evaluation.samples).toBeGreaterThan(200);
  });

  it('preserves requested cached scores during cache eviction', async () => {
    const scorer = new FinBertScorer(
      undefined,
      async () => async (texts) => texts.map(() => labels)
    );
    for (let offset = 0; offset < 2000; offset += 100)
      await scorer.score(
        Array.from({ length: 100 }, (_, index) => `headline-${offset + index}`)
      );
    const result = await scorer.score([
      'headline-0',
      ...Array.from({ length: 99 }, (_, index) => `new-${index}`),
    ]);
    expect(result[0].positive).toBe(0.7);
    expect(result.every((score) => Number.isFinite(score.polarity))).toBe(true);
  });

  it('rejects insufficient archives before scoring and excludes later news', async () => {
    const scorer = { score: vi.fn() };
    const observations = [
      { date: '2026-10-01', close: 100 },
      { date: '2026-10-02', close: 101 },
    ];
    await expect(
      historicalFinBertFeatures(
        {
          symbol: 'TCS',
          articles: [
            { publishedAt: '2026-10-03T05:00:00Z', title: 'Future news' },
          ],
        },
        observations,
        '2026-10-02T00:00:00Z',
        scorer
      )
    ).rejects.toThrow('180');
    expect(scorer.score).not.toHaveBeenCalled();
  });

  it('uses semantic label names rather than class positions and caches repeated text', async () => {
    const classifier = vi
      .fn()
      .mockImplementation(async (texts) => texts.map(() => labels));
    const loader = vi.fn().mockResolvedValue(classifier);
    const scorer = new FinBertScorer(undefined, loader);
    const scores = await scorer.score([
      'Profit increased',
      'Profit increased',
      'Sales expanded',
    ]);
    expect(scores).toHaveLength(3);
    expect(scores[0].polarity).toBeCloseTo(0.5);
    expect(scores[0].neutral).toBe(0.1);
    await scorer.score(['Profit increased']);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(classifier).toHaveBeenCalledTimes(1);
  });

  it('does not download a model for empty requests or invalid inputs', async () => {
    const loader = vi.fn();
    const scorer = new FinBertScorer(undefined, loader);
    expect(await scorer.score([])).toEqual([]);
    await expect(scorer.score([' '])).rejects.toThrow();
    await expect(scorer.score(Array(101).fill('text'))).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects malformed scores without relabeling another model as FinBERT', async () => {
    const classifier = vi
      .fn()
      .mockResolvedValue([[{ label: 'LABEL_0', score: 1 }]]);
    const scorer = new FinBertScorer(undefined, async () => classifier);
    await expect(scorer.score(['headline'])).rejects.toThrow();
  });

  it('retries failed model initialization and hides raw loader errors', async () => {
    const loader = vi
      .fn()
      .mockRejectedValueOnce(new Error('secret URL'))
      .mockResolvedValue(async (texts) => texts.map(() => labels));
    const scorer = new FinBertScorer(undefined, loader);
    await expect(scorer.score(['headline'])).rejects.toThrow(
      'could not initialize'
    );
    expect((await scorer.score(['headline']))[0].positive).toBe(0.7);
  });
});

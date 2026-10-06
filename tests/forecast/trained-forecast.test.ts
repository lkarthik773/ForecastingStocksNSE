import { describe, expect, it } from 'vitest';
import {
  technicalFeatures,
  trainForecast,
} from '../../src/forecast/trained-forecast.js';

const prices = () => {
  const rows = [];
  for (
    const date = new Date('2023-10-05T00:00:00Z');
    date < new Date('2026-10-05T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const index = rows.length;
    rows.push({
      date: date.toISOString().slice(0, 10),
      close: 100 * Math.exp(index * 0.0005 + Math.sin(index * 0.3) * 0.02),
    });
  }
  return rows;
};

describe('LightGBM rolling technical training', () => {
  it('calculates causal technical features', () => {
    const result = technicalFeatures(
      prices()
        .slice(0, 100)
        .map((row) => row.close)
    );
    expect(result.features).toHaveLength(12);
    expect(result.features.every(Number.isFinite)).toBe(true);
    expect(result.indicators.rsi14).toBeGreaterThanOrEqual(0);
    expect(result.indicators.rsi14).toBeLessThanOrEqual(100);
    expect(Number.isFinite(result.indicators.bollingerPercentB)).toBe(true);
    expect(result.indicators.bollingerBandwidth).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(result.indicators.roc10)).toBe(true);
    expect(Number.isFinite(result.indicators.roc20)).toBe(true);
  });

  it('fits official LightGBM, scores four frozen test blocks and retains predictions versus actuals', async () => {
    const result = await trainForecast(prices(), [1, 5], undefined, undefined, {
      from: '2023-10-05',
      toExclusive: '2026-10-05',
    });
    expect(result.training.algorithm).toContain('LightGBM 4.6.0');
    expect(result.training.folds).toHaveLength(8);
    expect(result.training.trainMonths).toBe(14);
    expect(result.training.stepMonths).toBe(6);
    expect(result.training.outOfSampleForecasts.length).toBeGreaterThan(400);
    expect(result.evaluation.coverageSamples).toBeGreaterThan(100);
    expect(result.points.map((point) => point.sessions)).toEqual([1, 5]);
  });

  it('rejects a short FinBERT sample rather than using unobserved labels', async () => {
    const rows = prices();
    const news = rows
      .slice(-14)
      .map((row) => ({
        date: row.date,
        asOf: `${row.date}T09:00:00Z`,
        polarity: 0.2,
        articles: 5,
      }));
    await expect(trainForecast(rows, [1], news)).rejects.toThrow();
  });

  it('later stock-price changes cannot alter forecasts from an earlier frozen test block', async () => {
    const rows = prices();
    const window = { from: '2023-10-05', toExclusive: '2026-10-05' };
    const baseline = await trainForecast(
      rows,
      [1],
      undefined,
      undefined,
      window
    );
    const changed = rows.map((row) =>
      row.date >= '2025-06-05' ? { ...row, close: row.close * 1.2 } : row
    );
    const updated = await trainForecast(
      changed,
      [1],
      undefined,
      undefined,
      window
    );
    expect(
      updated.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    ).toEqual(
      baseline.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    );
  });
});

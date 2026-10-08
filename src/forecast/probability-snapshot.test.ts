import { describe, expect, it, vi } from 'vitest';
import {
  configureForecastProbabilityEventsForBenchmark,
  ForecastApi,
} from './forecast-api.js';
import { trainCurrentProbabilitySnapshot } from './trained-forecast.js';
import type { TrainingObservation } from './trained-forecast.js';

const history = (count = 760): TrainingObservation[] =>
  Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2023, 0, index + 1)).toISOString().slice(0, 10),
    close: 100 * Math.exp(index * 0.0004 + Math.sin(index * 0.2) * 0.01),
  }));

describe('current probability snapshots', () => {
  it('fits current event probabilities from completed, quality-eligible labels', () => {
    const predictions = trainCurrentProbabilitySnapshot(
      history(),
      ['up'],
      '2025-03-01'
    );

    expect(predictions).toHaveLength(2);
    expect(predictions.map(({ horizon }) => horizon)).toEqual([1, 5]);
    expect(predictions.every(
      ({ probability, trainingRows, positiveTrainingRows, negativeTrainingRows }) =>
        Number.isFinite(probability) &&
        probability >= 0 &&
        probability <= 1 &&
        trainingRows >= 120 &&
        positiveTrainingRows >= 10 &&
        negativeTrainingRows >= 10
    )).toBe(true);
  });

  it('rejects a current feature window containing a quality-excluded candle', () => {
    const observations = history();
    observations[observations.length - 1].qualityExcluded = true;

    expect(() =>
      trainCurrentProbabilitySnapshot(observations, ['up'], '2025-03-01')
    ).toThrow('latest 60-session feature window');
  });

  it('fetches and normalizes an adjusted history without running regression folds', async () => {
    const now = new Date('2026-10-05T06:00:00Z');
    const rows: Record<string, unknown>[] = [];
    let price = 100;
    for (
      const date = new Date('2021-10-05T00:00:00Z');
      date < now;
      date.setUTCDate(date.getUTCDate() + 1)
    ) {
      if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
      price *= Math.exp(0.0004 + Math.sin(rows.length * 0.2) * 0.002);
      rows.push({
        mtimestamp: date.toISOString().slice(0, 10),
        chClosingPrice: price,
        chSymbol: 'TCS',
        chSeries: 'EQ',
      });
    }
    const actionProvider = vi.fn().mockResolvedValue([]);
    const api = new ForecastApi(
      { fetchEquityHistoricalData: vi.fn().mockResolvedValue(rows) },
      () => now,
      undefined,
      {},
      6,
      actionProvider
    );
    configureForecastProbabilityEventsForBenchmark(api, ['up']);

    const snapshot = await api.forecastProbabilitySnapshotForBenchmark({
      symbol: 'TCS',
    });

    expect(snapshot.originDate).toBe('2026-10-05');
    expect(snapshot.dataQuality.corporateActionAdjustment).toBe('applied');
    expect(snapshot.predictions).toHaveLength(2);
    expect(actionProvider).toHaveBeenCalledWith(
      'TCS',
      '2021-10-05',
      '2026-10-05'
    );
  });
});

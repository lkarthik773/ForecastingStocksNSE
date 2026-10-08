import { describe, expect, it } from 'vitest';
import {
  advancedTechnicalFeatures,
  marketContextFeatures,
  ohlcFeatures,
  relativeVolumeFeature,
  technicalFeatures,
  trainForecast,
  type TrainingObservation,
  type TrainingMarketObservation,
} from '../../src/forecast/trained-forecast.js';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

const prices = () => {
  const rows: TrainingObservation[] = [];
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
  it('scores model error, no-change error, directional accuracy and exact flat returns', () => {
    const score = scoreForecastReturns([
      { predictedLogReturn: 0.1, actualLogReturn: 0.1 },
      { predictedLogReturn: -0.2, actualLogReturn: 0.1 },
      { predictedLogReturn: 0, actualLogReturn: 0 },
    ]);
    expect(score.samples).toBe(3);
    expect(score.meanAbsoluteLogReturnErrorPct).toBeCloseTo(10, 10);
    expect(score.meanAbsolutePercentageError).toBeCloseTo(
      (Math.abs(Math.expm1(-0.3)) * 100) / 3,
      10
    );
    expect(score.naiveMeanAbsolutePercentageError).toBeCloseTo(
      (Math.abs(Math.expm1(-0.1)) * 100 * 2) / 3,
      10
    );
    expect(score.directionalAccuracyPct).toBeCloseTo(200 / 3, 10);
    expect(score.beatsNaive).toBe(false);
  });

  it('rejects empty or non-finite evaluation samples', () => {
    expect(() => scoreForecastReturns([])).toThrow('At least one');
    expect(() => scoreForecastReturns([
      { predictedLogReturn: Number.NaN, actualLogReturn: 0 },
    ])).toThrow('must be finite');
  });

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

  it('calculates causal OHLC features only from valid completed candles', () => {
    const rows = prices().slice(0, 80).map((row, index) => ({
      ...row,
      open: row.close * (1 - (index % 3) * 0.001),
      high: row.close * 1.01,
      low: row.close * 0.99,
    }));
    const selected = ohlcFeatures(rows);
    expect(selected).toHaveLength(5);
    expect(selected?.every(Number.isFinite)).toBe(true);
    expect(selected?.[2]).toBeGreaterThanOrEqual(-1);
    expect(selected?.[2]).toBeLessThanOrEqual(1);

    const alteredFuture = rows.map((row, index) =>
      index >= 70
        ? { ...row, open: row.open * 2, high: row.high * 2, low: row.low * 2 }
        : row
    );
    expect(ohlcFeatures(alteredFuture.slice(0, 70))).toEqual(
      ohlcFeatures(rows.slice(0, 70))
    );
    expect(ohlcFeatures([{ ...rows[0], open: undefined }])).toBeUndefined();
  });

  it('uses only same-date and earlier market closes for market context features', () => {
    const market: TrainingMarketObservation[] = Array.from(
      { length: 30 },
      (_, index) => ({
        date: new Date(Date.UTC(2026, 0, index + 1))
          .toISOString()
          .slice(0, 10),
        close: 100 * Math.exp(index * 0.001 + Math.sin(index * 0.2) * 0.01),
      })
    );
    const asOf = market[24].date;
    const features = marketContextFeatures(market, asOf);
    expect(features).toHaveLength(4);
    expect(features?.every(Number.isFinite)).toBe(true);
    expect(marketContextFeatures(market, '2025-12-01')).toBeUndefined();

    const futureChanged = market.map((row, index) =>
      index > 24 ? { ...row, close: row.close * 3 } : row
    );
    expect(marketContextFeatures(futureChanged, asOf)).toEqual(features);
  });

  it('calculates causal close-only volatility and path-structure features', () => {
    const closes = prices().slice(0, 120).map((row) => row.close);
    const features = advancedTechnicalFeatures(closes);
    expect(features).toHaveLength(5);
    expect(features?.every(Number.isFinite)).toBe(true);
    expect(features?.[0]).toBeGreaterThanOrEqual(0);
    expect(features?.[1]).toBeGreaterThanOrEqual(0);
    expect(features?.[2]).toBeGreaterThanOrEqual(0);
    expect(features?.[3]).toBeGreaterThanOrEqual(-1);
    expect(features?.[3]).toBeLessThanOrEqual(1);
    expect(features?.[4]).toBeGreaterThanOrEqual(0);
    expect(features?.[4]).toBeLessThanOrEqual(1);
    expect(advancedTechnicalFeatures(closes.slice(0, 60))).toBeUndefined();

    const futureChanged = closes.map((close, index) =>
      index >= 100 ? close * 1.5 : close
    );
    expect(advancedTechnicalFeatures(futureChanged.slice(0, 100))).toEqual(
      advancedTechnicalFeatures(closes.slice(0, 100))
    );
  });

  it('calculates relative volume causally and withholds action-unit transitions', () => {
    const observations = prices().slice(0, 45).map((row, index) => ({
      ...row,
      volume: index === 20 ? 200 : 100,
    }));
    expect(relativeVolumeFeature(observations, 20)).toBeCloseTo(
      Math.log(2),
      10
    );
    expect(
      relativeVolumeFeature(observations, 20, [observations.at(-1)!.date])
    ).toBeCloseTo(Math.log(2), 10);

    const actionDate = observations[20].date;
    for (let index = 20; index < 40; index++)
      expect(
        relativeVolumeFeature(observations, index, [actionDate])
      ).toBeUndefined();
    expect(
      relativeVolumeFeature(observations, 40, [actionDate])
    ).toBeDefined();

    const futureChanged = observations.map((row, index) =>
      index >= 21 ? { ...row, volume: row.volume! * 7 } : row
    );
    expect(relativeVolumeFeature(futureChanged, 20)).toBeCloseTo(
      relativeVolumeFeature(observations, 20)!,
      10
    );
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

  it('does not use future OHLC changes to alter earlier frozen test forecasts', async () => {
    const rows = prices().map((row, index) => ({
      ...row,
      open: row.close * (1 - Math.sin(index) * 0.003),
      high: row.close * 1.01,
      low: row.close * 0.99,
    }));
    const window = { from: '2023-10-05', toExclusive: '2026-10-05' };
    const baseline = await trainForecast(
      rows,
      [1],
      undefined,
      undefined,
      window,
      6,
      'ohlc'
    );
    const changed = rows.map((row) =>
      row.date >= '2025-06-05'
        ? {
            ...row,
            close: row.close * 1.2,
            open: row.open * 1.2,
            high: row.high * 1.2,
            low: row.low * 1.2,
          }
        : row
    );
    const updated = await trainForecast(
      changed,
      [1],
      undefined,
      undefined,
      window,
      6,
      'ohlc'
    );
    expect(updated.training.features).toContain('overnightGapReturn');
    expect(
      updated.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    ).toEqual(
      baseline.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    );
  });

  it('does not use future market changes to alter earlier frozen test forecasts', async () => {
    const rows = prices();
    const market: TrainingMarketObservation[] = rows.map((row, index) => ({
      date: row.date,
      close: 100 * Math.exp(index * 0.0002 + Math.sin(index * 0.17) * 0.01),
    }));
    const window = { from: '2023-10-05', toExclusive: '2026-10-05' };
    const baseline = await trainForecast(
      rows,
      [1],
      undefined,
      undefined,
      window,
      6,
      'market_context',
      market
    );
    const changedMarket = market.map((row) =>
      row.date >= '2025-06-05' ? { ...row, close: row.close * 1.2 } : row
    );
    const updated = await trainForecast(
      rows,
      [1],
      undefined,
      undefined,
      window,
      6,
      'market_context',
      changedMarket
    );
    expect(updated.training.features).toContain('marketReturn20');
    expect(
      updated.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    ).toEqual(
      baseline.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    );
  });

  it('does not use future closes to alter earlier advanced technical forecasts', async () => {
    const rows = prices();
    const window = { from: '2023-10-05', toExclusive: '2026-10-05' };
    const baseline = await trainForecast(
      rows,
      [1],
      undefined,
      undefined,
      window,
      6,
      'advanced_technical'
    );
    const changed = rows.map((row) =>
      row.date >= '2025-06-05' ? { ...row, close: row.close * 1.2 } : row
    );
    const updated = await trainForecast(
      changed,
      [1],
      undefined,
      undefined,
      window,
      6,
      'advanced_technical'
    );
    expect(updated.training.features).toContain('realizedVolatility60');
    expect(updated.training.features).toContain('trendEfficiency20');
    expect(
      updated.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    ).toEqual(
      baseline.training.outOfSampleForecasts.filter((point) => point.fold === 0)
    );
  });

  it('excludes feature and target windows affected by flagged intraday reversals', async () => {
    const rows = prices();
    const flaggedIndexes = ['2024-12-10', '2025-01-20'].map((date) => {
      const index = rows.findIndex((row) => row.date === date);
      rows[index].qualityExcluded = true;
      return index;
    });
    const result = await trainForecast(rows, [1, 5], undefined, undefined, {
      from: '2023-10-05',
      toExclusive: '2026-10-05',
    });
    expect(result.evaluation.qualityExcludedSamples).toBeGreaterThan(0);
    expect(result.evaluation.unscoredEligibleSamples).toBe(
      result.training.folds
        .filter(
          (fold) =>
            fold.horizon === 5 &&
            fold.status === 'skipped_insufficient_eligible_samples'
        )
        .reduce((total, fold) => total + fold.testRows, 0)
    );
    expect(
      result.training.folds.some((fold) => fold.qualityExcludedTestRows > 0)
    ).toBe(true);
    expect(
      result.training.folds.some((fold) => fold.qualityExcludedTrainRows > 0)
    ).toBe(true);
    expect(
      result.training.folds.some(
        (fold) => fold.status === 'skipped_insufficient_eligible_samples'
      )
    ).toBe(true);
    expect(
      result.training.outOfSampleForecasts.every((prediction) => {
        const originIndex = rows.findIndex(
          (row) => row.date === prediction.originDate
        );
        return flaggedIndexes.every(
          (flaggedIndex) =>
            flaggedIndex < originIndex - 59 ||
            flaggedIndex > originIndex + prediction.horizon
        );
      })
    ).toBe(true);
  });
});

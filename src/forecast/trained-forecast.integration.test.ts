import { describe, expect, it } from 'vitest';
import {
  getFnoFeaturesForObservation,
  trainForecast,
  type TrainingObservation,
} from './trained-forecast.js';
import type { FnoData, FnoFeatures } from './fno-features.js';
import {
  FUTURES_FEATURE_NAMES,
  type FuturesFeatures,
} from './futures-features.js';

const fnoFeatures = (): FnoFeatures =>
  Object.fromEntries([
    'futuresPremiumPct', 'premiumTrendCh1Day', 'premiumTrendCh5Day', 'premiumSma5',
    'totalOIChangePct', 'callOIChangePct', 'putOIChangePct', 'totalOISma5', 'totalOISma20',
    'putCallRatio', 'putCallRatioTrend', 'putCallVolumeRatio', 'priceUpOIUp', 'priceUpOIDown',
    'priceDownOIUp', 'priceDownOIDown', 'callOIExtreme', 'putOIExtreme', 'oiSkewFavorsCall',
    'oiSkewFavorsPut', 'futuresVolumeRelative', 'spotVolumeRelative', 'volumeConvergence',
    'callVolumeRelative', 'putVolumeRelative', 'oiMomentum', 'callPutStrength', 'oiBias',
  ].map((name, index) => [name, index / 100])) as FnoFeatures;
const futuresFeatures = (): FuturesFeatures =>
  Object.fromEntries(
    FUTURES_FEATURE_NAMES.map((name, index) => [name, index / 100])
  ) as FuturesFeatures;

const history = (count = 760): TrainingObservation[] =>
  Array.from({ length: count }, (_, i) => ({
    date: new Date(Date.UTC(2023, 0, i + 1)).toISOString().slice(0, 10),
    close: 100 * Math.exp(i * 0.0004 + Math.sin(i * 0.2) * 0.01),
    volume: 10_000,
    fnoFeatures: fnoFeatures(),
  }));

describe('trainForecast technical_fno integration', () => {
  it('constructs F&O features causally from mock F&O observations', () => {
    const observations = history(25);
    const fno: FnoData[] = observations.map((row, i) => ({
      date: row.date,
      spotsPrice: row.close,
      futuresPrice: row.close * 1.01,
      futuresOpenInterest: 1000 + i,
      callOpenInterest: 500 + i,
      putOpenInterest: 600 + i,
      callVolume: 100,
      putVolume: 100,
      spotVolume: row.volume!,
    }));
    expect(getFnoFeaturesForObservation(observations, 24, fno)).toBeDefined();
    expect(getFnoFeaturesForObservation(observations, 1, fno)).toBeUndefined();
  });

  it('trains LightGBM with the technical_fno feature set and 28-value vectors', async () => {
    const result = await trainForecast(history(), [1], undefined, undefined, {
      from: '2023-01-01',
      toExclusive: '2025-02-01',
    }, 6, 'technical_fno', [], [], ['up']);
    expect(result.training.algorithm).toContain('LightGBM');
    expect(result.training.validation).toContain('technical_fno');
    expect(result.training.trainingRows).toBeGreaterThan(0);
    expect(result.training.features).toHaveLength(40);
    expect(result.training.outOfSampleProbabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          horizon: 1,
          event: 'up',
          probability: expect.any(Number),
          occurred: expect.any(Boolean),
        }),
      ])
    );
  }, 120_000);

  it('trains LightGBM with the technical_futures feature set and 10 futures signals', async () => {
    const observations = history().map((row) => ({
      ...row,
      futuresFeatures: futuresFeatures(),
    }));
    const result = await trainForecast(
      observations,
      [1],
      undefined,
      undefined,
      { from: '2023-01-01', toExclusive: '2025-02-01' },
      6,
      'technical_futures'
    );
    expect(result.training.validation).toContain('technical_futures');
    expect(result.training.trainingRows).toBeGreaterThan(0);
    expect(result.training.features).toHaveLength(22);
  }, 120_000);
});

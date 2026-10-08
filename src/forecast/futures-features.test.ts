import { describe, expect, it } from 'vitest';
import {
  calculateFuturesFeatures,
  getFuturesFeaturesForObservation,
  type FuturesObservation,
} from './futures-features.js';

const history = (count = 25): FuturesObservation[] =>
  Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    spotClose: 100 + index,
    futuresClose: (100 + index) * (1 + (1 + index / 100) / 100),
    futuresOpenInterest: 1_000 + index * 20,
  }));

describe('futures-only features', () => {
  it('calculates finite premium, OI-change, momentum and price/OI features', () => {
    const features = calculateFuturesFeatures(history());

    expect(features).toBeDefined();
    expect(features!.futuresPremiumPct).toBeCloseTo(1.24);
    expect(features!.futuresOIChange1dPct).toBeGreaterThan(0);
    expect(features!.futuresOIChange5dPct).toBeGreaterThan(0);
    expect(features!.priceUpOIUp).toBe(1);
    expect(features!.priceUpOIDown).toBe(0);
    expect(Object.values(features!).every(Number.isFinite)).toBe(true);
  });

  it('requires sufficient prior observations and rejects invalid rows', () => {
    expect(calculateFuturesFeatures(history(20))).toBeUndefined();
    const invalid = history();
    invalid[8].futuresOpenInterest = Number.NaN;
    expect(calculateFuturesFeatures(invalid)).toBeUndefined();
  });

  it('uses no observations dated after the forecast origin', () => {
    const observations = history(25);
    const expected = calculateFuturesFeatures(observations.slice(0, 23));

    expect(
      getFuturesFeaturesForObservation(observations, observations[22].date)
    ).toEqual(expected);
  });
});

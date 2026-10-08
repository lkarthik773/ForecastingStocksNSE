import { describe, expect, it } from 'vitest';
import {
  forecastEventOccurred,
  priorEventProbability,
  scoreBinaryProbabilities,
} from '../../src/forecast/target-outcomes.js';

describe('forecast outcome probability targets', () => {
  it('uses explicit boundaries for direction and one-percent outcomes', () => {
    expect(forecastEventOccurred(0, 'up')).toBe(false);
    expect(forecastEventOccurred(Math.log1p(0.01), 'gain_over_1pct')).toBe(false);
    expect(forecastEventOccurred(Math.log1p(0.0101), 'gain_over_1pct')).toBe(true);
    expect(forecastEventOccurred(Math.log1p(-0.01), 'loss_below_minus_1pct')).toBe(false);
    expect(forecastEventOccurred(Math.log1p(-0.0101), 'loss_below_minus_1pct')).toBe(true);
  });

  it('uses only matured prior outcomes at the matching horizon', () => {
    const observations = [
      ...Array.from({ length: 100 }, (_, index) => ({
        horizon: 1,
        targetDate: `2024-01-${String((index % 28) + 1).padStart(2, '0')}`,
        actualLogReturn: index < 24 ? 0.01 : -0.01,
      })),
      {
        horizon: 5,
        targetDate: '2024-01-02',
        actualLogReturn: 0.02,
      },
      {
        horizon: 1,
        targetDate: '2024-02-01',
        actualLogReturn: 0.02,
      },
    ];

    expect(
      priorEventProbability(observations, 1, '2024-02-01', 'up')
    ).toEqual({ probability: 25 / 102, samples: 100, fallback: false });
  });

  it('uses an uninformative probability until 100 matured outcomes exist', () => {
    expect(
      priorEventProbability(
        [{ horizon: 1, targetDate: '2024-01-01', actualLogReturn: 0.01 }],
        1,
        '2024-01-02',
        'gain_over_1pct'
      )
    ).toEqual({ probability: 0.5, samples: 1, fallback: true });
  });

  it('scores Brier and log loss and rejects invalid probabilities', () => {
    expect(
      scoreBinaryProbabilities([
        { probability: 0.8, occurred: true },
        { probability: 0.2, occurred: false },
      ])
    ).toEqual({
      samples: 2,
      observedRatePct: 50,
      brierScore: 0.039999999999999994,
      logLoss: expect.closeTo(0.2231435513142097),
    });
    expect(() =>
      scoreBinaryProbabilities([{ probability: 1.1, occurred: true }])
    ).toThrow('Forecast probabilities must be finite values from 0 to 1.');
  });
});

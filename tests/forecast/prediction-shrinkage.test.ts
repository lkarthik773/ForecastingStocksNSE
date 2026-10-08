import { describe, expect, it } from 'vitest';
import {
  calibratePredictionShrinkage,
  selectMaturedShrinkageObservations,
} from '../../src/forecast/prediction-shrinkage.js';

describe('walk-forward prediction shrinkage calibration', () => {
  it('selects the factor that minimizes prior-sample MAPE', () => {
    const observations = Array.from({ length: 100 }, (_, index) => ({
      predictedLogReturn: (index % 2 ? 1 : -1) * (0.001 + index / 100_000),
      actualLogReturn: (index % 2 ? 1 : -1) * (0.0004 + index / 250_000),
    }));

    expect(calibratePredictionShrinkage(observations)).toMatchObject({
      factor: 0.4,
      samples: 100,
    });
  });

  it('falls back to no-change until 100 prior predictions are available', () => {
    const observations = Array.from({ length: 99 }, () => ({
      predictedLogReturn: 0.01,
      actualLogReturn: 0.002,
    }));

    expect(calibratePredictionShrinkage(observations)).toEqual({
      factor: 0,
      samples: 99,
    });
  });

  it('breaks equal-score ties toward the more conservative factor', () => {
    const observations = Array.from({ length: 100 }, () => ({
      predictedLogReturn: 0,
      actualLogReturn: 0.001,
    }));

    expect(calibratePredictionShrinkage(observations).factor).toBe(0);
  });

  it('uses only matching-horizon targets completed before the test fold', () => {
    const observations = [
      { targetDate: '2024-01-04', horizon: 1, predictedLogReturn: 0.01, actualLogReturn: 0.002 },
      { targetDate: '2024-01-05', horizon: 1, predictedLogReturn: 0.02, actualLogReturn: 0.003 },
      { targetDate: '2024-01-04', horizon: 5, predictedLogReturn: 0.03, actualLogReturn: 0.004 },
      { targetDate: '2024-01-06', horizon: 1, predictedLogReturn: 0.04, actualLogReturn: 0.005 },
    ];

    expect(
      selectMaturedShrinkageObservations(observations, 1, '2024-01-05')
    ).toEqual([
      { predictedLogReturn: 0.01, actualLogReturn: 0.002 },
    ]);
  });
});

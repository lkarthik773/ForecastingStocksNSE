import { describe, expect, it } from 'vitest';
import { fitLogisticClassifier } from './probability-classifier.js';

describe('fitLogisticClassifier', () => {
  it('learns a deterministic probability from a separable feature', () => {
    const features = Array.from({ length: 100 }, (_, index) => [
      (index - 50) / 10,
      index % 2,
    ]);
    const labels = features.map(([value]) => Number(value > 0));
    const first = fitLogisticClassifier(features, labels);
    const second = fitLogisticClassifier(features, labels);

    expect(first([2, 0])).toBeGreaterThan(0.8);
    expect(first([-2, 0])).toBeLessThan(0.2);
    expect(first([2, 0])).toBe(second([2, 0]));
  });

  it('rejects invalid training rows and prediction vectors', () => {
    expect(() => fitLogisticClassifier([[1], [2]], [0])).toThrow(
      'matching finite feature rows and binary labels'
    );
    const predict = fitLogisticClassifier([[1], [2]], [0, 1]);
    expect(() => predict([Number.NaN])).toThrow(
      'finite feature vector matching the training data'
    );
  });
});

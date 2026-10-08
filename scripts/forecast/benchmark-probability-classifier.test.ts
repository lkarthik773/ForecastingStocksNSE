import { describe, expect, it } from 'vitest';
import { bootstrapProbabilityDifferences } from './benchmark-probability-classifier.js';

describe('probability moving-block bootstrap', () => {
  it('is deterministic and returns zero deltas for identical paired forecasts', () => {
    const rows = Array.from({ length: 50 }, (_, index) =>
      Array.from({ length: 2 }, (_, symbolIndex) => ({
        symbol: `S${symbolIndex}`,
        horizon: 1,
        event: 'up' as const,
        originDate: new Date(Date.UTC(2025, 0, index + 1))
          .toISOString()
          .slice(0, 10),
        targetDate: new Date(Date.UTC(2025, 0, index + 2))
          .toISOString()
          .slice(0, 10),
        actualLogReturn: index % 3 ? 0.01 : -0.01,
        occurred: Boolean(index % 3),
        probability: 0.4,
        priorProbability: 0.4,
        fold: 0,
        testStart: '2025-01-01',
        testEndExclusive: '2025-04-01',
      }))
    ).flat();
    const first = bootstrapProbabilityDifferences(rows, 'unit-test', 100, 20);
    const second = bootstrapProbabilityDifferences(rows, 'unit-test', 100, 20);

    expect(first).toEqual(second);
    expect(first.classifierMinusPriorBrier).toBe(0);
    expect(first.classifierMinusPriorBrierLower95).toBe(0);
    expect(first.classifierMinusPriorLogLoss).toBe(0);
    expect(first.classifierMinusPriorLogLossUpper95).toBe(0);
  });
});

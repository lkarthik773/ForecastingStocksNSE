import { describe, expect, it } from 'vitest';
import { resolveProspectiveOutcome } from './score-prospective-probabilities.js';
import type { ProbabilitySnapshotPrediction } from './probability-prospective-common.js';

const prediction = (
  horizon: 1 | 5 = 1
): ProbabilitySnapshotPrediction => ({
  symbol: 'TCS',
  originDate: '2025-03-02',
  horizon,
  event: 'up',
  probability: 0.55,
  priorProbability: 0.5,
  priorOutcomeSamples: 100,
  usedNeutralPriorFallback: false,
  trainingRows: 250,
  positiveTrainingRows: 125,
  negativeTrainingRows: 125,
});

const prices = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    close: 100 + index,
  }));

describe('prospective probability outcomes', () => {
  it('resolves the target using the requested number of observed sessions', () => {
    const observations = prices(70);
    const outcome = resolveProspectiveOutcome(
      prediction(1),
      observations.map((row, index) => ({
        ...row,
        date: index === 60 ? '2025-03-02' : row.date,
      }))
    );

    expect(outcome.status).toBe('matured');
    if (outcome.status === 'matured') {
      expect(outcome.outcome.targetDate).toBe('2025-03-03');
      expect(outcome.outcome.actualLogReturn).toBeCloseTo(
        Math.log(161 / 160)
      );
    }
  });

  it('keeps unripe outcomes pending and excludes quality-tainted targets', () => {
    const pending = resolveProspectiveOutcome(
      prediction(5),
      prices(64).map((row, index) => ({
        ...row,
        date: index === 60 ? '2025-03-02' : row.date,
      }))
    );
    const taintedRows = prices(70).map((row, index) => ({
      ...row,
      date: index === 60 ? '2025-03-02' : row.date,
      ...(index === 61 ? { qualityExcluded: true } : {}),
    }));

    expect(pending).toEqual({ status: 'pending' });
    expect(
      resolveProspectiveOutcome(prediction(1), taintedRows)
    ).toEqual({ status: 'quality_excluded' });
  });
});

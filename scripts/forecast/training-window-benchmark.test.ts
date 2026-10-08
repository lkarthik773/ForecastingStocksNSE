import { describe, expect, it } from 'vitest';
import {
  matchTrainingWindowPredictions,
  type WindowRun,
} from './training-window-benchmark.js';

function run(
  trainMonths: 8 | 14 | 20,
  originDate = '2025-01-02'
): WindowRun {
  return {
    trainMonths,
    symbol: 'TEST',
    status: 'ok',
    folds: [],
    predictions: [
      {
        horizon: 1,
        originDate,
        targetDate: '2025-01-03',
        predictedLogReturn: trainMonths / 1000,
        actualLogReturn: 0.01,
      },
      {
        horizon: 5,
        originDate,
        targetDate: '2025-01-09',
        predictedLogReturn: trainMonths / 500,
        actualLogReturn: -0.02,
      },
    ],
  };
}

describe('training-window matched predictions', () => {
  it('matches all windows on identical origin, target, and actual returns', () => {
    const matched = matchTrainingWindowPredictions([
      run(8),
      run(14),
      run(20),
    ]);
    expect(matched).toHaveLength(2);
    expect(matched[0].predictions).toEqual({ 8: 0.008, 14: 0.014, 20: 0.02 });
    expect(matched[1].predictions).toEqual({ 8: 0.016, 14: 0.028, 20: 0.04 });
  });

  it('matches only the origins available in every window', () => {
    const eightMonths = run(8);
    eightMonths.predictions.pop();
    const matched = matchTrainingWindowPredictions([
      eightMonths,
      run(14),
      run(20),
    ]);
    expect(matched).toHaveLength(1);
    expect(matched[0].horizon).toBe(1);
  });

  it('allows different fold statuses when test boundaries match', () => {
    const skippedFold = {
      horizon: 1,
      testStart: '2023-06-07',
      testEndExclusive: '2023-09-07',
      candidateTrainRows: 240,
      candidateTestRows: 60,
      trainRows: 110,
      testRows: 58,
      status: 'skipped_insufficient_eligible_samples' as const,
    };
    const scoredFold = {
      ...skippedFold,
      trainRows: 150,
      status: 'scored' as const,
    };
    const eightMonths = run(8);
    eightMonths.folds = [skippedFold];
    const fourteenMonths = run(14);
    fourteenMonths.folds = [scoredFold];
    const twentyMonths = run(20);
    twentyMonths.folds = [scoredFold];

    expect(
      matchTrainingWindowPredictions([
        eightMonths,
        fourteenMonths,
        twentyMonths,
      ])
    ).toHaveLength(2);
  });

  it('rejects actual-return mismatches across windows', () => {
    const changed = run(8);
    changed.predictions[0].actualLogReturn = 0.02;
    expect(() =>
      matchTrainingWindowPredictions([changed, run(14), run(20)])
    ).toThrow('actual returns disagree');
  });
});

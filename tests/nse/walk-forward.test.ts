import { describe, expect, it } from 'vitest';
import {
  addCalendarMonths,
  rollingFolds,
} from '../../src/nse/api/walk-forward.js';

function dates() {
  const result: string[] = [];
  for (
    const date = new Date('2023-10-05T00:00:00Z');
    date < new Date('2026-10-05T00:00:00Z');
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      result.push(date.toISOString().slice(0, 10));
  }
  return result;
}

describe('calendar-month rolling train/test split', () => {
  it('uses 14 months for training, three for testing and advances by six months', () => {
    const folds = rollingFolds(dates(), '2023-10-05', '2026-10-05', 5);
    expect(folds).toHaveLength(4);
    expect(
      folds.map((fold) => [
        fold.trainStart,
        fold.trainEndExclusive,
        fold.testEndExclusive,
      ])
    ).toEqual([
      ['2023-10-05', '2024-12-05', '2025-03-05'],
      ['2024-04-05', '2025-06-05', '2025-09-05'],
      ['2024-10-05', '2025-12-05', '2026-03-05'],
      ['2025-04-05', '2026-06-05', '2026-09-05'],
    ]);
  });

  it('purges labels crossing train/test boundaries and uses only actual observed targets', () => {
    const history = dates();
    for (const fold of rollingFolds(history, '2023-10-05', '2026-10-05', 5)) {
      expect(
        fold.trainIndexes.every(
          (index) => history[index + 5] < fold.trainEndExclusive
        )
      ).toBe(true);
      expect(
        fold.testIndexes.every(
          (index) =>
            history[index] >= fold.testStart &&
            history[index + 5] < fold.testEndExclusive
        )
      ).toBe(true);
      expect(
        fold.trainIndexes.some((index) => fold.testIndexes.includes(index))
      ).toBe(false);
    }
  });

  it('clamps calendar month arithmetic at month ends', () => {
    expect(addCalendarMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addCalendarMonths('2025-01-31', 1)).toBe('2025-02-28');
  });
});

import { describe, expect, it } from 'vitest';
import { movingBlockBootstrap } from './analyze-fno-generalization.js';

function pairedRows(candidateLogReturn: number) {
  return Array.from({ length: 40 }, (_, index) => ({
    originDate: new Date(Date.UTC(2025, 0, index + 1))
      .toISOString()
      .slice(0, 10),
    actualLogReturn: 0.01,
    baselineLogReturn: -0.01,
    candidateLogReturn,
  }));
}

describe('F&O generalization analysis', () => {
  it('returns a reproducible block-bootstrap interval for paired forecasts', () => {
    const rows = pairedRows(0.01);
    const first = movingBlockBootstrap(rows, 'fixed-seed', 200, 20);
    const second = movingBlockBootstrap(rows, 'fixed-seed', 200, 20);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      samples: 40,
      blockSessions: 20,
      directionChangePp: 100,
      directionLower95Pp: 100,
      directionUpper95Pp: 100,
    });
  });

  it('reports no direction gain when the paired predictions are unchanged', () => {
    const rows = pairedRows(-0.01);
    const result = movingBlockBootstrap(rows, 'unchanged', 200, 20);

    expect(result.directionChangePp).toBe(0);
    expect(result.directionLower95Pp).toBe(0);
    expect(result.directionUpper95Pp).toBe(0);
    expect(result.mapeChangePp).toBe(0);
  });
});

import { scoreForecastReturns } from './evaluation.js';

export interface ShrinkageObservation {
  predictedLogReturn: number;
  actualLogReturn: number;
}

export interface ShrinkageCalibration {
  factor: number;
  samples: number;
  calibrationMapePct?: number;
}

export interface DatedShrinkageObservation extends ShrinkageObservation {
  targetDate: string;
  horizon: number;
}

const minimumCalibrationSamples = 100;
const shrinkageFactors = Array.from({ length: 11 }, (_, index) => index / 10);

export function selectMaturedShrinkageObservations(
  observations: DatedShrinkageObservation[],
  horizon: number,
  testStart: string
): ShrinkageObservation[] {
  return observations
    .filter(
      (observation) =>
        observation.horizon === horizon &&
        observation.targetDate < testStart
    )
    .map(({ predictedLogReturn, actualLogReturn }) => ({
      predictedLogReturn,
      actualLogReturn,
    }));
}

export function calibratePredictionShrinkage(
  observations: ShrinkageObservation[]
): ShrinkageCalibration {
  if (observations.length < minimumCalibrationSamples)
    return { factor: 0, samples: observations.length };

  let bestFactor = 0;
  let bestMape = Number.POSITIVE_INFINITY;
  for (const factor of shrinkageFactors) {
    const score = scoreForecastReturns(
      observations.map(({ predictedLogReturn, actualLogReturn }) => ({
        predictedLogReturn: factor * predictedLogReturn,
        actualLogReturn,
      }))
    );
    if (score.meanAbsolutePercentageError < bestMape) {
      bestFactor = factor;
      bestMape = score.meanAbsolutePercentageError;
    }
  }

  return {
    factor: bestFactor,
    samples: observations.length,
    calibrationMapePct: bestMape,
  };
}

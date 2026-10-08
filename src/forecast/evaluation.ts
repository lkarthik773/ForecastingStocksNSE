export interface ForecastReturnObservation {
  predictedLogReturn: number;
  actualLogReturn: number;
}

export interface ForecastReturnScore {
  samples: number;
  meanAbsolutePercentageError: number;
  meanAbsoluteLogReturnErrorPct: number;
  naiveMeanAbsolutePercentageError: number;
  directionalAccuracyPct: number;
  beatsNaive: boolean;
}

export function scoreForecastReturns(
  observations: ForecastReturnObservation[]
): ForecastReturnScore {
  if (!observations.length)
    throw new Error('At least one out-of-sample prediction is required.');
  if (observations.some(({ predictedLogReturn, actualLogReturn }) =>
    !Number.isFinite(predictedLogReturn) || !Number.isFinite(actualLogReturn)))
    throw new Error('Out-of-sample log returns must be finite.');

  let modelError = 0;
  let absoluteLogReturnError = 0;
  let naiveError = 0;
  let directionalHits = 0;
  for (const { predictedLogReturn, actualLogReturn } of observations) {
    modelError += Math.abs(Math.expm1(predictedLogReturn - actualLogReturn)) * 100;
    absoluteLogReturnError += Math.abs(predictedLogReturn - actualLogReturn) * 100;
    naiveError += Math.abs(Math.expm1(-actualLogReturn)) * 100;
    if (Math.sign(predictedLogReturn) === Math.sign(actualLogReturn))
      directionalHits++;
  }

  const meanAbsolutePercentageError = modelError / observations.length;
  const naiveMeanAbsolutePercentageError = naiveError / observations.length;
  return {
    samples: observations.length,
    meanAbsolutePercentageError,
    meanAbsoluteLogReturnErrorPct:
      absoluteLogReturnError / observations.length,
    naiveMeanAbsolutePercentageError,
    directionalAccuracyPct: (directionalHits / observations.length) * 100,
    beatsNaive: meanAbsolutePercentageError < naiveMeanAbsolutePercentageError,
  };
}

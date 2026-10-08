export const forecastEvents = [
  'up',
  'gain_over_1pct',
  'loss_below_minus_1pct',
] as const;

export type ForecastEvent = (typeof forecastEvents)[number];

export interface DatedForecastOutcome {
  horizon: number;
  targetDate: string;
  actualLogReturn: number;
}

export interface BinaryProbabilityObservation {
  probability: number;
  occurred: boolean;
}

export interface BinaryProbabilityScore {
  samples: number;
  observedRatePct: number;
  brierScore: number;
  logLoss: number;
}

const minimumPriorOutcomes = 100;
const logLossEpsilon = 1e-15;

export function forecastEventOccurred(
  actualLogReturn: number,
  event: ForecastEvent
): boolean {
  if (!Number.isFinite(actualLogReturn))
    throw new Error('Actual log return must be finite.');
  switch (event) {
    case 'up':
      return actualLogReturn > 0;
    case 'gain_over_1pct':
      return actualLogReturn > Math.log1p(0.01);
    case 'loss_below_minus_1pct':
      return actualLogReturn < Math.log1p(-0.01);
  }
}

export function priorEventProbability(
  observations: DatedForecastOutcome[],
  horizon: number,
  testStart: string,
  event: ForecastEvent
): { probability: number; samples: number; fallback: boolean } {
  const prior = observations.filter(
    (observation) =>
      observation.horizon === horizon &&
      observation.targetDate < testStart
  );
  if (prior.length < minimumPriorOutcomes)
    return { probability: 0.5, samples: prior.length, fallback: true };

  const successes = prior.filter((observation) =>
    forecastEventOccurred(observation.actualLogReturn, event)
  ).length;
  return {
    probability: (successes + 1) / (prior.length + 2),
    samples: prior.length,
    fallback: false,
  };
}

export function scoreBinaryProbabilities(
  observations: BinaryProbabilityObservation[]
): BinaryProbabilityScore {
  if (!observations.length)
    throw new Error('At least one probability forecast is required.');
  if (
    observations.some(
      ({ probability }) =>
        !Number.isFinite(probability) || probability < 0 || probability > 1
    )
  )
    throw new Error('Forecast probabilities must be finite values from 0 to 1.');

  let brierScore = 0;
  let logLoss = 0;
  let successes = 0;
  for (const { probability, occurred } of observations) {
    const outcome = occurred ? 1 : 0;
    const clipped = Math.min(1 - logLossEpsilon, Math.max(logLossEpsilon, probability));
    brierScore += (probability - outcome) ** 2;
    logLoss -= outcome * Math.log(clipped) +
      (1 - outcome) * Math.log(1 - clipped);
    if (occurred) successes++;
  }
  return {
    samples: observations.length,
    observedRatePct: (successes / observations.length) * 100,
    brierScore: brierScore / observations.length,
    logLoss: logLoss / observations.length,
  };
}

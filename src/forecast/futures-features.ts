export interface FuturesObservation {
  date: string;
  spotClose: number;
  futuresClose: number;
  futuresOpenInterest: number;
}

export interface FuturesFeatures {
  futuresPremiumPct: number;
  premiumChange1dPct: number;
  premiumChange5dPct: number;
  futuresOIChange1dPct: number;
  futuresOIChange5dPct: number;
  futuresOIMomentum5v20Pct: number;
  priceUpOIUp: number;
  priceUpOIDown: number;
  priceDownOIUp: number;
  priceDownOIDown: number;
}

export const FUTURES_FEATURE_NAMES = [
  'futuresPremiumPct',
  'premiumChange1dPct',
  'premiumChange5dPct',
  'futuresOIChange1dPct',
  'futuresOIChange5dPct',
  'futuresOIMomentum5v20Pct',
  'priceUpOIUp',
  'priceUpOIDown',
  'priceDownOIUp',
  'priceDownOIDown',
] as const satisfies readonly (keyof FuturesFeatures)[];

export function calculateFuturesFeatures(
  history: FuturesObservation[]
): FuturesFeatures | undefined {
  if (history.length < 21) return undefined;

  for (let index = 0; index < history.length; index++) {
    const row = history[index];
    if (
      !row.date ||
      !Number.isFinite(row.spotClose) ||
      row.spotClose <= 0 ||
      !Number.isFinite(row.futuresClose) ||
      row.futuresClose <= 0 ||
      !Number.isFinite(row.futuresOpenInterest) ||
      row.futuresOpenInterest <= 0 ||
      (index > 0 && row.date <= history[index - 1].date)
    )
      return undefined;
  }

  const current = history.at(-1)!;
  const previous = history.at(-2)!;
  const fiveDaysAgo = history.at(-6)!;
  const oiChangePct = (row: FuturesObservation, prior: FuturesObservation) =>
    ((row.futuresOpenInterest - prior.futuresOpenInterest) /
      prior.futuresOpenInterest) *
    100;
  const premiumPct = (row: FuturesObservation) =>
    ((row.futuresClose - row.spotClose) / row.spotClose) * 100;
  const currentPremium = premiumPct(current);
  const previousPremium = premiumPct(previous);
  const fiveDayPremium = premiumPct(fiveDaysAgo);
  const currentOIChange = oiChangePct(current, previous);
  const fiveDayOIChange = oiChangePct(current, fiveDaysAgo);

  const oiChanges = history
    .slice(-21)
    .slice(1)
    .map((row, index) => oiChangePct(row, history[history.length - 21 + index]));
  const momentum5v20 =
    oiChanges.slice(-5).reduce((sum, value) => sum + value, 0) / 5 -
    oiChanges.reduce((sum, value) => sum + value, 0) / oiChanges.length;
  const priceChangePct =
    ((current.spotClose - previous.spotClose) / previous.spotClose) * 100;
  const priceUp = priceChangePct > 0;
  const priceDown = priceChangePct < 0;
  const oiUp = currentOIChange > 0;
  const oiDown = currentOIChange < 0;

  const features: FuturesFeatures = {
    futuresPremiumPct: currentPremium,
    premiumChange1dPct: currentPremium - previousPremium,
    premiumChange5dPct: currentPremium - fiveDayPremium,
    futuresOIChange1dPct: currentOIChange,
    futuresOIChange5dPct: fiveDayOIChange,
    futuresOIMomentum5v20Pct: momentum5v20,
    priceUpOIUp: Number(priceUp && oiUp),
    priceUpOIDown: Number(priceUp && oiDown),
    priceDownOIUp: Number(priceDown && oiUp),
    priceDownOIDown: Number(priceDown && oiDown),
  };

  return Object.values(features).every(Number.isFinite) ? features : undefined;
}

export function getFuturesFeaturesForObservation(
  observations: FuturesObservation[],
  date: string
): FuturesFeatures | undefined {
  const history = observations.filter((row) => row.date <= date);
  return calculateFuturesFeatures(history);
}

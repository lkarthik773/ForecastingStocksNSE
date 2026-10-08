/**
 * F&O (Futures & Options) Feature Engineering for Forecasting
 *
 * Integrates Open Interest, futures premium, and Put/Call ratio signals
 * to enhance directional forecasting by capturing institutional sentiment.
 *
 * Features Generated:
 * - Futures premium/discount (price difference vs spot)
 * - Open Interest changes (daily, 5-day, 20-day)
 * - Put/Call ratios and OI relationships
 * - Price+OI conviction combinations
 * - Futures volume relative to spot volume
 */

export interface FnoData {
  date: string;
  spotsPrice: number;
  futuresPrice: number;
  futuresOpenInterest: number;
  callOpenInterest: number;
  putOpenInterest: number;
  callVolume: number;
  putVolume: number;
  spotVolume: number;
}

export interface FnoFeatureLookbacks {
  premium: number;
  oiShort: number;
  oiLong: number;
}

export const DEFAULT_FNO_FEATURE_LOOKBACKS: Readonly<FnoFeatureLookbacks> = {
  premium: 5,
  oiShort: 5,
  oiLong: 20,
};

export interface FnoFeatures {
  // Futures Premium Features
  futuresPremiumPct: number; // (Futures - Spot) / Spot * 100
  premiumTrendCh1Day: number; // Premium change 1 day
  premiumTrendCh5Day: number; // Premium change 5 days
  premiumSma5: number; // 5-day SMA of premium

  // Open Interest Features
  totalOIChangePct: number; // (OI[today] - OI[yesterday]) / OI[yesterday] * 100
  callOIChangePct: number; // Call OI change %
  putOIChangePct: number; // Put OI change %
  totalOISma5: number; // 5-day average OI change %
  totalOISma20: number; // 20-day average OI change %

  // Put/Call Ratio Features
  putCallRatio: number; // Put OI / Call OI
  putCallRatioTrend: number; // (PCR[today] - PCR[5day_avg]) / PCR[5day_avg] * 100
  putCallVolumeRatio: number; // Put Volume / Call Volume

  // Conviction Signals (Price + OI Combinations)
  priceUpOIUp: number; // Bullish conviction: +1 if price up AND OI up, else 0
  priceUpOIDown: number; // Weak rally: +1 if price up AND OI down, else 0
  priceDownOIUp: number; // Capitulation: +1 if price down AND OI up, else 0
  priceDownOIDown: number; // Fading decline: +1 if price down AND OI down, else 0

  // Extreme OI Signals
  callOIExtreme: number; // Abnormal call buying: 1 if call OI change > 95th percentile
  putOIExtreme: number; // Abnormal put buying: 1 if put OI change > 95th percentile
  oiSkewFavorsCall: number; // Call OI significantly > Put OI
  oiSkewFavorsPut: number; // Put OI significantly > Call OI

  // Futures Volume Features
  futuresVolumeRelative: number; // Futures volume / (5-day avg futures volume)
  spotVolumeRelative: number; // Spot volume / (5-day avg spot volume)
  callVolumeRelative: number; // Call volume / (5-day avg call volume)
  putVolumeRelative: number; // Put volume / (5-day avg put volume)
  volumeConvergence: number; // Futures volume / Spot volume

  // OI Strength Indicators
  oiMomentum: number; // (OI SMA 5) - (OI SMA 20) normalized
  callPutStrength: number; // (Call OI - Put OI) / Total OI (ranges -1 to +1)
  oiBias: number; // Extreme bias towards calls or puts (-1 to +1 scale)
}

export const FNO_FEATURE_NAMES = [
  'futuresPremiumPct',
  'premiumTrendCh1Day',
  'premiumTrendCh5Day',
  'premiumSma5',
  'totalOIChangePct',
  'callOIChangePct',
  'putOIChangePct',
  'totalOISma5',
  'totalOISma20',
  'putCallRatio',
  'putCallRatioTrend',
  'putCallVolumeRatio',
  'priceUpOIUp',
  'priceUpOIDown',
  'priceDownOIUp',
  'priceDownOIDown',
  'callOIExtreme',
  'putOIExtreme',
  'oiSkewFavorsCall',
  'oiSkewFavorsPut',
  'futuresVolumeRelative',
  'spotVolumeRelative',
  'callVolumeRelative',
  'putVolumeRelative',
  'volumeConvergence',
  'oiMomentum',
  'callPutStrength',
  'oiBias',
] as const satisfies readonly (keyof FnoFeatures)[];

/**
 * Calculate F&O features from historical F&O data
 *
 * @param spotData - Array of spot prices for each date
 * @param fnoData - Array of F&O observations
 * @returns F&O features for the latest observation
 */
export function calculateFnoFeatures(
  spotData: Array<{ date: string; close: number; volume: number }>,
  fnoData: FnoData[],
  lookbacks: FnoFeatureLookbacks = DEFAULT_FNO_FEATURE_LOOKBACKS
): FnoFeatures | null {
  if (
    fnoData.length < 2 ||
    spotData.length < 20 ||
    fnoData[fnoData.length - 1].futuresPrice <= 0 ||
    !Number.isInteger(lookbacks.premium) ||
    !Number.isInteger(lookbacks.oiShort) ||
    !Number.isInteger(lookbacks.oiLong) ||
    lookbacks.premium < 1 ||
    lookbacks.oiShort < 1 ||
    lookbacks.oiLong < lookbacks.oiShort ||
    lookbacks.oiLong > 20
  ) {
    return null;
  }

  const today = fnoData[fnoData.length - 1];
  
  // Check for NaN values in latest F&O data
  if (
    !Number.isFinite(today.spotsPrice) ||
    !Number.isFinite(today.futuresPrice) ||
    !Number.isFinite(today.futuresOpenInterest) ||
    !Number.isFinite(today.callOpenInterest) ||
    !Number.isFinite(today.putOpenInterest) ||
    !Number.isFinite(today.callVolume) ||
    !Number.isFinite(today.putVolume) ||
    !Number.isFinite(today.spotVolume)
  ) {
    return null;
  }

  const yesterday = fnoData[fnoData.length - 2];

  // =================================================================
  // 1. FUTURES PREMIUM FEATURES
  // =================================================================
  const futuresPremiumPct =
    ((today.futuresPrice - today.spotsPrice) / today.spotsPrice) * 100;

  const yesterdayPremium =
    ((yesterday.futuresPrice - yesterday.spotsPrice) / yesterday.spotsPrice) *
    100;
  const premiumTrendCh1Day = futuresPremiumPct - yesterdayPremium;

  // 5-day premium trend
  const premiumTrendCh5Day =
    fnoData.length > lookbacks.premium
      ? futuresPremiumPct -
        (((fnoData[fnoData.length - lookbacks.premium - 1].futuresPrice -
          fnoData[fnoData.length - lookbacks.premium - 1].spotsPrice) /
          fnoData[fnoData.length - lookbacks.premium - 1].spotsPrice) *
          100)
      : futuresPremiumPct;

  // 5-day SMA of premium
  const premiumSma5 =
    fnoData
      .slice(-lookbacks.premium)
      .reduce(
        (sum, d) =>
          sum +
          ((d.futuresPrice - d.spotsPrice) / d.spotsPrice) *
            100,
        0
      ) / Math.min(fnoData.length, lookbacks.premium);

  // =================================================================
  // 2. OPEN INTEREST FEATURES
  // =================================================================
  const totalOIChange = today.futuresOpenInterest - yesterday.futuresOpenInterest;
  const totalOIChangePct =
    yesterday.futuresOpenInterest > 0
      ? (totalOIChange / yesterday.futuresOpenInterest) * 100
      : 0;

  const callOIChange = today.callOpenInterest - yesterday.callOpenInterest;
  const callOIChangePct =
    yesterday.callOpenInterest > 0
      ? (callOIChange / yesterday.callOpenInterest) * 100
      : 0;

  const putOIChange = today.putOpenInterest - yesterday.putOpenInterest;
  const putOIChangePct =
    yesterday.putOpenInterest > 0
      ? (putOIChange / yesterday.putOpenInterest) * 100
      : 0;

  // 5-day and 20-day SMA of total OI change %
  const oiChanges = fnoData.slice(-lookbacks.oiShort).map((d, i, arr) => {
    if (i === 0) return 0;
    return arr[i - 1].futuresOpenInterest > 0
      ? ((d.futuresOpenInterest - arr[i - 1].futuresOpenInterest) /
          arr[i - 1].futuresOpenInterest) *
        100
      : 0;
  });
  const totalOISma5 = oiChanges.reduce((a, b) => a + b, 0) / oiChanges.length;

  const oiChanges20 = fnoData.slice(-lookbacks.oiLong).map((d, i, arr) => {
    if (i === 0) return 0;
    return arr[i - 1].futuresOpenInterest > 0
      ? ((d.futuresOpenInterest - arr[i - 1].futuresOpenInterest) /
          arr[i - 1].futuresOpenInterest) *
        100
      : 0;
  });
  const totalOISma20 =
    oiChanges20.reduce((a, b) => a + b, 0) / oiChanges20.length;

  // =================================================================
  // 3. PUT/CALL RATIO FEATURES
  // =================================================================
  const putCallRatio =
    today.callOpenInterest > 0
      ? today.putOpenInterest / today.callOpenInterest
      : 0;

  // PCR trend
  const pcr5DayAvg =
    fnoData
      .slice(-5)
      .reduce(
        (sum, d) => sum + (d.callOpenInterest > 0 ? d.putOpenInterest / d.callOpenInterest : 0),
        0
      ) / Math.min(fnoData.length, 5);

  const putCallRatioTrend =
    pcr5DayAvg > 0
      ? ((putCallRatio - pcr5DayAvg) / pcr5DayAvg) * 100
      : 0;

  const putCallVolumeRatio =
    today.callVolume > 0 ? today.putVolume / today.callVolume : 0;

  // =================================================================
  // 4. CONVICTION SIGNALS (Price + OI Combinations)
  // =================================================================
  // Get spot price change
  const spotPriceChange = today.spotsPrice - yesterday.spotsPrice;
  const priceUp = spotPriceChange > 0 ? 1 : 0;
  const oiUp = totalOIChange > 0 ? 1 : 0;

  const priceUpOIUp = priceUp && oiUp ? 1 : 0; // Bullish conviction
  const priceUpOIDown = priceUp && !oiUp ? 1 : 0; // Weak rally
  const priceDownOIUp = !priceUp && oiUp ? 1 : 0; // Capitulation
  const priceDownOIDown = !priceUp && !oiUp ? 1 : 0; // Fading decline

  // =================================================================
  // 5. EXTREME OI SIGNALS
  // =================================================================
  // Calculate 95th percentile of OI changes
  const callOIChanges = fnoData
    .slice(-20)
    .map((d, i, arr) => {
      if (i === 0) return 0;
      return arr[i - 1].callOpenInterest > 0
        ? Math.abs(
            (d.callOpenInterest - arr[i - 1].callOpenInterest) /
              arr[i - 1].callOpenInterest
          ) * 100
        : 0;
    });

  const putOIChanges = fnoData
    .slice(-20)
    .map((d, i, arr) => {
      if (i === 0) return 0;
      return arr[i - 1].putOpenInterest > 0
        ? Math.abs(
            (d.putOpenInterest - arr[i - 1].putOpenInterest) /
              arr[i - 1].putOpenInterest
          ) * 100
        : 0;
    });

  const callOIPercentile95 =
    callOIChanges.sort((a, b) => a - b)[
      Math.floor(callOIChanges.length * 0.95)
    ] || 0;
  const putOIPercentile95 =
    putOIChanges.sort((a, b) => a - b)[
      Math.floor(putOIChanges.length * 0.95)
    ] || 0;

  const callOIExtreme = Math.abs(callOIChangePct) > callOIPercentile95 ? 1 : 0;
  const putOIExtreme = Math.abs(putOIChangePct) > putOIPercentile95 ? 1 : 0;

  // =================================================================
  // 6. OI SKEW INDICATORS
  // =================================================================
  const totalOI = today.callOpenInterest + today.putOpenInterest;
  const callPctOfTotal =
    totalOI > 0 ? today.callOpenInterest / totalOI : 0.5;

  // Call OI significantly > Put OI means bullish skew
  const oiSkewFavorsCall =
    callPctOfTotal > 0.6 ? (callPctOfTotal - 0.5) * 2 : 0;
  const oiSkewFavorsPut =
    callPctOfTotal < 0.4 ? (0.5 - callPctOfTotal) * 2 : 0;

  // =================================================================
  // 7. FUTURES VOLUME FEATURES
  // =================================================================
  const futuresVolume5DayAvg =
    (fnoData.slice(-5).reduce((sum, d) => sum + d.callVolume + d.putVolume, 0)) /
    Math.min(fnoData.length, 5);

  const spotVolume5DayAvg =
    (spotData.slice(-5).reduce((sum, d) => sum + d.volume, 0)) /
    Math.min(spotData.length, 5);

  const futuresVolumeRelative =
    futuresVolume5DayAvg > 0
      ? (today.callVolume + today.putVolume) / futuresVolume5DayAvg
      : 1;

  const spotVolumeRelative =
    spotVolume5DayAvg > 0
      ? today.spotVolume / spotVolume5DayAvg
      : 1;

  const volumeConvergence =
    today.spotVolume > 0
      ? (today.callVolume + today.putVolume) / today.spotVolume
      : 0;

  // Call and Put volume relative to their 5-day averages
  const callVolume5DayAvg =
    (fnoData.slice(-5).reduce((sum, d) => sum + d.callVolume, 0)) /
    Math.min(fnoData.length, 5);

  const putVolume5DayAvg =
    (fnoData.slice(-5).reduce((sum, d) => sum + d.putVolume, 0)) /
    Math.min(fnoData.length, 5);

  const callVolumeRelative =
    callVolume5DayAvg > 0 ? today.callVolume / callVolume5DayAvg : 1;

  const putVolumeRelative =
    putVolume5DayAvg > 0 ? today.putVolume / putVolume5DayAvg : 1;

  // =================================================================
  // 8. OI MOMENTUM & BIAS INDICATORS
  // =================================================================
  const oiMomentum = totalOISma5 - totalOISma20;

  const callPutDiff =
    today.callOpenInterest - today.putOpenInterest;
  const callPutStrength =
    totalOI > 0
      ? (callPutDiff / totalOI) * 2 // Normalized to -1 to +1
      : 0;

  // OI Bias: extreme skew towards calls or puts
  let oiBias = 0;
  if (callPctOfTotal > 0.65) {
    oiBias = Math.min(1, (callPctOfTotal - 0.65) * 5); // Max 1
  } else if (callPctOfTotal < 0.35) {
    oiBias = Math.max(-1, (0.35 - callPctOfTotal) * 5); // Min -1
  }

  return {
    futuresPremiumPct,
    premiumTrendCh1Day,
    premiumTrendCh5Day,
    premiumSma5,

    totalOIChangePct,
    callOIChangePct,
    putOIChangePct,
    totalOISma5,
    totalOISma20,

    putCallRatio,
    putCallRatioTrend,
    putCallVolumeRatio,

    priceUpOIUp,
    priceUpOIDown,
    priceDownOIUp,
    priceDownOIDown,

    callOIExtreme,
    putOIExtreme,
    oiSkewFavorsCall,
    oiSkewFavorsPut,

    futuresVolumeRelative,
    spotVolumeRelative,
    callVolumeRelative,
    putVolumeRelative,
    volumeConvergence,

    oiMomentum,
    callPutStrength,
    oiBias,
  };
}

/**
 * Validate F&O data consistency
 */
export function validateFnoData(fnoData: FnoData[]): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!Array.isArray(fnoData) || fnoData.length === 0) {
    errors.push("F&O data array is empty");
    return { isValid: false, errors };
  }

  for (let i = 0; i < fnoData.length; i++) {
    const d = fnoData[i];

    if (!d.date) errors.push(`Row ${i}: Missing date`);
    if (!Number.isFinite(d.spotsPrice) || d.spotsPrice <= 0) errors.push(`Row ${i}: Invalid spot price`);
    if (!Number.isFinite(d.futuresPrice) || d.futuresPrice <= 0) errors.push(`Row ${i}: Invalid futures price`);
    if (!Number.isFinite(d.futuresOpenInterest) || d.futuresOpenInterest < 0)
      errors.push(`Row ${i}: Invalid futures OI`);
    if (!Number.isFinite(d.callOpenInterest) || d.callOpenInterest < 0) errors.push(`Row ${i}: Invalid call OI`);
    if (!Number.isFinite(d.putOpenInterest) || d.putOpenInterest < 0) errors.push(`Row ${i}: Invalid put OI`);
    if (!Number.isFinite(d.callVolume) || d.callVolume < 0) errors.push(`Row ${i}: Invalid call volume`);
    if (!Number.isFinite(d.putVolume) || d.putVolume < 0) errors.push(`Row ${i}: Invalid put volume`);
    if (!Number.isFinite(d.spotVolume) || d.spotVolume < 0) errors.push(`Row ${i}: Invalid spot volume`);
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Summary of F&O feature interpretations for model training
 *
 * High Signal Features (use these for model training):
 * - futuresPremiumPct: Futures premium indicates market sentiment (positive = bullish)
 * - putCallRatio: PCR < 1 = bullish (more calls), PCR > 1 = bearish (more puts)
 * - priceUpOIUp: Bullish conviction (strong trend likely to continue)
 * - priceDownOIUp: Capitulation (exhaustion, potential reversal)
 * - callPutStrength: Normalized bias towards calls (positive) or puts (negative)
 * - oiMomentum: OI accelerating (positive) or decelerating (negative)
 *
 * Medium Signal Features (use for ensemble):
 * - premiumTrendCh5Day: Premium trend change (momentum)
 * - putCallRatioTrend: PCR moving toward extremes
 * - oiBias: Extreme skew towards one side
 *
 * Low Signal Features (monitoring only):
 * - premiumTrendCh1Day: Too noisy, use 5-day instead
 * - callOIExtreme & putOIExtreme: Rare signals, good for anomaly detection
 * - volumeConvergence: May be useful with more research
 */

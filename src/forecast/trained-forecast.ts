import { RSI, EMA, MACD, SMA, BollingerBands } from 'technicalindicators';
import { rollingFolds, addCalendarMonths } from './walk-forward.js';
import { runLightGbm, type LightGbmTask } from './lightgbm.js';
import { scoreForecastReturns } from './evaluation.js';
import {
  calculateFnoFeatures,
  FNO_FEATURE_NAMES,
  type FnoData,
  type FnoFeatureLookbacks,
  type FnoFeatures,
} from './fno-features.js';
import {
  FUTURES_FEATURE_NAMES,
  type FuturesFeatures,
} from './futures-features.js';
import {
  forecastEventOccurred,
  forecastEvents,
  type ForecastEvent,
} from './target-outcomes.js';
import { fitLogisticClassifier } from './probability-classifier.js';

export interface TrainingObservation {
  date: string;
  close: number;
  volume?: number;
  open?: number;
  high?: number;
  low?: number;
  qualityExcluded?: boolean;
  fnoFeatures?: FnoFeatures;
  futuresFeatures?: FuturesFeatures;
}
export interface TrainingMarketObservation {
  date: string;
  close: number;
}
export type TrainingFeatureSet =
  | 'close_only'
  | 'ohlc'
  | 'market_context'
  | 'advanced_technical'
  | 'volume'
  | 'technical_fno'
  | 'technical_futures';
export interface TrainingSentiment {
  date: string;
  asOf: string;
  polarity: number;
  articles: number;
}
export interface TrainedForecast {
  points: { sessions: number; logReturn: number; errorRadius: number }[];
  evaluation: {
    samples: number;
    qualityExcludedSamples: number;
    unscoredEligibleSamples: number;
    meanAbsolutePercentageError: number;
    naiveMeanAbsolutePercentageError: number;
    directionalAccuracyPct: number;
    intervalCoveragePct: number;
    coverageSamples: number;
    beatsNaive: boolean;
  };
  training: {
    algorithm: string;
    features: string[];
    trainingRows: number;
    sentimentDays: number;
    trainedThrough: string;
    validation: string;
    includesFinBert: boolean;
    trainMonths: number;
    testMonths: 3;
    stepMonths: number;
    folds: {
      horizon: number;
      trainStart: string;
      trainEndExclusive: string;
      testStart: string;
      testEndExclusive: string;
      candidateTrainRows: number;
      candidateTestRows: number;
      trainRows: number;
      testRows: number;
      qualityExcludedTrainRows: number;
      qualityExcludedTestRows: number;
      featureUnavailableTrainRows: number;
      featureUnavailableTestRows: number;
      status: 'scored' | 'skipped_insufficient_eligible_samples';
    }[];
    outOfSampleForecasts: {
      horizon: number;
      originDate: string;
      targetDate: string;
      predictedLogReturn: number;
      baselinePredictedLogReturn?: number;
      actualLogReturn: number;
      fold: number;
      predictionIntervalRadius?: number;
    }[];
    outOfSampleProbabilities?: {
      horizon: number;
      event: ForecastEvent;
      originDate: string;
      targetDate: string;
      actualLogReturn: number;
      probability: number;
      occurred: boolean;
      fold: number;
      testStart: string;
      testEndExclusive: string;
    }[];
  };
  indicators: {
    rsi14: number;
    ema12: number;
    ema26: number;
    macdHistogram: number;
    sma20: number;
    sma50: number;
    bollingerPercentB: number;
    bollingerBandwidth: number;
    roc10: number;
    roc20: number;
    volatility20: number;
  };
}

export interface CurrentProbabilityPrediction {
  horizon: 1 | 5;
  event: ForecastEvent;
  probability: number;
  trainingRows: number;
  positiveTrainingRows: number;
  negativeTrainingRows: number;
}

export function technicalFeatures(closes: number[]) {
  if (
    closes.length < 60 ||
    closes.some((close) => !Number.isFinite(close) || close <= 0)
  )
    throw new Error(
      'At least 60 valid positive closes are required for indicators.'
    );
  const last = closes[closes.length - 1];
  const sma20 = SMA.calculate({ values: closes, period: 20 }).at(-1)!;
  const sma50 = SMA.calculate({ values: closes, period: 50 }).at(-1)!;
  const ema12 = EMA.calculate({ values: closes, period: 12 }).at(-1)!;
  const ema26 = EMA.calculate({ values: closes, period: 26 }).at(-1)!;
  const rsi14 = RSI.calculate({ values: closes, period: 14 }).at(-1)!;
  const macd = MACD.calculate({
    values: closes,
    fastPeriod: 12,
    slowPeriod: 26,
    signalPeriod: 9,
    SimpleMAOscillator: false,
    SimpleMASignal: false,
  }).at(-1)!;
  const bollinger = BollingerBands.calculate({
    values: closes,
    period: 20,
    stdDev: 2,
  }).at(-1)!;
  const bollingerPercentB =
    bollinger.upper === bollinger.lower
      ? 0.5
      : (last - bollinger.lower) / (bollinger.upper - bollinger.lower);
  const bollingerBandwidth =
    (bollinger.upper - bollinger.lower) / bollinger.middle;
  const returns = closes
    .slice(-21)
    .slice(1)
    .map(
      (close, index) =>
        Math.log(close) - Math.log(closes[closes.length - 21 + index])
    );
  const mean =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const volatility20 = Math.sqrt(
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) /
      (returns.length - 1)
  );
  const indicators = {
    rsi14,
    ema12,
    ema26,
    macdHistogram: macd.histogram ?? 0,
    sma20,
    sma50,
    bollingerPercentB,
    bollingerBandwidth,
    roc10: Math.log(last / closes.at(-11)!),
    roc20: Math.log(last / closes.at(-21)!),
    volatility20,
  };
  const features = [
    Math.log(last / closes.at(-2)!),
    Math.log(last / closes.at(-6)!),
    Math.log(last / sma20),
    Math.log(last / sma50),
    Math.log(ema12 / ema26),
    rsi14 / 100,
    indicators.macdHistogram / last,
    bollingerPercentB,
    bollingerBandwidth,
    indicators.roc10,
    indicators.roc20,
    volatility20,
  ];
  if (!features.every(Number.isFinite))
    throw new Error('Indicators could not be calculated from this history.');
  return { features, indicators };
}

export function ohlcFeatures(observations: TrainingObservation[]) {
  const recent = observations.slice(-20);
  if (
    recent.length < 20 ||
    recent.some(
      (row) =>
        row.open === undefined ||
        row.high === undefined ||
        row.low === undefined ||
        !Number.isFinite(row.open) ||
        !Number.isFinite(row.high) ||
        !Number.isFinite(row.low) ||
        row.open <= 0 ||
        row.low <= 0 ||
        row.high < Math.max(row.open, row.close) ||
        row.low > Math.min(row.open, row.close) ||
        row.high < row.low
    )
  )
    return undefined;

  const current = recent.at(-1)!;
  const previous = recent.at(-2)!;
  const intradayRangePct =
    (current.high! - current.low!) / current.close;
  const intradayBodyReturn = Math.log(current.close / current.open!);
  const closeLocationWithinRange =
    current.high === current.low
      ? 0
      : (2 * current.close - current.high! - current.low!) /
        (current.high! - current.low!);
  const overnightGapReturn = Math.log(current.open! / previous.close);
  const meanRangePct20 =
    recent.reduce(
      (sum, row) => sum + (row.high! - row.low!) / row.close,
      0
    ) / recent.length;
  const features = [
    intradayRangePct,
    intradayBodyReturn,
    closeLocationWithinRange,
    overnightGapReturn,
    meanRangePct20,
  ];
  return features.every(Number.isFinite) ? features : undefined;
}

export function marketContextFeatures(
  observations: TrainingMarketObservation[],
  date: string
) {
  const currentIndex = observations.findIndex((row) => row.date === date);
  if (currentIndex < 20) return undefined;
  const history = observations.slice(currentIndex - 20, currentIndex + 1);
  if (
    history.length !== 21 ||
    history.some(
      (row, index) =>
        !Number.isFinite(row.close) ||
        row.close <= 0 ||
        (index > 0 && row.date <= history[index - 1].date)
    )
  )
    return undefined;
  const returns = history.slice(1).map((row, index) =>
    Math.log(row.close / history[index].close)
  );
  const meanReturn =
    returns.reduce((total, value) => total + value, 0) / returns.length;
  const volatility20 = Math.sqrt(
    returns.reduce((total, value) => total + (value - meanReturn) ** 2, 0) /
      (returns.length - 1)
  );
  const features = [
    returns.at(-1)!,
    returns.slice(-5).reduce((total, value) => total + value, 0),
    returns.reduce((total, value) => total + value, 0),
    volatility20,
  ];
  return features.every(Number.isFinite) ? features : undefined;
}

export function advancedTechnicalFeatures(closes: number[]) {
  if (
    closes.length < 61 ||
    closes.some((close) => !Number.isFinite(close) || close <= 0)
  )
    return undefined;
  const returns = closes
    .slice(-61)
    .slice(1)
    .map((close, index) => Math.log(close / closes[closes.length - 61 + index]));
  const volatility = (values: number[]) => {
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return Math.sqrt(
      values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
        (values.length - 1)
    );
  };
  const downsideReturns = returns.slice(-20).filter((value) => value < 0);
  const downsideVolatility20 = downsideReturns.length
    ? Math.sqrt(
        downsideReturns.reduce((sum, value) => sum + value ** 2, 0) /
          downsideReturns.length
      )
    : 0;
  const lagged = returns.slice(-21, -1);
  const current = returns.slice(-20);
  const meanLagged =
    lagged.reduce((sum, value) => sum + value, 0) / lagged.length;
  const meanCurrent =
    current.reduce((sum, value) => sum + value, 0) / current.length;
  const covariance = lagged.reduce(
    (sum, value, index) =>
      sum + (value - meanLagged) * (current[index] - meanCurrent),
    0
  );
  const laggedVariance = lagged.reduce(
    (sum, value) => sum + (value - meanLagged) ** 2,
    0
  );
  const currentVariance = current.reduce(
    (sum, value) => sum + (value - meanCurrent) ** 2,
    0
  );
  const returnAutocorrelation20 =
    laggedVariance && currentVariance
      ? covariance / Math.sqrt(laggedVariance * currentVariance)
      : 0;
  const pathLength20 = current.reduce(
    (sum, value) => sum + Math.abs(value),
    0
  );
  const trendEfficiency20 =
    pathLength20 === 0
      ? 0
      : Math.abs(current.reduce((sum, value) => sum + value, 0)) /
        pathLength20;
  const features = [
    volatility(returns.slice(-5)),
    volatility(returns),
    downsideVolatility20,
    returnAutocorrelation20,
    trendEfficiency20,
  ];
  return features.every(Number.isFinite) ? features : undefined;
}

export function relativeVolumeFeature(
  observations: TrainingObservation[],
  index: number,
  actionExDates: string[] = []
): number | undefined {
  const current = observations[index];
  if (
    !current ||
    !Number.isFinite(current.volume) ||
    current.volume! <= 0 ||
    index < 20
  )
    return undefined;
  let latestActionIndex = -1;
  for (const exDate of actionExDates) {
    if (exDate > current.date) continue;
    const resetIndex = observations.findIndex((row) => row.date >= exDate);
    if (resetIndex >= 0) latestActionIndex = Math.max(latestActionIndex, resetIndex);
  }
  if (index - latestActionIndex < 20) return undefined;
  const priorVolumes = observations
    .slice(index - 20, index)
    .map((row) => row.volume);
  if (
    priorVolumes.length !== 20 ||
    priorVolumes.some((volume) => !Number.isFinite(volume) || volume! <= 0)
  )
    return undefined;
  const sorted = priorVolumes
    .map((volume) => volume!)
    .sort((left, right) => left - right);
  const baseline = (sorted[9] + sorted[10]) / 2;
  const feature = Math.log(current.volume! / baseline);
  return Number.isFinite(feature) ? feature : undefined;
}

export function getFnoFeaturesForObservation(
  observations: TrainingObservation[],
  index: number,
  fnoData: FnoData[],
  lookbacks?: FnoFeatureLookbacks
): FnoFeatures | undefined {
  const observation = observations[index];
  if (!observation || !fnoData.length) return undefined;
  const throughDate = fnoData.filter((row) => row.date <= observation.date);
  if (throughDate.length < 2) return undefined;
  const spotData = observations.slice(0, index + 1).map((row) => ({
    date: row.date,
    close: row.close,
    volume: row.volume ?? 0,
  }));
  return calculateFnoFeatures(spotData, throughDate, lookbacks) ?? undefined;
}

function qualityMasks(observations: TrainingObservation[]) {
  const qualityExcludedPrefix = [0];
  for (const row of observations)
    qualityExcludedPrefix.push(
      qualityExcludedPrefix.at(-1)! + (row.qualityExcluded ? 1 : 0)
    );
  const hasQualityExcludedObservation = (start: number, end: number) =>
    qualityExcludedPrefix[Math.min(observations.length, end + 1)] -
      qualityExcludedPrefix[Math.max(0, start)] >
    0;
  return {
    hasQualityAffectedSample: (index: number, horizon: number) =>
      hasQualityExcludedObservation(index - 59, index + horizon),
    cleanFeatureHistory: observations.map(
      (_, index) =>
        index >= 59 && !hasQualityExcludedObservation(index - 59, index)
    ),
  };
}

export function trainCurrentProbabilitySnapshot(
  observations: TrainingObservation[],
  events: ForecastEvent[],
  historyEndExclusive: string
): CurrentProbabilityPrediction[] {
  if (
    observations.length < 600 ||
    observations.some(
      (row, index) =>
        !Number.isFinite(row.close) ||
        row.close <= 0 ||
        (index > 0 && row.date <= observations[index - 1].date)
    )
  )
    throw new Error('Probability training needs at least 600 sorted positive closes.');
  if (
    new Set(events).size !== events.length ||
    events.some((event) => !forecastEvents.includes(event)) ||
    !events.length
  )
    throw new Error('Probability snapshot events must be non-empty and unique.');

  const lastIndex = observations.length - 1;
  const { hasQualityAffectedSample, cleanFeatureHistory } =
    qualityMasks(observations);
  if (!cleanFeatureHistory[lastIndex])
    throw new Error(
      'The latest 60-session feature window contains a flagged intraday reversal candle.'
    );
  const finalStart = addCalendarMonths(historyEndExclusive, -14);
  const features = new Map<number, number[]>();
  for (let index = 59; index < lastIndex; index++) {
    if (
      observations[index].date >= finalStart &&
      cleanFeatureHistory[index]
    )
      features.set(
        index,
        technicalFeatures(
          observations.slice(0, index + 1).map((item) => item.close)
        ).features
      );
  }
  const currentFeature = technicalFeatures(
    observations.map((row) => row.close)
  ).features;
  const predictions: CurrentProbabilityPrediction[] = [];

  for (const horizon of [1, 5] as const) {
    const trainingIndexes = observations.flatMap((row, index) =>
      row.date >= finalStart &&
      index + horizon <= lastIndex &&
      cleanFeatureHistory[index] &&
      !hasQualityAffectedSample(index, horizon) &&
      features.has(index)
        ? [index]
        : []
    );
    if (trainingIndexes.length < 120)
      throw new Error(
        `Probability model has fewer than 120 completed training labels for horizon ${horizon}.`
      );
    const labels = trainingIndexes.map((index) =>
      Math.log(observations[index + horizon].close / observations[index].close)
    );
    for (const event of events) {
      const binaryLabels = labels.map((label) =>
        Number(forecastEventOccurred(label, event))
      );
      const positiveTrainingRows = binaryLabels.filter(
        (label) => label === 1
      ).length;
      const negativeTrainingRows = binaryLabels.length - positiveTrainingRows;
      if (positiveTrainingRows < 10 || negativeTrainingRows < 10)
        throw new Error(
          `Probability model needs at least 10 positive and 10 negative training examples for ${event}, horizon ${horizon}.`
        );
      const predict = fitLogisticClassifier(
          trainingIndexes.map((index) => features.get(index)!),
        binaryLabels
      );
      const probability = predict(currentFeature);
      if (!Number.isFinite(probability) || probability < 0 || probability > 1)
        throw new Error('Current logistic probability prediction is invalid.');
      predictions.push({
        horizon,
        event,
        probability,
        trainingRows: trainingIndexes.length,
        positiveTrainingRows,
        negativeTrainingRows,
      });
    }
  }
  return predictions;
}

export async function trainForecast(
  observations: TrainingObservation[],
  sessions: number[],
  sentiments?: TrainingSentiment[],
  latestSentiment?: { polarity: number; articles: number },
  window?: { from: string; toExclusive: string },
  stepMonths = 6,
  featureSet: TrainingFeatureSet = 'close_only',
  marketObservations: TrainingMarketObservation[] = [],
  actionExDates: string[] = [],
  probabilityEvents: ForecastEvent[] = [],
  trainMonths = 14,
  foldAnchorTrainMonths = trainMonths
): Promise<TrainedForecast> {
  if (
    observations.length < 600 ||
    !sessions.length ||
    sessions.some(
      (value) => !Number.isInteger(value) || value < 1 || value > 15
    )
  )
    throw new Error(
      'LightGBM training needs at least 600 prices across three years and horizons of 1 to 15 sessions.'
    );
  if (
    observations.some(
      (row, index) =>
        !Number.isFinite(row.close) ||
        row.close <= 0 ||
        (index > 0 && row.date <= observations[index - 1].date)
    )
  )
    throw new Error('Training prices must be positive, sorted and unique.');
  const historyStart = window?.from ?? observations[0].date;
  const end =
    window?.toExclusive ??
    new Date(Date.parse(observations.at(-1)!.date) + 86400000)
      .toISOString()
      .slice(0, 10);
  if (!Number.isInteger(stepMonths) || stepMonths < 1 || stepMonths > 24)
    throw new Error('Walk-forward advance must be between 1 and 24 months.');
  if (
    !Number.isInteger(trainMonths) ||
    trainMonths < 6 ||
    trainMonths > 60 ||
    !Number.isInteger(foldAnchorTrainMonths) ||
    foldAnchorTrainMonths < trainMonths ||
    foldAnchorTrainMonths > 120
  )
    throw new Error('Training and common test-anchor windows are invalid.');
  const foldHistoryStart = addCalendarMonths(
    historyStart,
    foldAnchorTrainMonths - trainMonths
  );
  const supportedFeatureSets: readonly string[] = [
    'close_only',
    'ohlc',
    'market_context',
    'advanced_technical',
    'volume',
    'technical_fno',
    'technical_futures',
  ];
  if (!supportedFeatureSets.includes(featureSet))
    throw new Error('Unknown experimental training feature set.');
  if (
    new Set(probabilityEvents).size !== probabilityEvents.length ||
    probabilityEvents.some((event) => !forecastEvents.includes(event)) ||
    (probabilityEvents.length && !sessions.some((horizon) => horizon === 1 || horizon === 5))
  )
    throw new Error('Probability benchmark events must be unique and include a one- or five-session horizon.');
  const news = new Map<string, TrainingSentiment>();
  for (const row of sentiments ?? []) {
    const cutoff = Date.parse(`${row.date}T15:30:00+05:30`);
    if (
      !Number.isFinite(Date.parse(row.asOf)) ||
      Date.parse(row.asOf) > cutoff ||
      !Number.isFinite(row.polarity) ||
      Math.abs(row.polarity) > 1 ||
      !Number.isInteger(row.articles) ||
      row.articles < 3
    )
      continue;
    if (news.has(row.date))
      throw new Error('Conflicting daily sentiment feature rows.');
    news.set(row.date, row);
  }
  const includesFinBert = sentiments !== undefined;
  const ohlcFeatureNames = [
    'intradayRangePct',
    'intradayBodyReturn',
    'closeLocationWithinRange',
    'overnightGapReturn',
    'meanRangePct20',
  ];
  const marketFeatureNames = [
    'marketReturn1',
    'marketReturn5',
    'marketReturn20',
    'marketVolatility20',
  ];
  const advancedTechnicalFeatureNames = [
    'realizedVolatility5',
    'realizedVolatility60',
    'downsideVolatility20',
    'returnAutocorrelation20',
    'trendEfficiency20',
  ];
  const volumeFeatureNames = ['logVolumeVsPriorMedian20'];
  const candidateFeatureCount =
    featureSet === 'ohlc'
      ? ohlcFeatureNames.length
      : featureSet === 'market_context'
        ? marketFeatureNames.length
        : featureSet === 'advanced_technical'
          ? advancedTechnicalFeatureNames.length
          : featureSet === 'volume'
            ? volumeFeatureNames.length
            : featureSet === 'technical_fno'
              ? FNO_FEATURE_NAMES.length
              : featureSet === 'technical_futures'
                ? FUTURES_FEATURE_NAMES.length
          : 0;
  const dimension = 12 + candidateFeatureCount + (includesFinBert ? 2 : 0);
  const { hasQualityAffectedSample, cleanFeatureHistory } =
    qualityMasks(observations);
  const ohlcByDate = observations.map((_, index) =>
    featureSet === 'ohlc'
      ? ohlcFeatures(observations.slice(0, index + 1))
      : []
  );
  const advancedTechnicalByDate = observations.map((_, index) =>
    featureSet === 'advanced_technical'
      ? advancedTechnicalFeatures(
          observations.slice(0, index + 1).map((row) => row.close)
        )
      : []
  );
  const volumeByDate = observations.map((_, index) =>
    featureSet === 'volume'
      ? relativeVolumeFeature(observations, index, actionExDates)
      : undefined
  );
  const fnoByDate = observations.map((row) => {
    if (featureSet !== 'technical_fno' || !row.fnoFeatures)
      return undefined;
    const vector = FNO_FEATURE_NAMES.map((name) => row.fnoFeatures![name]);
    return vector.every(Number.isFinite) ? row.fnoFeatures : undefined;
  });
  const futuresByDate = observations.map((row) => {
    if (featureSet !== 'technical_futures' || !row.futuresFeatures)
      return undefined;
    const vector = FUTURES_FEATURE_NAMES.map(
      (name) => row.futuresFeatures![name]
    );
    return vector.every(Number.isFinite) ? vector : undefined;
  });
  const featureAvailable = observations.map(
    (_, index) =>
      (featureSet !== 'ohlc' || ohlcByDate[index] !== undefined) &&
      (featureSet !== 'advanced_technical' ||
        advancedTechnicalByDate[index] !== undefined) &&
      (featureSet !== 'market_context' ||
        marketContextFeatures(marketObservations, observations[index].date) !==
          undefined) &&
      (featureSet !== 'volume' || volumeByDate[index] !== undefined) &&
      (featureSet !== 'technical_fno' || fnoByDate[index] !== undefined) &&
      (featureSet !== 'technical_futures' ||
        futuresByDate[index] !== undefined)
  );
  const available = observations.map(
    (row, index) =>
      cleanFeatureHistory[index] &&
      featureAvailable[index] &&
      (!includesFinBert || news.has(row.date))
  );
  const features = observations.map((row, index) => {
    if (!available[index]) return Array(dimension).fill(0) as number[];
    const technical = technicalFeatures(
      observations.slice(0, index + 1).map((item) => item.close)
    );
    const sentiment = news.get(row.date);
    return [
      ...technical.features,
      ...(featureSet === 'ohlc' ? ohlcByDate[index]! : []),
      ...(featureSet === 'advanced_technical'
        ? advancedTechnicalByDate[index]!
        : []),
      ...(featureSet === 'market_context'
        ? marketContextFeatures(marketObservations, row.date)!
        : []),
      ...(featureSet === 'volume' ? [volumeByDate[index]!] : []),
      ...(featureSet === 'technical_fno'
        ? FNO_FEATURE_NAMES.map((name) => fnoByDate[index]![name])
        : []),
      ...(featureSet === 'technical_futures' ? futuresByDate[index]! : []),
      ...(includesFinBert
        ? [sentiment!.polarity, Math.log1p(sentiment!.articles)]
        : []),
    ];
  });
  const lastIndex = observations.length - 1;
  if (!cleanFeatureHistory[lastIndex])
    throw new Error(
      'The latest 60-session feature window contains a flagged intraday reversal candle.'
    );
  const lastTechnical = technicalFeatures(observations.map((row) => row.close));
  const lastOhlc =
    featureSet === 'ohlc'
      ? ohlcByDate[lastIndex]
      : [];
  const lastMarket =
    featureSet === 'market_context'
      ? marketContextFeatures(marketObservations, observations[lastIndex].date)
      : [];
  const lastAdvancedTechnical =
    featureSet === 'advanced_technical'
      ? advancedTechnicalByDate[lastIndex]
      : [];
  const lastVolume = featureSet === 'volume' ? volumeByDate[lastIndex] : undefined;
  const lastFno =
    featureSet === 'technical_fno' ? fnoByDate[lastIndex] : undefined;
  const lastFutures =
    featureSet === 'technical_futures' ? futuresByDate[lastIndex] : undefined;
  if (featureSet === 'ohlc' && lastOhlc === undefined)
    throw new Error(
      'The latest 20-session window does not contain valid OHLC data for the experimental feature set.'
    );
  if (featureSet === 'market_context' && lastMarket === undefined)
    throw new Error(
      'The current forecast origin has no same-date market proxy close or 20-session market history.'
    );
  if (
    featureSet === 'advanced_technical' &&
    lastAdvancedTechnical === undefined
  )
    throw new Error(
      'The current forecast origin has insufficient close history for the experimental technical features.'
    );
  if (featureSet === 'volume' && lastVolume === undefined)
    throw new Error(
      'The current forecast origin lacks 20 valid same-unit prior volume observations.'
    );
  if (featureSet === 'technical_fno' && lastFno === undefined)
    throw new Error(
      'The current forecast origin lacks sufficient F&O history for the experimental feature set.'
    );
  if (featureSet === 'technical_futures' && lastFutures === undefined)
    throw new Error(
      'The current forecast origin lacks sufficient historical futures data for the futures-only feature set.'
    );
  let currentFeature = available[lastIndex] ? features[lastIndex] : undefined;
  if (
    includesFinBert &&
    latestSentiment &&
    (featureSet === 'close_only' ||
      featureSet === 'market_context' ||
      featureSet === 'advanced_technical' ||
      featureSet === 'volume' ||
      featureSet === 'technical_fno' ||
      featureSet === 'technical_futures' ||
      lastOhlc !== undefined) &&
    latestSentiment.articles >= 3 &&
    Number.isFinite(latestSentiment.polarity) &&
    Math.abs(latestSentiment.polarity) <= 1
  )
    currentFeature = [
      ...lastTechnical.features,
      ...(featureSet === 'ohlc' ? lastOhlc! : []),
      ...(featureSet === 'advanced_technical'
        ? lastAdvancedTechnical!
        : []),
      ...(featureSet === 'market_context' ? lastMarket! : []),
      ...(featureSet === 'volume' ? [lastVolume!] : []),
      ...(featureSet === 'technical_fno'
        ? FNO_FEATURE_NAMES.map((name) => lastFno![name])
        : []),
      ...(featureSet === 'technical_futures' ? lastFutures! : []),
      latestSentiment.polarity,
      Math.log1p(latestSentiment.articles),
    ];
  if (!currentFeature)
    throw new Error(
      'The latest forecast cutoff has insufficient FinBERT news coverage.'
    );
  const horizons = [...new Set(sessions)].sort((left, right) => left - right);
  const tasks: LightGbmTask[] = [];
  const taskFoldMappings: number[][] = [];
  const metadata: TrainedForecast['training']['folds'] = [];
  const outOfSampleProbabilities: NonNullable<
    TrainedForecast['training']['outOfSampleProbabilities']
  > = [];
  for (const horizon of horizons) {
    const folds = rollingFolds(
      observations.map((row) => row.date),
      foldHistoryStart,
      end,
      horizon,
      stepMonths,
      trainMonths
    );
    const selected: {
      foldIndex: number;
      train: number[];
      test: number[];
    }[] = [];
    for (const [foldIndex, fold] of folds.entries()) {
      const train = fold.trainIndexes.filter(
        (index) =>
          available[index] && !hasQualityAffectedSample(index, horizon)
      );
      const test = fold.testIndexes.filter(
        (index) =>
          available[index] && !hasQualityAffectedSample(index, horizon)
      );
      const qualityExcludedTrainRows = fold.trainIndexes.filter((index) =>
        hasQualityAffectedSample(index, horizon)
      ).length;
      const qualityExcludedTestRows = fold.testIndexes.filter((index) =>
        hasQualityAffectedSample(index, horizon)
      ).length;
      const featureUnavailableTrainRows = fold.trainIndexes.filter(
        (index) => !featureAvailable[index] && !hasQualityAffectedSample(index, horizon)
      ).length;
      const featureUnavailableTestRows = fold.testIndexes.filter(
        (index) => !featureAvailable[index] && !hasQualityAffectedSample(index, horizon)
      ).length;
      const status =
        train.length >= 120 && test.length >= 20
          ? 'scored'
          : 'skipped_insufficient_eligible_samples';
      metadata.push({
        horizon,
        trainStart: fold.trainStart,
        trainEndExclusive: fold.trainEndExclusive,
        testStart: fold.testStart,
        testEndExclusive: fold.testEndExclusive,
        candidateTrainRows: fold.trainIndexes.length,
        candidateTestRows: fold.testIndexes.length,
        trainRows: train.length,
        testRows: test.length,
        qualityExcludedTrainRows,
        qualityExcludedTestRows,
        featureUnavailableTrainRows,
        featureUnavailableTestRows,
        status,
      });
      if (status === 'scored') selected.push({ foldIndex, train, test });
    }
    if (!selected.length)
      throw new Error(
        `No rolling folds have at least 120 eligible training labels and 20 eligible test labels for horizon ${horizon}.`
      );
    const finalStart = addCalendarMonths(end, -trainMonths);
    const finalTrain = observations.flatMap((row, index) =>
      row.date >= finalStart &&
      index + horizon <= lastIndex &&
      available[index] &&
      !hasQualityAffectedSample(index, horizon)
        ? [index]
        : []
    );
    if (finalTrain.length < 120)
      throw new Error(
        'The final rolling window has fewer than 120 completed training labels.'
      );
    const labels = observations.map((row, index) =>
      index + horizon <= lastIndex
        ? Math.log(observations[index + horizon].close / row.close)
        : 0
    );
    if (
      probabilityEvents.length &&
      (horizon === 1 || horizon === 5)
    ) {
      for (const event of probabilityEvents) {
        for (const fold of selected) {
          const trainLabels = fold.train.map((index) =>
            Number(forecastEventOccurred(labels[index], event))
          );
          const positiveCount = trainLabels.filter((label) => label === 1).length;
          if (
            positiveCount < 10 ||
            trainLabels.length - positiveCount < 10
          )
            throw new Error(
              `Probability model needs at least 10 positive and 10 negative training examples for ${event}, horizon ${horizon}, fold ${fold.foldIndex}.`
            );
          const predict = fitLogisticClassifier(
            fold.train.map((index) => features[index]),
            trainLabels
          );
          const foldMetadata = folds[fold.foldIndex];
          for (const index of fold.test) {
            const probability = predict(features[index]);
            if (!Number.isFinite(probability) || probability < 0 || probability > 1)
              throw new Error('Logistic probability prediction is invalid.');
            outOfSampleProbabilities.push({
              horizon,
              event,
              originDate: observations[index].date,
              targetDate: observations[index + horizon].date,
              actualLogReturn: labels[index],
              probability,
              occurred: forecastEventOccurred(labels[index], event),
              fold: fold.foldIndex,
              testStart: foldMetadata.testStart,
              testEndExclusive: foldMetadata.testEndExclusive,
            });
          }
        }
      }
    }
    tasks.push({
      features,
      labels,
      folds: selected.map(({ train, test }) => ({ train, test })),
      finalTrain,
      currentFeature,
    });
    taskFoldMappings.push(selected.map(({ foldIndex }) => foldIndex));
  }
  const output = await runLightGbm(tasks);
  const points: TrainedForecast['points'] = [];
  const outOfSampleForecasts: TrainedForecast['training']['outOfSampleForecasts'] =
    [];
  let evaluation: TrainedForecast['evaluation'] | undefined;
  const quantile = (values: number[]) => {
    const sorted = [...values].sort((left, right) => left - right);
    return Math.max(
      0.0001,
      sorted[
        Math.min(sorted.length - 1, Math.ceil(0.95 * (sorted.length + 1)) - 1)
      ]
    );
  };
  const mean = (values: number[]) =>
    values.reduce((total, value) => total + value, 0) / values.length;
  for (const [taskIndex, horizon] of horizons.entries()) {
    const residuals: number[] = [];
    const scoredForecasts: { predictedLogReturn: number; actualLogReturn: number }[] = [];
    let covered = 0;
    let coverageSamples = 0;
    const horizonFolds = metadata.filter((fold) => fold.horizon === horizon);
    for (let fold = 0; fold < tasks[taskIndex].folds.length; fold++) {
      const priorRadius =
        residuals.length >= 20 ? quantile(residuals) : undefined;
      for (const prediction of output.tests[taskIndex].filter(
        (item) => item.fold === fold
      )) {
        if (
          !Number.isFinite(prediction.predicted) ||
          !Number.isFinite(prediction.actual) ||
          !tasks[taskIndex].folds[fold].test.includes(prediction.index)
        )
          throw new Error('Invalid LightGBM test prediction.');
        const residual = Math.abs(prediction.actual - prediction.predicted);
        if (priorRadius !== undefined) {
          coverageSamples++;
          if (residual <= priorRadius) covered++;
        }
        residuals.push(residual);
        scoredForecasts.push({
          predictedLogReturn: prediction.predicted,
          actualLogReturn: prediction.actual,
        });
        outOfSampleForecasts.push({
          horizon,
          originDate: observations[prediction.index].date,
          targetDate: observations[prediction.index + horizon].date,
          predictedLogReturn: prediction.predicted,
          actualLogReturn: prediction.actual,
          fold: taskFoldMappings[taskIndex][fold],
          ...(priorRadius === undefined
            ? {}
            : { predictionIntervalRadius: priorRadius }),
        });
      }
    }
    if (scoredForecasts.length < 20)
      throw new Error('Insufficient out-of-sample LightGBM predictions.');
    points.push({
      sessions: horizon,
      logReturn: output.forecasts[taskIndex],
      errorRadius: quantile(residuals),
    });
    evaluation = {
      ...scoreForecastReturns(scoredForecasts),
      qualityExcludedSamples: horizonFolds.reduce(
        (total, fold) => total + fold.qualityExcludedTestRows,
        0
      ),
      unscoredEligibleSamples: horizonFolds.reduce(
        (total, fold) =>
          total +
          (fold.status === 'skipped_insufficient_eligible_samples'
            ? fold.testRows
            : 0),
        0
      ),
      intervalCoveragePct: coverageSamples
        ? (covered / coverageSamples) * 100
        : 0,
      coverageSamples,
    };
  }
  return {
    points,
    evaluation: evaluation!,
    indicators: lastTechnical.indicators,
    training: {
      algorithm: `LightGBM ${output.version}: 100 trees, depth 4, 15 leaves, learning rate 0.05`,
      features: [
        'return1',
        'return5',
        'sma20Ratio',
        'sma50Ratio',
        'ema12_26Ratio',
        'rsi14',
        'macdHistogramRatio',
        'bollingerPercentB',
        'bollingerBandwidth',
        'roc10',
        'roc20',
        'volatility20',
        ...(featureSet === 'ohlc'
          ? ohlcFeatureNames
          : featureSet === 'market_context'
            ? marketFeatureNames
            : featureSet === 'advanced_technical'
              ? advancedTechnicalFeatureNames
              : []),
        ...(featureSet === 'technical_fno' ? FNO_FEATURE_NAMES : []),
        ...(featureSet === 'technical_futures'
          ? [...FUTURES_FEATURE_NAMES]
          : []),
        ...(includesFinBert ? ['finbertPolarity', 'newsArticleCount'] : []),
      ],
      trainingRows: tasks.at(-1)!.finalTrain.length,
      sentimentDays: includesFinBert ? news.size : 0,
      trainedThrough: observations[lastIndex].date,
      validation:
        `Rolling ${trainMonths}-month train / 3-month frozen-model test / ${stepMonths}-month advance. Feature set: ${featureSet}. Only completed actual returns are labels. Folds below 120 eligible training labels or 20 eligible test labels are reported and skipped. Prior fold forecast errors calibrate later fold ranges; synthetic forecasts are never price labels.${probabilityEvents.length ? ' Benchmark-only logistic event probabilities use the same eligible outer-fold rows.' : ''}`,
      includesFinBert,
      trainMonths,
      testMonths: 3,
      stepMonths,
      folds: metadata,
      outOfSampleForecasts,
      ...(probabilityEvents.length ? { outOfSampleProbabilities } : {}),
    },
  };
}

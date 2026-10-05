import { RSI, EMA, MACD, SMA, BollingerBands } from 'technicalindicators';
import { rollingFolds, addCalendarMonths } from './walk-forward.js';
import { runLightGbm, type LightGbmTask } from './lightgbm.js';

export interface TrainingObservation {
  date: string;
  close: number;
}
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
    trainMonths: 14;
    testMonths: 3;
    stepMonths: 6;
    folds: {
      horizon: number;
      trainStart: string;
      trainEndExclusive: string;
      testStart: string;
      testEndExclusive: string;
      trainRows: number;
      testRows: number;
    }[];
    outOfSampleForecasts: {
      horizon: number;
      originDate: string;
      targetDate: string;
      predictedLogReturn: number;
      actualLogReturn: number;
      fold: number;
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

export async function trainForecast(
  observations: TrainingObservation[],
  sessions: number[],
  sentiments?: TrainingSentiment[],
  latestSentiment?: { polarity: number; articles: number },
  window?: { from: string; toExclusive: string }
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
  const dimension = includesFinBert ? 14 : 12;
  const available = observations.map(
    (row, index) => index >= 59 && (!includesFinBert || news.has(row.date))
  );
  const features = observations.map((row, index) => {
    if (!available[index]) return Array(dimension).fill(0) as number[];
    const technical = technicalFeatures(
      observations.slice(0, index + 1).map((item) => item.close)
    );
    const sentiment = news.get(row.date);
    return includesFinBert
      ? [
          ...technical.features,
          sentiment!.polarity,
          Math.log1p(sentiment!.articles),
        ]
      : technical.features;
  });
  const lastIndex = observations.length - 1;
  const lastTechnical = technicalFeatures(observations.map((row) => row.close));
  let currentFeature = available[lastIndex] ? features[lastIndex] : undefined;
  if (
    includesFinBert &&
    latestSentiment &&
    latestSentiment.articles >= 3 &&
    Number.isFinite(latestSentiment.polarity) &&
    Math.abs(latestSentiment.polarity) <= 1
  )
    currentFeature = [
      ...lastTechnical.features,
      latestSentiment.polarity,
      Math.log1p(latestSentiment.articles),
    ];
  if (!currentFeature)
    throw new Error(
      'The latest forecast cutoff has insufficient FinBERT news coverage.'
    );
  const horizons = [...new Set(sessions)].sort((left, right) => left - right);
  const tasks: LightGbmTask[] = [];
  const metadata: TrainedForecast['training']['folds'] = [];
  for (const horizon of horizons) {
    const folds = rollingFolds(
      observations.map((row) => row.date),
      historyStart,
      end,
      horizon
    );
    const selected = folds.map((fold) => {
      const train = fold.trainIndexes.filter((index) => available[index]);
      const test = fold.testIndexes.filter((index) => available[index]);
      if (train.length < 120 || test.length < 20)
        throw new Error(
          'Each rolling fold needs 120 training labels and 20 test labels with required feature coverage.'
        );
      metadata.push({
        horizon,
        trainStart: fold.trainStart,
        trainEndExclusive: fold.trainEndExclusive,
        testStart: fold.testStart,
        testEndExclusive: fold.testEndExclusive,
        trainRows: train.length,
        testRows: test.length,
      });
      return { train, test };
    });
    const finalStart = addCalendarMonths(end, -14);
    const finalTrain = observations.flatMap((row, index) =>
      row.date >= finalStart && index + horizon <= lastIndex && available[index]
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
    tasks.push({
      features,
      labels,
      folds: selected,
      finalTrain,
      currentFeature,
    });
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
    const errors: number[] = [];
    const naive: number[] = [];
    let hits = 0;
    let covered = 0;
    let coverageSamples = 0;
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
        errors.push(
          Math.abs(Math.expm1(prediction.predicted - prediction.actual)) * 100
        );
        naive.push(Math.abs(Math.expm1(-prediction.actual)) * 100);
        if (Math.sign(prediction.predicted) === Math.sign(prediction.actual))
          hits++;
        outOfSampleForecasts.push({
          horizon,
          originDate: observations[prediction.index].date,
          targetDate: observations[prediction.index + horizon].date,
          predictedLogReturn: prediction.predicted,
          actualLogReturn: prediction.actual,
          fold,
        });
      }
    }
    if (errors.length < 20)
      throw new Error('Insufficient out-of-sample LightGBM predictions.');
    points.push({
      sessions: horizon,
      logReturn: output.forecasts[taskIndex],
      errorRadius: quantile(residuals),
    });
    evaluation = {
      samples: errors.length,
      meanAbsolutePercentageError: mean(errors),
      naiveMeanAbsolutePercentageError: mean(naive),
      directionalAccuracyPct: (hits / errors.length) * 100,
      intervalCoveragePct: coverageSamples
        ? (covered / coverageSamples) * 100
        : 0,
      coverageSamples,
      beatsNaive: mean(errors) < mean(naive),
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
        ...(includesFinBert ? ['finbertPolarity', 'newsArticleCount'] : []),
      ],
      trainingRows: tasks.at(-1)!.finalTrain.length,
      sentimentDays: includesFinBert ? news.size : 0,
      trainedThrough: observations[lastIndex].date,
      validation:
        'Rolling 14-month train / 3-month frozen-model test / 6-month advance. Only completed actual returns are labels. Prior fold forecast errors calibrate later fold ranges; synthetic forecasts are never price labels. Three-month gaps between test blocks are not scored.',
      includesFinBert,
      trainMonths: 14,
      testMonths: 3,
      stepMonths: 6,
      folds: metadata,
      outOfSampleForecasts,
    },
  };
}

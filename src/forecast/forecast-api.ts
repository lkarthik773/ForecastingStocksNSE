import type { HistoricalApi } from '../nse/api/historical-api.js';
import type { OptionsApi } from '../nse/api/options-api.js';
import {
  trainForecast,
  trainCurrentProbabilitySnapshot,
  type TrainingFeatureSet,
  type TrainedForecast,
  type TrainingObservation,
  type TrainingSentiment,
  type CurrentProbabilityPrediction,
} from './trained-forecast.js';
import {
  loadFinBertArchive,
  historicalFinBertFeatures,
} from './finbert-history.js';
import { FinBertScorer, type SentimentScorer } from './finbert.js';
import type {
  ForecastContext,
  ForecastContextProvider,
  MarketObservation,
} from './forecast-context-api.js';
import { addCalendarMonths } from './walk-forward.js';
import {
  adjustHistoricalRows,
  parseNseShareAdjustments,
  type ShareAdjustment,
} from './corporate-actions.js';
import {
  getFnoFeaturesForObservation,
} from './trained-forecast.js';
import {
  FNO_FEATURE_NAMES,
  type FnoFeatureLookbacks,
  type FnoFeatures,
} from './fno-features.js';
import {
  loadHistoricalFnoArchive,
  type FnoArchiveOptions,
} from './fno-archive.js';
import { fetchHistoricalFuturesObservations } from './futures-data-fetcher.js';
import {
  getFuturesFeaturesForObservation,
  type FuturesFeatures,
} from './futures-features.js';
import type { ForecastEvent } from './target-outcomes.js';

export const FORECAST_HISTORY_MONTH_LIMITS = {
  defaultMonths: 60,
  minMonths: 36,
  maxMonths: 120,
} as const;

export interface ForecastParams {
  symbol: string;
  horizon?: 'next_day' | 'week' | 'custom';
  historyMonths?: number;
  start_date?: string;
  end_date?: string;
  context?: 'auto' | 'off';
  sentiment?: 'off' | 'finbert';
  model?:
    | 'baseline'
    | 'technical'
    | 'technical_finbert'
    | 'technical_fno'
    | 'technical_futures';
  includeFno?: boolean;
}

export type ForecastDirection = 'up' | 'down' | 'flat';

export interface ForecastPoint {
  tradingSession: number;
  date?: string;
  estimatedClose: number;
  expectedChangePct: number;
  estimatedDirection: ForecastDirection;
  predictionInterval95: { lower: number; upper: number };
}

export interface ForecastResult {
  symbol: string;
  exchange: 'NSE';
  currency: 'INR';
  horizon: 'next_day' | 'week' | 'custom';
  forecastRange?: {
    startDate: string;
    endDate: string;
    calendarDays: number;
    weekdayCount: number;
  };
  generatedAt: string;
  context?: Omit<ForecastContext, 'market'> & {
    market: Omit<ForecastContext['market'], 'observations'> & {
      observations: number;
      applied: boolean;
      beta: number | null;
      recentChange5Pct: number | null;
      volatilityRatio: number | null;
      dailyDriftAdjustmentPct: number;
    };
    newsVarianceMultiplier: number;
    elevatedRisk: boolean;
  };
  lastClose: { date: string; price: number };
  history: {
    requestedMonths: number;
    requestedFrom: string;
    requestedTo: string;
    firstDate: string;
    lastDate: string;
    observations: number;
    discardedRows: number;
    dataQuality: HistoricalDataQuality;
  };
  model: {
    name: string;
    dailyDriftPct: number;
    dailyVolatilityPct: number;
    intervalAssumptions: string;
    training?: TrainedForecast['training'];
  };
  analysis: {
    sma20: number;
    sma50: number;
    technicalIndicators?: TrainedForecast['indicators'];
  };
  forecast: ForecastPoint[];
  summary: {
    estimatedDirection: ForecastDirection;
    signal: 'up' | 'down' | 'uncertain';
    expectedChangePct: number;
    reason: string;
  };
  backtest: {
    horizonSessions: number;
    samples: number;
    qualityExcludedSamples: number;
    unscoredEligibleSamples: number;
    meanAbsolutePercentageError: number;
    naiveMeanAbsolutePercentageError: number;
    directionalAccuracyPct: number;
    intervalCoveragePct: number;
    beatsNaive: boolean;
    includesNews: boolean;
    coverageSamples?: number;
  };
  warnings: string[];
}

export interface ForecastProbabilitySnapshot {
  symbol: string;
  originDate: string;
  generatedAt: string;
  requestedMonths: number;
  lastClose: number;
  dataQuality: HistoricalDataQuality;
  predictions: CurrentProbabilityPrediction[];
}

export class ForecastInputError extends Error {}
export class ForecastDataError extends Error {}

interface Observation {
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
const benchmarkFeatureSets = new WeakMap<ForecastApi, TrainingFeatureSet>();
const benchmarkFnoFeatureSets = new WeakMap<
  ForecastApi,
  ReadonlySet<keyof FnoFeatures>
>();
const benchmarkFnoFeatureLookbacks = new WeakMap<
  ForecastApi,
  FnoFeatureLookbacks
>();
const benchmarkFnoArchiveOptions = new WeakMap<ForecastApi, FnoArchiveOptions>();
const benchmarkProbabilityEvents = new WeakMap<ForecastApi, ForecastEvent[]>();
const benchmarkTrainingWindows = new WeakMap<
  ForecastApi,
  { trainMonths: 8 | 14 | 20; foldAnchorTrainMonths: 20 }
>();

export function configureForecastFeatureSetForBenchmark(
  api: ForecastApi,
  featureSet: TrainingFeatureSet
) {
  benchmarkFeatureSets.set(api, featureSet);
}

export function configureForecastProbabilityEventsForBenchmark(
  api: ForecastApi,
  events?: readonly ForecastEvent[]
) {
  if (!events?.length) {
    benchmarkProbabilityEvents.delete(api);
    return;
  }
  benchmarkProbabilityEvents.set(api, [...events]);
}

export function configureForecastTrainingWindowForBenchmark(
  api: ForecastApi,
  trainMonths: 8 | 14 | 20
) {
  benchmarkTrainingWindows.set(api, {
    trainMonths,
    foldAnchorTrainMonths: 20,
  });
}

export function configureFnoFeatureSetForBenchmark(
  api: ForecastApi,
  featureNames?: readonly (keyof FnoFeatures)[]
) {
  if (!featureNames) {
    benchmarkFnoFeatureSets.delete(api);
    return;
  }
  benchmarkFnoFeatureSets.set(api, new Set(featureNames));
}

export function configureFnoFeatureLookbacksForBenchmark(
  api: ForecastApi,
  lookbacks?: FnoFeatureLookbacks
) {
  if (lookbacks) benchmarkFnoFeatureLookbacks.set(api, lookbacks);
  else benchmarkFnoFeatureLookbacks.delete(api);
}

export function configureFnoArchiveOptionsForBenchmark(
  api: ForecastApi,
  options?: FnoArchiveOptions
) {
  if (options) benchmarkFnoArchiveOptions.set(api, options);
  else benchmarkFnoArchiveOptions.delete(api);
}

export interface HistoricalDataQuality {
  rawRows: number;
  duplicateRows: number;
  invalidRows: number;
  outOfRangeRows: number;
  nonEquityRows: number;
  ohlcUnavailableRows: number;
  intradayReversalThresholds: {
    minRangePctOfOpen: number;
    maxBodyPctOfRange: number;
  };
  intradayReversalCandles: {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    rangePctOfOpen: number;
    bodyPctOfOpen: number;
    bodyPctOfRange: number;
  }[];
  largeDailyChanges: {
    fromDate: string;
    toDate: string;
    changePct: number;
  }[];
  calendarIntervalsOverFourDays: number;
  maxCalendarIntervalDays: number;
  corporateActionAdjustment: 'applied' | 'not applied by forecast';
  corporateActionAdjustments: ShareAdjustment[];
}
const DAY = 86400000;
const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}
function average(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}
function direction(change: number): ForecastDirection {
  return Math.abs(change) < 0.01 ? 'flat' : change > 0 ? 'up' : 'down';
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  let date = value.slice(0, 10);
  const match = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(value);
  if (match) {
    const month = MONTHS.indexOf(match[2].toLowerCase()) + 1;
    if (!month) return;
    date = `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== date
  )
    return;
  return date;
}

function customDate(value: unknown, name: string): string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    parseDate(value) !== value
  ) {
    throw new ForecastInputError(
      `${name} must be a valid YYYY-MM-DD date for custom forecasts.`
    );
  }
  return value;
}

function weekdays(from: string, to: string): string[] {
  const dates: string[] = [];
  for (
    const date = new Date(`${from}T00:00:00Z`);
    date <= new Date(`${to}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1)
  ) {
    if (date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
      dates.push(date.toISOString().slice(0, 10));
  }
  return dates;
}

function parsePrice(value: unknown): number | undefined {
  const price =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.replace(/,/g, ''))
        : NaN;
  return Number.isFinite(price) && price > 0 && price <= 1e9
    ? price
    : undefined;
}

function parseVolume(value: unknown): number | undefined {
  const quantity =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.replace(/,/g, ''))
        : NaN;
  return Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;
}

function normalize(
  rows: Record<string, unknown>[],
  from: string,
  to: string,
  symbol: string
) {
  const unique = new Map<string, Observation>();
  let duplicateRows = 0;
  let invalidRows = 0;
  let outOfRangeRows = 0;
  let nonEquityRows = 0;
  let ohlcUnavailableRows = 0;
  const intradayReversalCandles: HistoricalDataQuality['intradayReversalCandles'] =
    [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      invalidRows++;
      continue;
    }
    const date = parseDate(
      row.mtimestamp ?? row.CH_TIMESTAMP ?? row.chTimestamp
    );
    const raw = row.chClosingPrice ?? row.CH_CLOSING_PRICE;
    const close = parsePrice(raw);
    const volume = parseVolume(
      row.chTotTradedQty ??
        row.CH_TOT_TRADED_QTY ??
        row.totalTradedVolume ??
        row.volume
    );
    const open = parsePrice(row.chOpeningPrice ?? row.CH_OPENING_PRICE);
    const high = parsePrice(row.chTradeHighPrice ?? row.CH_TRADE_HIGH_PRICE);
    const low = parsePrice(row.chTradeLowPrice ?? row.CH_TRADE_LOW_PRICE);
    const series = row.chSeries ?? row.CH_SERIES;
    const rowSymbol = row.chSymbol ?? row.CH_SYMBOL;
    if (rowSymbol && rowSymbol !== symbol)
      throw new ForecastDataError(
        'Historical response contains a different stock symbol.'
      );
    if (!date || close === undefined) {
      invalidRows++;
      continue;
    }
    if (date < from || date > to) {
      outOfRangeRows++;
      continue;
    }
    if (series && series !== 'EQ') {
      nonEquityRows++;
      continue;
    }
    const hasValidOhlc =
      open !== undefined &&
      high !== undefined &&
      low !== undefined &&
      high >= Math.max(open, close) &&
      low <= Math.min(open, close) &&
      high >= low;
    if (!hasValidOhlc) ohlcUnavailableRows++;
    const rangePctOfOpen =
      hasValidOhlc ? ((high - low) / open) * 100 : undefined;
    const bodyPctOfOpen =
      hasValidOhlc ? (Math.abs(close - open) / open) * 100 : undefined;
    const bodyPctOfRange =
      hasValidOhlc && high > low
        ? (Math.abs(close - open) / (high - low)) * 100
        : undefined;
    const isIntradayReversal =
      hasValidOhlc &&
      rangePctOfOpen! >= 10 &&
      bodyPctOfRange !== undefined &&
      bodyPctOfRange <= 50;
    const observation: Observation = {
      date,
      close,
      ...(volume === undefined ? {} : { volume }),
      ...(hasValidOhlc ? { open, high, low } : {}),
      ...(isIntradayReversal ? { qualityExcluded: true } : {}),
    };
    if (unique.has(date)) {
      const existing = unique.get(date)!;
      if (existing.close !== close)
        throw new ForecastDataError(`Conflicting closing prices for ${date}.`);
      if (existing.volume !== volume) existing.volume = undefined;
      duplicateRows++;
      if (isIntradayReversal && !existing.qualityExcluded) {
        existing.qualityExcluded = true;
        intradayReversalCandles.push({
          date,
          open,
          high,
          low,
          close,
          rangePctOfOpen: round(rangePctOfOpen!, 4),
          bodyPctOfOpen: round(bodyPctOfOpen!, 4),
          bodyPctOfRange: round(bodyPctOfRange!, 4),
        });
      }
    } else {
      unique.set(date, observation);
      if (isIntradayReversal)
        intradayReversalCandles.push({
          date,
          open,
          high,
          low,
          close,
          rangePctOfOpen: round(rangePctOfOpen!, 4),
          bodyPctOfOpen: round(bodyPctOfOpen!, 4),
          bodyPctOfRange: round(bodyPctOfRange!, 4),
        });
    }
  }
  const observations = [...unique.values()]
    .sort((left, right) => left.date.localeCompare(right.date))
    .map(({ date, close, volume, open, high, low, qualityExcluded }): Observation => ({
      date,
      close,
      ...(volume === undefined ? {} : { volume }),
      ...(open === undefined ? {} : { open }),
      ...(high === undefined ? {} : { high }),
      ...(low === undefined ? {} : { low }),
      ...(qualityExcluded ? { qualityExcluded } : {}),
    }));
  let calendarIntervalsOverFourDays = 0;
  let maxCalendarIntervalDays = 0;
  const largeDailyChanges: HistoricalDataQuality['largeDailyChanges'] = [];
  for (let index = 1; index < observations.length; index++) {
    const previous = observations[index - 1];
    const current = observations[index];
    const intervalDays = (Date.parse(`${current.date}T00:00:00Z`) -
      Date.parse(`${previous.date}T00:00:00Z`)) / DAY;
    maxCalendarIntervalDays = Math.max(maxCalendarIntervalDays, intervalDays);
    if (intervalDays > 4) calendarIntervalsOverFourDays++;
    const changePct = (current.close / previous.close - 1) * 100;
    if (Math.abs(changePct) > 25)
      largeDailyChanges.push({
        fromDate: previous.date,
        toDate: current.date,
        changePct: round(changePct, 4),
      });
  }
  return {
    observations,
    discardedRows: duplicateRows + invalidRows + outOfRangeRows + nonEquityRows,
    dataQuality: {
      rawRows: rows.length,
      duplicateRows,
      invalidRows,
      outOfRangeRows,
      nonEquityRows,
      ohlcUnavailableRows,
      intradayReversalThresholds: {
        minRangePctOfOpen: 10,
        maxBodyPctOfRange: 50,
      },
      intradayReversalCandles,
      largeDailyChanges,
      calendarIntervalsOverFourDays,
      maxCalendarIntervalDays,
      corporateActionAdjustment: 'not applied by forecast' as
        | 'applied'
        | 'not applied by forecast',
      corporateActionAdjustments: [] as ShareAdjustment[],
    },
  };
}

export function normalizeForecastHistoricalRows(
  rows: Record<string, unknown>[],
  from: string,
  to: string,
  symbol: string,
  corporateActionRows?: Record<string, unknown>[]
): {
  observations: TrainingObservation[];
  discardedRows: number;
  dataQuality: HistoricalDataQuality;
  corporateActionAdjustments: ShareAdjustment[];
} {
  if (!Array.isArray(rows))
    throw new ForecastDataError(
      'Historical API did not return daily price rows.'
    );
  if (corporateActionRows !== undefined && !Array.isArray(corporateActionRows))
    throw new ForecastDataError(
      'Corporate action API did not return a list of events.'
    );
  const corporateActionAdjustments = corporateActionRows
    ? parseNseShareAdjustments(corporateActionRows, symbol)
    : [];
  const historicalRows = corporateActionRows
    ? adjustHistoricalRows(rows, corporateActionAdjustments)
    : rows;
  const normalized = normalize(historicalRows, from, to, symbol);
  normalized.dataQuality.corporateActionAdjustment = corporateActionRows
    ? 'applied'
    : 'not applied by forecast';
  normalized.dataQuality.corporateActionAdjustments =
    corporateActionAdjustments;
  return { ...normalized, corporateActionAdjustments };
}

function fit(
  observations: Observation[],
  marketRows: MarketObservation[] = []
) {
  const returnSamples = observations.slice(1).flatMap((row, index) => {
    const previous = observations[index];
    return previous.qualityExcluded || row.qualityExcluded
      ? []
      : [{
          fromDate: previous.date,
          date: row.date,
          value: Math.log(row.close) - Math.log(previous.close),
        }];
  });
  if (returnSamples.length < 2)
    throw new ForecastDataError(
      'Insufficient clean adjacent closes remain after excluding flagged intraday reversals.'
    );
  const returns = returnSamples.map((row) => row.value);
  const values = returns;
  const mean = average(values);
  const variance =
    values.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (values.length - 1);
  let market: {
    beta: number;
    recentChange5Pct: number;
    volatilityRatio: number;
    driftAdjustment: number;
  } | null = null;
  const lastDate = observations[observations.length - 1].date;
  const prices = new Map(
    marketRows
      .filter(
        (row) =>
          row.date <= lastDate && Number.isFinite(row.close) && row.close > 0
      )
      .map((row) => [row.date, row.close])
  );
  const pairs = returnSamples.flatMap((row) => {
    const previous = prices.get(row.fromDate);
    const current = prices.get(row.date);
    return previous && current
      ? [
          {
            date: row.date,
            stock: row.value,
            market: Math.log(current) - Math.log(previous),
          },
        ]
      : [];
  });
  if (
    pairs.length >= 60 &&
    Date.parse(lastDate) - Date.parse(pairs[pairs.length - 1].date) <= 4 * DAY
  ) {
    const marketMean = average(pairs.map((pair) => pair.market));
    const stockMean = average(pairs.map((pair) => pair.stock));
    const marketVariance = average(
      pairs.map((pair) => (pair.market - marketMean) ** 2)
    );
    if (marketVariance > 1e-12) {
      const beta = Math.max(
        -3,
        Math.min(
          3,
          average(
            pairs.map(
              (pair) => (pair.stock - stockMean) * (pair.market - marketMean)
            )
          ) / marketVariance
        )
      );
      const recent = pairs.slice(-5).map((pair) => pair.market);
      const recent20 = pairs.slice(-20).map((pair) => pair.market);
      const recentMean = average(recent20);
      const volatilityRatio = Math.sqrt(
        average(recent20.map((value) => (value - recentMean) ** 2)) /
          marketVariance
      );
      const limit = Math.sqrt(variance) * 0.25;
      const driftAdjustment = Math.max(
        -limit,
        Math.min(limit, 0.2 * beta * (average(recent) - marketMean))
      );
      market = {
        beta,
        recentChange5Pct:
          Math.expm1(recent.reduce((total, value) => total + value, 0)) * 100,
        volatilityRatio,
        driftAdjustment,
      };
    }
  }
  return {
    drift: mean * 0.5 + (market?.driftAdjustment ?? 0),
    variance:
      variance * Math.max(1, Math.min(2, market?.volatilityRatio ?? 1)) ** 2,
    count: returns.length,
    returns,
    market,
  };
}

function project(
  lastPrice: number,
  model: ReturnType<typeof fit>,
  sessions: number
): ForecastPoint {
  const logPrice = Math.log(lastPrice) + model.drift * sessions;
  const margin =
    1.96 *
    Math.sqrt(
      model.variance * (sessions + (0.25 * sessions ** 2) / model.count)
    );
  const price = Math.exp(logPrice);
  const change = (price / lastPrice - 1) * 100;
  const lower = Math.exp(logPrice - margin);
  const upper = Math.exp(logPrice + margin);
  if (![price, change, lower, upper].every(Number.isFinite))
    throw new ForecastDataError(
      'Price history is too unstable for this model.'
    );
  return {
    tradingSession: sessions,
    estimatedClose: round(price),
    expectedChangePct: round(change, 4),
    estimatedDirection: direction(change),
    predictionInterval95: { lower: round(lower), upper: round(upper) },
  };
}

function backtest(
  observations: Observation[],
  sessions: number,
  marketRows: MarketObservation[] = []
): ForecastResult['backtest'] {
  const errors: number[] = [];
  const naiveErrors: number[] = [];
  let hits = 0;
  let covered = 0;
  const first = Math.max(252, observations.length - sessions - 60);
  let qualityExcludedSamples = 0;
  for (let origin = first; origin < observations.length - sessions; origin++) {
    const training = observations.slice(0, origin + 1);
    const lastPrice = observations[origin].close;
    const actual = observations[origin + sessions].close;
    if (
      observations
        .slice(origin, origin + sessions + 1)
        .some((row) => row.qualityExcluded)
    ) {
      qualityExcludedSamples++;
      continue;
    }
    const point = project(lastPrice, fit(training, marketRows), sessions);
    errors.push((Math.abs(point.estimatedClose - actual) / actual) * 100);
    naiveErrors.push((Math.abs(lastPrice - actual) / actual) * 100);
    if (point.estimatedDirection === direction((actual / lastPrice - 1) * 100))
      hits++;
    if (
      actual >= point.predictionInterval95.lower &&
      actual <= point.predictionInterval95.upper
    )
      covered++;
  }
  const error = average(errors);
  const naive = average(naiveErrors);
  if (!errors.length)
    throw new ForecastDataError(
      'No eligible backtest samples remain after excluding flagged intraday reversals.'
    );
  return {
    horizonSessions: sessions,
    samples: errors.length,
    qualityExcludedSamples,
    unscoredEligibleSamples: 0,
    meanAbsolutePercentageError: round(error, 4),
    naiveMeanAbsolutePercentageError: round(naive, 4),
    directionalAccuracyPct: round((hits / errors.length) * 100),
    intervalCoveragePct: round((covered / errors.length) * 100),
    beatsNaive: error < naive,
    includesNews: false,
  };
}

export class ForecastApi {
  constructor(
    private historical: Pick<HistoricalApi, 'fetchEquityHistoricalData'> &
      Partial<Pick<HistoricalApi, 'fetchHistoricalFnoData'>>,
    private now: () => Date = () => new Date(),
    private contextProvider?: ForecastContextProvider,
    private trainingOptions: {
      newsArchivePath?: string;
      fnoArchiveDir?: string;
      scorer?: SentimentScorer;
    } = {},
    private walkForwardStepMonths = 6,
    private corporateActionProvider?: (
      symbol: string,
      from: string,
      to: string
    ) => Promise<Record<string, unknown>[]>,
    private readonly _optionsApi?: OptionsApi
  ) {}

  async forecastProbabilitySnapshotForBenchmark(params: {
    symbol: string;
    historyMonths?: number;
  }): Promise<ForecastProbabilitySnapshot> {
    const events = benchmarkProbabilityEvents.get(this);
    if (!events?.length)
      throw new ForecastInputError(
        'Configure probability events before requesting a benchmark snapshot.'
      );
    if (
      !params ||
      typeof params.symbol !== 'string' ||
      !/^[A-Z0-9&._-]{1,30}$/i.test(params.symbol.trim())
    )
      throw new ForecastInputError('Provide a valid NSE stock symbol.');
    const historyMonths =
      params.historyMonths ?? FORECAST_HISTORY_MONTH_LIMITS.defaultMonths;
    if (
      !Number.isInteger(historyMonths) ||
      historyMonths < FORECAST_HISTORY_MONTH_LIMITS.minMonths ||
      historyMonths > FORECAST_HISTORY_MONTH_LIMITS.maxMonths
    )
      throw new ForecastInputError(
        `historyMonths must be a whole number from ${FORECAST_HISTORY_MONTH_LIMITS.minMonths} to ${FORECAST_HISTORY_MONTH_LIMITS.maxMonths}.`
      );
    if (!this.corporateActionProvider)
      throw new ForecastDataError(
        'A corporate-action provider is required for probability benchmark snapshots.'
      );

    const symbol = params.symbol.trim().toUpperCase();
    const now = this.now();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) =>
      parts.find((item) => item.type === type)!.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const requestedFrom = addCalendarMonths(today, -historyMonths);
    const rows = await this.historical.fetchEquityHistoricalData({
      symbol,
      from_date: new Date(`${requestedFrom}T12:00:00`),
      to_date: new Date(`${today}T12:00:00`),
      series: ['EQ'],
    });
    const corporateActionRows = await this.corporateActionProvider(
      symbol,
      requestedFrom,
      today
    );
    const {
      observations,
      dataQuality,
    } = normalizeForecastHistoricalRows(
      rows,
      requestedFrom,
      today,
      symbol,
      corporateActionRows
    );
    if (
      observations.length < 600 ||
      observations[0].date >
        new Date(Date.parse(requestedFrom) + 45 * DAY)
          .toISOString()
          .slice(0, 10)
    )
      throw new ForecastDataError(
        `Insufficient ${historyMonths}-month history: at least 600 daily closes spanning the requested window are required.`
      );
    const last = observations[observations.length - 1];
    if (last.qualityExcluded)
      throw new ForecastDataError(
        'The latest historical candle is flagged as an intraday reversal; a probability snapshot cannot use it as the current price.'
      );
    const age =
      (Date.parse(today) - Date.parse(last.date)) / DAY;
    if (age > 10)
      throw new ForecastDataError(
        `History is stale: the last close is ${last.date}.`
      );
    const historyEndExclusive = new Date(
      Date.parse(`${today}T00:00:00Z`) + DAY
    ).toISOString().slice(0, 10);
    const predictions = trainCurrentProbabilitySnapshot(
      observations,
      events,
      historyEndExclusive
    );
    return {
      symbol,
      originDate: last.date,
      generatedAt: now.toISOString(),
      requestedMonths: historyMonths,
      lastClose: last.close,
      dataQuality,
      predictions,
    };
  }

  async forecastStock(params: ForecastParams): Promise<ForecastResult> {
    if (
      !params ||
      typeof params.symbol !== 'string' ||
      !/^[A-Z0-9&._-]{1,30}$/i.test(params.symbol.trim())
    )
      throw new ForecastInputError('Provide a valid NSE stock symbol.');
    const historyMonths = params.historyMonths ?? FORECAST_HISTORY_MONTH_LIMITS.defaultMonths;
    if (!Number.isInteger(historyMonths) ||
        historyMonths < FORECAST_HISTORY_MONTH_LIMITS.minMonths ||
        historyMonths > FORECAST_HISTORY_MONTH_LIMITS.maxMonths)
      throw new ForecastInputError(
        `historyMonths must be a whole number from ${FORECAST_HISTORY_MONTH_LIMITS.minMonths} to ${FORECAST_HISTORY_MONTH_LIMITS.maxMonths}.`
      );
    const symbol = params.symbol.trim().toUpperCase();
    const selectedModel = params.model ?? 'baseline';
    if (
      ![
        'baseline',
        'technical',
        'technical_finbert',
        'technical_fno',
        'technical_futures',
      ].includes(selectedModel)
    )
      throw new ForecastInputError(
        'model must be baseline, technical, technical_finbert, technical_fno or technical_futures.'
      );
    if (
      params.sentiment !== undefined &&
      params.sentiment !== 'off' &&
      params.sentiment !== 'finbert'
    )
      throw new ForecastInputError('sentiment must be off or finbert.');
    if (
      selectedModel === 'technical_finbert' &&
      (params.context === 'off' || params.sentiment === 'off')
    )
      throw new ForecastInputError(
        'Joint training requires context auto and sentiment finbert.'
      );
    if (
      params.context !== undefined &&
      params.context !== 'auto' &&
      params.context !== 'off'
    )
      throw new ForecastInputError('context must be auto or off.');
    const horizon = params.horizon ?? 'next_day';
    if (horizon !== 'next_day' && horizon !== 'week' && horizon !== 'custom')
      throw new ForecastInputError('horizon must be next_day, week or custom.');
    if (
      horizon !== 'custom' &&
      (params.start_date !== undefined || params.end_date !== undefined)
    )
      throw new ForecastInputError(
        'Date ranges are only supported with horizon custom.'
      );
    let forecastRange: ForecastResult['forecastRange'];
    let customDates: string[] = [];
    if (horizon === 'custom') {
      const startDate = customDate(params.start_date, 'start_date');
      const endDate = customDate(params.end_date, 'end_date');
      const calendarDays =
        (Date.parse(endDate) - Date.parse(startDate)) / DAY + 1;
      if (calendarDays < 1 || calendarDays > 7)
        throw new ForecastInputError(
          'Custom date range must be ordered and contain at most 7 calendar days inclusive.'
        );
      customDates = weekdays(startDate, endDate);
      if (!customDates.length)
        throw new ForecastInputError(
          'Custom date range must include at least one weekday.'
        );
      forecastRange = {
        startDate,
        endDate,
        calendarDays,
        weekdayCount: customDates.length,
      };
    }
    const now = this.now();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now);
    const part = (type: string) =>
      parts.find((item) => item.type === type)!.value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const anchor = forecastRange
      ? new Date(`${forecastRange.startDate}T00:00:00Z`)
      : new Date(`${today}T00:00:00Z`);
    const to = new Date(anchor.getTime() - (forecastRange ? DAY : 0));
    const requestedTo = to.toISOString().slice(0, 10);
    const requestedFrom = addCalendarMonths(
      anchor.toISOString().slice(0, 10),
      -historyMonths
    );
    let archive: Awaited<ReturnType<typeof loadFinBertArchive>> | undefined;
    if (selectedModel === 'technical_finbert') {
      try {
        archive = await loadFinBertArchive(
          this.trainingOptions.newsArchivePath,
          symbol
        );
      } catch (error) {
        throw new ForecastDataError(
          error instanceof Error
            ? error.message
            : 'Historical FinBERT archive could not be loaded.'
        );
      }
    }
    const rows = await this.historical.fetchEquityHistoricalData({
      symbol,
      from_date: new Date(`${requestedFrom}T12:00:00`),
      to_date: new Date(`${requestedTo}T12:00:00`),
      series: ['EQ'],
    });
    const corporateActionRows = this.corporateActionProvider
      ? await this.corporateActionProvider(symbol, requestedFrom, requestedTo)
      : undefined;
    const {
      observations,
      discardedRows,
      dataQuality,
      corporateActionAdjustments,
    } = normalizeForecastHistoricalRows(
      rows,
      requestedFrom,
      requestedTo < today ? requestedTo : today,
      symbol,
      corporateActionRows
    );
    const wantsFno =
      params.includeFno === true || selectedModel === 'technical_fno';
    if (wantsFno) {
      if (!this.trainingOptions.fnoArchiveDir)
        throw new ForecastDataError(
          'Historical F&O archive directory is not configured; set forecastTraining.fnoArchiveDir to a folder containing SYMBOL.csv files.'
        );
      try {
        const fnoData = await loadHistoricalFnoArchive(
          this.trainingOptions.fnoArchiveDir,
          symbol,
          observations,
          benchmarkFnoArchiveOptions.get(this)
        );
        observations.forEach((observation, index) => {
          const features = getFnoFeaturesForObservation(
            observations,
            index,
            fnoData,
            benchmarkFnoFeatureLookbacks.get(this)
          );
          const includedFeatures = benchmarkFnoFeatureSets.get(this);
          if (features && includedFeatures) {
            for (const name of FNO_FEATURE_NAMES)
              if (!includedFeatures.has(name)) features[name] = 0;
          }
          observation.fnoFeatures = features;
        });
      } catch (error) {
        throw new ForecastDataError(
          error instanceof Error
            ? `Historical F&O archive could not be loaded: ${error.message}`
            : 'Historical F&O archive could not be loaded.'
        );
      }
    }
    if (selectedModel === 'technical_futures') {
      if (!this.historical.fetchHistoricalFnoData)
        throw new ForecastDataError(
          'Historical futures data is not available from the configured NSE API client.'
        );
      try {
        const futuresHistory = await fetchHistoricalFuturesObservations(
          symbol,
          this.historical,
          observations,
          new Date(`${requestedFrom}T12:00:00`),
          new Date(`${requestedTo}T12:00:00`)
        );
        for (const observation of observations) {
          observation.futuresFeatures = getFuturesFeaturesForObservation(
            futuresHistory,
            observation.date
          );
        }
      } catch (error) {
        throw new ForecastDataError(
          error instanceof Error
            ? `Historical futures data could not be prepared: ${error.message}`
            : 'Historical futures data could not be prepared.'
        );
      }
    }
    dataQuality.corporateActionAdjustment = corporateActionRows
      ? 'applied'
      : 'not applied by forecast';
    dataQuality.corporateActionAdjustments = corporateActionAdjustments;
    if (
      observations.length < 600 ||
      observations[0].date >
        new Date(Date.parse(requestedFrom) + 45 * DAY).toISOString().slice(0, 10)
    )
      throw new ForecastDataError(
        `Insufficient ${historyMonths}-month history: at least 600 daily closes spanning the requested window are required.`
      );
    const last = observations[observations.length - 1];
    if (last.qualityExcluded)
      throw new ForecastDataError(
        'The latest historical candle is flagged as an intraday reversal; a forecast cannot use it as the current price.'
      );
    const age =
      (to.getTime() - new Date(`${last.date}T00:00:00Z`).getTime()) / DAY;
    if (age > 10)
      throw new ForecastDataError(
        `History is stale: the last close is ${last.date}.`
      );
    let external: ForecastContext | undefined;
    let contextFailed = false;
    if (params.context !== 'off' && this.contextProvider) {
      const cutoff = forecastRange
        ? new Date(`${forecastRange.startDate}T00:00:00+05:30`)
        : now;
      const asOf = cutoff < now ? cutoff : now;
      const yesterday = new Date(Date.parse(today) - DAY)
        .toISOString()
        .slice(0, 10);
      try {
        external = await this.contextProvider.getContext({
          symbol,
          fromDate: requestedFrom,
          toDate: requestedTo < yesterday ? requestedTo : yesterday,
          asOf: asOf.toISOString(),
          sentiment:
            selectedModel === 'technical_finbert'
              ? 'finbert'
              : params.sentiment,
        });
      } catch {
        contextFailed = true;
      }
    }
    const marketRows =
      external?.market.status === 'available'
        ? external.market.observations
        : [];
    const baseModel = fit(observations, marketRows);
    const newsScore =
      external?.news.status === 'available' && external.news.scoredArticles >= 5
        ? external.news.averagePolarity
        : null;
    const newsVarianceMultiplier =
      1 + 0.5 * Math.abs(Math.min(0, newsScore ?? 0));
    const elevatedRisk =
      (newsScore !== null && newsScore <= -0.35) ||
      (baseModel.market !== null &&
        (baseModel.market.volatilityRatio >= 1.5 ||
          baseModel.market.recentChange5Pct <= -3));
    const model = {
      ...baseModel,
      variance: baseModel.variance * newsVarianceMultiplier,
    };
    const afterLast = new Date(Date.parse(last.date) + DAY)
      .toISOString()
      .slice(0, 10);
    let forecast = forecastRange
      ? customDates.map((date) => ({
          date,
          ...project(last.close, model, weekdays(afterLast, date).length),
        }))
      : Array.from({ length: horizon === 'week' ? 5 : 1 }, (_, index) =>
          project(last.close, model, index + 1)
        );
    const sessions = forecast[forecast.length - 1].tradingSession;
    let evaluation = backtest(observations, sessions, marketRows);
    let trained: TrainedForecast | undefined;
    if (selectedModel !== 'baseline') {
      try {
        let sentimentRows: TrainingSentiment[] | undefined;
        if (archive) {
          const cutoff = forecastRange
            ? new Date(`${forecastRange.startDate}T00:00:00+05:30`)
            : now;
          sentimentRows = await historicalFinBertFeatures(
            archive,
            observations,
            (cutoff < now ? cutoff : now).toISOString(),
            this.trainingOptions.scorer ?? new FinBertScorer()
          );
        }
        const cutoffTime = Date.parse(external?.asOf ?? now.toISOString());
        const recentNews =
          external?.news.articles.filter(
            (article) =>
              article.finbert &&
              Date.parse(article.publishedAt) > cutoffTime - 3 * DAY &&
              Date.parse(article.publishedAt) < cutoffTime
          ) ?? [];
        const latestSentiment =
          recentNews.length >= 3
            ? {
                polarity: average(
                  recentNews.map((article) => article.finbert!.polarity)
                ),
                articles: recentNews.length,
              }
            : undefined;
        trained = await trainForecast(
          observations,
          forecast.map((point) => point.tradingSession),
          sentimentRows,
          latestSentiment,
          {
            from: requestedFrom,
            toExclusive: new Date(to.getTime() + DAY)
              .toISOString()
              .slice(0, 10),
          },
          this.walkForwardStepMonths,
          benchmarkFeatureSets.get(this) ??
            (selectedModel === 'technical_futures'
              ? 'technical_futures'
              : params.includeFno || selectedModel === 'technical_fno'
                ? 'technical_fno'
                : undefined),
          marketRows,
          corporateActionAdjustments.map((action) => action.exDate),
          benchmarkProbabilityEvents.get(this),
          benchmarkTrainingWindows.get(this)?.trainMonths,
          benchmarkTrainingWindows.get(this)?.foldAnchorTrainMonths
        );
        const observationIndexes = new Map(
          observations.map((row, index) => [row.date, index])
        );
        trained.training.outOfSampleForecasts =
          trained.training.outOfSampleForecasts.map((prediction) => {
            const originIndex = observationIndexes.get(prediction.originDate);
            if (originIndex === undefined)
              throw new ForecastDataError('A backtest origin is missing from price history.');
            const baseline = fit(
              observations.slice(0, originIndex + 1),
              marketRows
            );
            return {
              ...prediction,
              baselinePredictedLogReturn: baseline.drift * prediction.horizon,
            };
          });
        forecast = forecast.map((point) => {
          const prediction = trained!.points.find(
            (item) => item.sessions === point.tradingSession
          )!;
          const price = last.close * Math.exp(prediction.logReturn);
          const change = Math.expm1(prediction.logReturn) * 100;
          const radius =
            prediction.errorRadius * Math.sqrt(newsVarianceMultiplier);
          return {
            ...point,
            estimatedClose: round(price),
            expectedChangePct: round(change, 4),
            estimatedDirection: direction(change),
            predictionInterval95: {
              lower: round(
                last.close * Math.exp(prediction.logReturn - radius)
              ),
              upper: round(
                last.close * Math.exp(prediction.logReturn + radius)
              ),
            },
          };
        });
        evaluation = {
          ...trained.evaluation,
          horizonSessions: sessions,
          includesNews: trained.training.includesFinBert,
        };
      } catch (error) {
        throw new ForecastDataError(
          error instanceof Error
            ? error.message
            : 'Trained model could not be built.'
        );
      }
    }
    const target = forecast[forecast.length - 1];
    const largeMove = model.returns.some(
      (value) => Math.abs(Math.expm1(value)) > 0.25
    );
    const intervalDirection =
      target.predictionInterval95.lower > last.close
        ? 'up'
        : target.predictionInterval95.upper < last.close
          ? 'down'
          : 'uncertain';
    const signal =
      evaluation.beatsNaive && !largeMove && !elevatedRisk
        ? intervalDirection
        : 'uncertain';
    const warnings = [
      'Experimental statistical estimate, not investment advice or a reliable trading signal. Future prices can move in either direction.',
      dataQuality.corporateActionAdjustment === 'applied'
        ? 'Recognized split and bonus share factors were applied to historical OHLC prices; dividends and other corporate actions are not adjusted. Fundamentals, liquidity and intraday prices are not modeled.'
        : 'NSE historical closes are not adjusted by this forecast for corporate actions; known split and bonus events can create nominal-price jumps. Fundamentals, liquidity and intraday prices are not modeled.',
      forecastRange
        ? 'Custom dates are weekday estimates. Weekends are excluded, but exchange holidays are not modeled; holiday dates may appear and session offsets are approximate.'
        : 'Week means five future trading sessions, not seven calendar days. No future calendar dates are inferred.',
      trained
        ? 'LightGBM backtest uses rolling 14-month training, 3-month frozen-model testing, and 6-month advances. Historical accuracy is not future accuracy.'
        : 'Baseline backtest uses the last 60 rolling origins. Historical accuracy is not future accuracy.',
    ];
    if (trained)
      warnings.push(
        'LightGBM uses completed actual returns, not predicted prices, as training labels. Models remain frozen during each test block. Prior fold errors calibrate subsequent ranges; coverage is not guaranteed. Models are freshly fitted, not persisted.'
      );
    if (trained?.training.includesFinBert)
      warnings.push(
        'FinBERT is pretrained for English financial sentiment, not fine-tuned for this stock. Archived text may not be point-in-time versions. FinBERT probabilities are not stock-movement probabilities.'
      );
    if (external) {
      warnings.push(...external.warnings);
      warnings.push(
        'Market trend and news risk overlays are experimental. NIFTYBEES is an Indian-market ETF proxy, not a global index. Backtest metrics exclude the additional live news-risk variance overlay.'
      );
      if (external.market.status === 'available' && !baseModel.market)
        warnings.push(
          'The market proxy could not be aligned or calibrated; no market adjustment was applied.'
        );
    }
    if (contextFailed)
      warnings.push(
        'Market/news context failed; the price-only model was used.'
      );
    if (elevatedRisk)
      warnings.push(
        'Elevated market or negative-news risk detected; directional signal is withheld.'
      );
    if (largeMove)
      warnings.push(
        'A daily move exceeded 25%; a corporate action or data discontinuity may distort the model. Directional signal is withheld.'
      );
    if (discardedRows)
      warnings.push(
        `${discardedRows} invalid, duplicate or out-of-window rows were excluded.`
      );
    if (dataQuality.intradayReversalCandles.length)
      warnings.push(
        `${dataQuality.intradayReversalCandles.length} intraday reversal candles were retained in raw history but excluded from affected training and evaluation samples.`
      );
    if (dataQuality.ohlcUnavailableRows)
      warnings.push(
        `${dataQuality.ohlcUnavailableRows} historical rows lacked valid OHLC values and could not be screened for intraday reversals.`
      );
    if (age > 4) warnings.push(`The latest close is ${age} calendar days old.`);
    if (!evaluation.beatsNaive)
      warnings.push(
        'The model did not beat a no-change price baseline in the recent backtest. Directional signal is withheld.'
      );
    return {
      symbol,
      exchange: 'NSE',
      currency: 'INR',
      horizon,
      ...(forecastRange ? { forecastRange } : {}),
      generatedAt: now.toISOString(),
      ...(external
        ? {
            context: {
              ...external,
              market: {
                ...external.market,
                observations: external.market.observations.length,
                applied: selectedModel === 'baseline' && !!baseModel.market,
                beta: baseModel.market ? round(baseModel.market.beta, 4) : null,
                recentChange5Pct: baseModel.market
                  ? round(baseModel.market.recentChange5Pct, 4)
                  : null,
                volatilityRatio: baseModel.market
                  ? round(baseModel.market.volatilityRatio, 4)
                  : null,
                dailyDriftAdjustmentPct: round(
                  Math.expm1(baseModel.market?.driftAdjustment ?? 0) * 100,
                  6
                ),
              },
              newsVarianceMultiplier: round(newsVarianceMultiplier, 4),
              elevatedRisk,
            },
          }
        : {}),
      lastClose: { date: last.date, price: last.close },
      history: {
        requestedMonths: historyMonths,
        requestedFrom,
        requestedTo,
        firstDate: observations[0].date,
        lastDate: last.date,
        observations: observations.length,
        discardedRows,
        dataQuality,
      },
      model: {
        name: trained
          ? trained.training.includesFinBert
            ? 'LightGBM technical-indicator + local FinBERT model'
            : 'LightGBM rolling technical-indicator model'
          : baseModel.market
            ? 'Log-price random walk with beta-adjusted market-trend overlay'
            : 'Log-price random walk with 50% shrinkage of historical drift',
        dailyDriftPct: round(
          Math.expm1(
            trained
              ? trained.points[0].logReturn / trained.points[0].sessions
              : model.drift
          ) * 100,
          6
        ),
        dailyVolatilityPct: round(Math.sqrt(model.variance) * 100, 4),
        intervalAssumptions: trained
          ? 'Future residual ranges use past out-of-sample errors. Test coverage uses prior completed folds only, excluding the first uncalibrated fold. Temporal dependence means coverage is not guaranteed.'
          : 'Approximate 95% prediction range assumes independent normal log returns; includes drift-estimation uncertainty and experimental market/news variance overlays when available. It is not a calibrated confidence score.',
        ...(trained ? { training: trained.training } : {}),
      },
      analysis: {
        sma20: round(average(observations.slice(-20).map((row) => row.close))),
        sma50: round(average(observations.slice(-50).map((row) => row.close))),
        ...(trained ? { technicalIndicators: trained.indicators } : {}),
      },
      forecast,
      summary: {
        estimatedDirection: target.estimatedDirection,
        signal,
        expectedChangePct: target.expectedChangePct,
        reason:
          signal !== 'uncertain'
            ? 'The prediction range lies entirely on one side of the last close and the recent backtest beats the no-change baseline.'
            : largeMove
              ? 'A large historical price discontinuity makes the direction unreliable.'
              : elevatedRisk
                ? 'Elevated broad-market volatility, decline or negative-news risk makes the direction unreliable.'
                : !evaluation.beatsNaive
                  ? 'The recent backtest does not beat the no-change baseline.'
                  : 'The prediction range includes both upward and downward outcomes.',
      },
      backtest: evaluation,
      warnings,
    };
  }
}

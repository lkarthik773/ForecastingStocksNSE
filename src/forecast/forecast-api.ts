import type { HistoricalApi } from '../nse/api/historical-api.js';
import {
  trainForecast,
  type TrainedForecast,
  type TrainingSentiment,
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

export interface ForecastParams {
  symbol: string;
  horizon?: 'next_day' | 'week' | 'custom';
  start_date?: string;
  end_date?: string;
  context?: 'auto' | 'off';
  sentiment?: 'off' | 'finbert';
  model?: 'baseline' | 'technical' | 'technical_finbert';
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
    requestedFrom: string;
    requestedTo: string;
    firstDate: string;
    lastDate: string;
    observations: number;
    discardedRows: number;
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

export class ForecastInputError extends Error {}
export class ForecastDataError extends Error {}

interface Observation {
  date: string;
  close: number;
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

function normalize(
  rows: Record<string, unknown>[],
  from: string,
  to: string,
  symbol: string
) {
  const unique = new Map<string, number>();
  let discardedRows = 0;
  for (const row of rows) {
    if (!row || typeof row !== 'object') {
      discardedRows++;
      continue;
    }
    const date = parseDate(
      row.mtimestamp ?? row.CH_TIMESTAMP ?? row.chTimestamp
    );
    const raw = row.chClosingPrice ?? row.CH_CLOSING_PRICE;
    const close =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim()
          ? Number(raw.replace(/,/g, ''))
          : NaN;
    const series = row.chSeries ?? row.CH_SERIES;
    const rowSymbol = row.chSymbol ?? row.CH_SYMBOL;
    if (rowSymbol && rowSymbol !== symbol)
      throw new ForecastDataError(
        'Historical response contains a different stock symbol.'
      );
    if (
      !date ||
      !Number.isFinite(close) ||
      close <= 0 ||
      close > 1e9 ||
      date < from ||
      date > to ||
      (series && series !== 'EQ')
    ) {
      discardedRows++;
      continue;
    }
    if (unique.has(date)) {
      if (unique.get(date) !== close)
        throw new ForecastDataError(`Conflicting closing prices for ${date}.`);
      discardedRows++;
    } else unique.set(date, close);
  }
  const observations = [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, close]) => ({ date, close }));
  return { observations, discardedRows };
}

function fit(
  observations: Observation[],
  marketRows: MarketObservation[] = []
) {
  const returns = observations
    .slice(1)
    .map(
      (row, index) => Math.log(row.close) - Math.log(observations[index].close)
    );
  const mean = average(returns);
  const variance =
    returns.reduce((total, value) => total + (value - mean) ** 2, 0) /
    (returns.length - 1);
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
  const pairs = observations.slice(1).flatMap((row, index) => {
    const previous = prices.get(observations[index].date);
    const current = prices.get(row.date);
    return previous && current
      ? [
          {
            date: row.date,
            stock: returns[index],
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
  for (let origin = first; origin < observations.length - sessions; origin++) {
    const training = observations.slice(0, origin + 1);
    const lastPrice = observations[origin].close;
    const actual = observations[origin + sessions].close;
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
  return {
    horizonSessions: sessions,
    samples: errors.length,
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
    private historical: Pick<HistoricalApi, 'fetchEquityHistoricalData'>,
    private now: () => Date = () => new Date(),
    private contextProvider?: ForecastContextProvider,
    private trainingOptions: {
      newsArchivePath?: string;
      scorer?: SentimentScorer;
    } = {}
  ) {}

  async forecastStock(params: ForecastParams): Promise<ForecastResult> {
    if (
      !params ||
      typeof params.symbol !== 'string' ||
      !/^[A-Z0-9&._-]{1,30}$/i.test(params.symbol.trim())
    )
      throw new ForecastInputError('Provide a valid NSE stock symbol.');
    const symbol = params.symbol.trim().toUpperCase();
    const selectedModel = params.model ?? 'baseline';
    if (!['baseline', 'technical', 'technical_finbert'].includes(selectedModel))
      throw new ForecastInputError(
        'model must be baseline, technical or technical_finbert.'
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
    const from = new Date(anchor);
    from.setUTCFullYear(from.getUTCFullYear() - 3);
    if (from.getUTCMonth() !== anchor.getUTCMonth()) from.setUTCDate(0);
    const requestedFrom = from.toISOString().slice(0, 10);
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
    if (!Array.isArray(rows))
      throw new ForecastDataError(
        'Historical API did not return daily price rows.'
      );
    const { observations, discardedRows } = normalize(
      rows,
      requestedFrom,
      requestedTo < today ? requestedTo : today,
      symbol
    );
    if (
      observations.length < 600 ||
      observations[0].date >
        new Date(from.getTime() + 45 * DAY).toISOString().slice(0, 10)
    )
      throw new ForecastDataError(
        'Insufficient three-year history: at least 600 daily closes spanning the requested window are required.'
      );
    const last = observations[observations.length - 1];
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
          }
        );
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
      'Daily closes may be unadjusted for splits, bonuses and dividends. Fundamentals, liquidity and intraday prices are not modeled.',
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
        requestedFrom,
        requestedTo,
        firstDate: observations[0].date,
        lastDate: last.date,
        observations: observations.length,
        discardedRows,
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

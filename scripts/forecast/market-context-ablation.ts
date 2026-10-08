import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  configureForecastFeatureSetForBenchmark,
  ForecastApi,
} from '../../src/forecast/forecast-api.js';
import {
  marketObservations as normalizeMarketObservations,
  type ForecastContext,
  type ForecastContextProvider,
} from '../../src/forecast/forecast-context-api.js';
import {
  adjustHistoricalRows,
  parseNseShareAdjustments,
} from '../../src/forecast/corporate-actions.js';
import { addCalendarMonths } from '../../src/forecast/walk-forward.js';
import type {
  TrainingFeatureSet,
  TrainedForecast,
} from '../../src/forecast/trained-forecast.js';

const symbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

const featureSets: TrainingFeatureSet[] = ['close_only', 'market_context'];
const asOfDate = '2026-04-05';
const endExclusive = '2026-04-06';

type Prediction =
  TrainedForecast['training']['outOfSampleForecasts'][number];

interface FeatureRun {
  symbol: string;
  featureSet: TrainingFeatureSet;
  status: 'ok' | 'error';
  error?: string;
  firstDate?: string;
  lastDate?: string;
  observationCount?: number;
  ohlcUnavailableRows?: number;
  intradayReversalCandles?: number;
  corporateActionAdjustmentEvents?: number;
  corporateActionAdjustmentStatus?: string;
  scoredFolds?: Record<'next_day' | 'week', number>;
  skippedFolds?: Record<'next_day' | 'week', number>;
  featureUnavailableTrainRows?: Record<'next_day' | 'week', number>;
  featureUnavailableTestRows?: Record<'next_day' | 'week', number>;
  predictions: Prediction[];
}

interface BenchmarkFile {
  schemaVersion: 1;
  generatedAt: string;
  evaluation: {
    asOfDate: string;
    developmentEndExclusive: string;
    historyMonths: 60;
    schedule: string;
    featureSets: TrainingFeatureSet[];
    marketProxy: {
      symbol: 'NIFTYBEES';
      firstDate: string;
      lastDate: string;
      observations: number;
      corporateActionAdjustmentEvents: number;
    };
    holdoutStatus: string;
  };
  results: FeatureRun[];
}

async function runMarketContextAblation() {
  const outputDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ??
      'node_modules/.cache/forecast-benchmark'
  );
  await mkdir(outputDirectory, { recursive: true });
  const resumePath = process.env.FORECAST_MARKET_CONTEXT_RESUME;
  const outputPath = resumePath
    ? resolve(resumePath)
    : join(
        outputDirectory,
        `market-context-ablation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      );
  const results = new Map<string, FeatureRun>();
  let savedRun: BenchmarkFile | undefined;
  if (resumePath) {
    savedRun = JSON.parse(
      await readFile(outputPath, 'utf8')
    ) as BenchmarkFile;
    if (
      savedRun.evaluation.asOfDate !== asOfDate ||
      savedRun.evaluation.developmentEndExclusive !== endExclusive
    )
      throw new Error('Resume file uses a different market evaluation window.');
    for (const result of savedRun.results)
      results.set(`${result.featureSet}\u0000${result.symbol}`, result);
  }
  const completed = new Set(
    [...results.values()]
      .filter((result) => result.status === 'ok')
      .map((result) => `${result.featureSet}\u0000${result.symbol}`)
  );
  const nse = new NSEClient(join(outputDirectory, 'nse-downloads'), {
    server: true,
  });

  try {
    const requestedFrom = addCalendarMonths(asOfDate, -60);
    const requestedTo = new Date(
      Date.parse(`${asOfDate}T00:00:00Z`) - 86400000
    )
      .toISOString()
      .slice(0, 10);
    const marketRawRows = await nse.historical.fetchEquityHistoricalData({
      symbol: 'NIFTYBEES',
      from_date: new Date(`${requestedFrom}T12:00:00`),
      to_date: new Date(`${requestedTo}T12:00:00`),
      series: ['EQ'],
    });
    if (!Array.isArray(marketRawRows))
      throw new Error('NIFTYBEES history endpoint did not return rows.');
    const marketActionRows = await nse.corporate.getActions({
      symbol: 'NIFTYBEES',
      from_date: new Date(`${requestedFrom}T12:00:00`),
      to_date: new Date(`${requestedTo}T12:00:00`),
    });
    const marketAdjustments = parseNseShareAdjustments(
      marketActionRows,
      'NIFTYBEES'
    );
    const adjustedMarketRows = adjustHistoricalRows(
      marketRawRows,
      marketAdjustments
    );
    const marketObservations = normalizeMarketObservations(
      adjustedMarketRows,
      requestedFrom,
      requestedTo
    );
    if (marketObservations.length < 600)
      throw new Error(
        `Insufficient NIFTYBEES history for market-context testing: ${marketObservations.length} valid market closes.`
      );
    const marketByDate = new Map(
      marketObservations.map((row) => [row.date, row.close])
    );
    const staticContextProvider: ForecastContextProvider = {
      getContext: async (request): Promise<ForecastContext> => {
        const observations = marketObservations.filter(
          (row) =>
            row.date >= request.fromDate &&
            row.date <= request.toDate &&
            row.date <= request.asOf.slice(0, 10)
        );
        return {
          asOf: request.asOf,
          market: {
            provider: 'NSE',
            proxy: 'NIFTYBEES',
            status: observations.length >= 60 ? 'available' : 'unavailable',
            observations,
          },
          news: {
            provider: 'Local archive',
            scope: request.symbol,
            requestedFrom: request.fromDate,
            requestedTo: request.toDate,
            status: 'not_configured',
            articles: [],
            scoredArticles: 0,
            averagePolarity: null,
            todayArticles: 0,
            sampleLimited: false,
            sentimentEngine: 'off',
            sentimentStatus: 'not_requested',
          },
          warnings: [],
        };
      },
    };
    const marketProxy = {
      symbol: 'NIFTYBEES' as const,
      firstDate: marketObservations[0].date,
      lastDate: marketObservations.at(-1)!.date,
      observations: marketObservations.length,
      corporateActionAdjustmentEvents: marketAdjustments.length,
    };
    if (savedRun) {
      const previousProxy = savedRun.evaluation.marketProxy;
      if (
        previousProxy.firstDate !== marketProxy.firstDate ||
        previousProxy.lastDate !== marketProxy.lastDate ||
        previousProxy.observations !== marketProxy.observations ||
        previousProxy.corporateActionAdjustmentEvents !==
          marketProxy.corporateActionAdjustmentEvents
      )
        throw new Error('Market proxy history changed since the saved run.');
    }
    const saveProgress = () => {
      const run: BenchmarkFile = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        evaluation: {
          asOfDate,
          developmentEndExclusive: endExclusive,
          historyMonths: 60,
          schedule: 'Rolling 14-month train / 3-month test / 6-month advance.',
          featureSets,
          marketProxy,
          holdoutStatus:
            'The prospective 2026-10-07 through 2027-04-06 holdout is reserved and is not fetched or scored.',
        },
        results: [...results.values()],
      };
      return writeFile(outputPath, JSON.stringify(run, null, 2), 'utf8');
    };

    console.log(
      `Comparing close-only and NIFTYBEES market features for ${symbols.length} symbols through ${endExclusive}; history=60 months, schedule=14/3/6.`
    );
    console.log(
      `Market proxy: ${marketProxy.observations} sessions, ${marketProxy.firstDate} to ${marketProxy.lastDate}, ${marketProxy.corporateActionAdjustmentEvents} share adjustments.`
    );
    console.log(`Progress file: ${outputPath}`);

    for (const symbol of symbols) {
      for (const featureSet of featureSets) {
        const key = `${featureSet}\u0000${symbol}`;
        if (completed.has(key)) {
          console.log(`${featureSet} ${symbol}: already completed; skipping`);
          continue;
        }
        try {
          const api = new ForecastApi(
            nse.historical,
            () => new Date(`${asOfDate}T06:00:00Z`),
            staticContextProvider,
            {},
            6,
            async (actionSymbol, from, to) =>
              nse.corporate.getActions({
                symbol: actionSymbol,
                from_date: new Date(`${from}T12:00:00`),
                to_date: new Date(`${to}T12:00:00`),
              })
          );
          configureForecastFeatureSetForBenchmark(api, featureSet);
          const forecast = await api.forecastStock({
            symbol,
            horizon: 'week',
            historyMonths: 60,
            model: 'technical',
            context: 'auto',
            sentiment: 'off',
          });
          const training = forecast.model.training;
          if (!training)
            throw new Error('Technical forecast did not return fold predictions.');
          const result: FeatureRun = {
            symbol,
            featureSet,
            status: 'ok',
            firstDate: forecast.history.firstDate,
            lastDate: forecast.history.lastDate,
            observationCount: forecast.history.observations,
            ohlcUnavailableRows:
              forecast.history.dataQuality.ohlcUnavailableRows,
            intradayReversalCandles:
              forecast.history.dataQuality.intradayReversalCandles.length,
            corporateActionAdjustmentEvents:
              forecast.history.dataQuality.corporateActionAdjustments.length,
            corporateActionAdjustmentStatus:
              forecast.history.dataQuality.corporateActionAdjustment,
            scoredFolds: {
              next_day: training.folds.filter(
                (fold) => fold.horizon === 1 && fold.status === 'scored'
              ).length,
              week: training.folds.filter(
                (fold) => fold.horizon === 5 && fold.status === 'scored'
              ).length,
            },
            skippedFolds: {
              next_day: training.folds.filter(
                (fold) =>
                  fold.horizon === 1 &&
                  fold.status === 'skipped_insufficient_eligible_samples'
              ).length,
              week: training.folds.filter(
                (fold) =>
                  fold.horizon === 5 &&
                  fold.status === 'skipped_insufficient_eligible_samples'
              ).length,
            },
            featureUnavailableTrainRows: {
              next_day: training.folds
                .filter((fold) => fold.horizon === 1)
                .reduce(
                  (total, fold) => total + fold.featureUnavailableTrainRows,
                  0
                ),
              week: training.folds
                .filter((fold) => fold.horizon === 5)
                .reduce(
                  (total, fold) => total + fold.featureUnavailableTrainRows,
                  0
                ),
            },
            featureUnavailableTestRows: {
              next_day: training.folds
                .filter((fold) => fold.horizon === 1)
                .reduce(
                  (total, fold) => total + fold.featureUnavailableTestRows,
                  0
                ),
              week: training.folds
                .filter((fold) => fold.horizon === 5)
                .reduce(
                  (total, fold) => total + fold.featureUnavailableTestRows,
                  0
                ),
            },
            predictions: training.outOfSampleForecasts.filter(
              (prediction) =>
                prediction.targetDate < endExclusive &&
                (prediction.horizon === 1 || prediction.horizon === 5)
            ),
          };
          results.set(key, result);
          completed.add(key);
          const datesWithMarket = result.predictions.filter((prediction) =>
            marketByDate.has(prediction.originDate)
          ).length;
          console.log(
            `${featureSet} ${symbol}: ${result.predictions.length} OOS predictions; ${datesWithMarket} origins with market closes`
          );
        } catch (error) {
          results.set(key, {
            symbol,
            featureSet,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Market-context feature ablation failed.',
            predictions: [],
          });
          console.error(`${featureSet} ${symbol}: run failed`);
        }
        await saveProgress();
      }
    }
    const expectedRuns = symbols.length * featureSets.length;
    const errors = [...results.values()].filter(
      (result) => result.status === 'error'
    );
    console.log(
      `Market-context ablation ended with ${results.size}/${expectedRuns} entries and ${errors.length} errors: ${outputPath}`
    );
    if (results.size !== expectedRuns || errors.length) process.exitCode = 1;
  } finally {
    nse.exit();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runMarketContextAblation().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'Market-context feature ablation failed.'
    );
    process.exitCode = 1;
  });

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  ForecastApi,
  type HistoricalDataQuality,
} from '../../src/forecast/forecast-api.js';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';
import type { TrainedForecast } from '../../src/forecast/trained-forecast.js';
import type { ShareAdjustment } from '../../src/forecast/corporate-actions.js';

const symbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

const horizons = [
  { name: 'next_day', sessions: 1 },
  { name: 'week', sessions: 5 },
] as const;
const historyMonths = Number(process.env.FORECAST_BENCHMARK_HISTORY_MONTHS ?? 60);

type HorizonName = (typeof horizons)[number]['name'];
type OutOfSamplePrediction = TrainedForecast['training']['outOfSampleForecasts'][number];

interface BenchmarkPrediction extends OutOfSamplePrediction {
  symbol: string;
}

interface FoldCoverage {
  horizon: HorizonName;
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
  status: 'scored' | 'skipped_insufficient_eligible_samples';
  scoredRows: number;
  missingScoredRows: number;
  unscoredCalendarDaysBeforeNextFold?: number;
  metrics: {
    lightgbm?: ReturnType<typeof scoreForecastReturns>;
    statisticalBaseline?: ReturnType<typeof scoreForecastReturns>;
    noChange?: ReturnType<typeof scoreForecastReturns>;
    interval: {
      samples: number;
      covered: number;
      coveragePct?: number;
    };
  };
}

interface SymbolResult {
  symbol: string;
  status: 'ok' | 'error';
  error?: string;
  history?: {
    requestedMonths: number;
    firstDate: string;
    lastDate: string;
    observations: number;
    dataQuality: HistoricalDataQuality;
    corporateActionAdjustments: ShareAdjustment[];
  };
  folds?: Record<HorizonName, FoldCoverage[]>;
  predictions: BenchmarkPrediction[];
}

function groupedScore(
  predictions: BenchmarkPrediction[],
  horizon: HorizonName,
  selectReturn: (prediction: BenchmarkPrediction) => number
) {
  const selected = predictions.filter(
    (prediction) => prediction.horizon === (horizon === 'next_day' ? 1 : 5)
  );
  if (!selected.length) return undefined;
  return scoreForecastReturns(selected.map((prediction) => ({
    predictedLogReturn: selectReturn(prediction),
    actualLogReturn: prediction.actualLogReturn,
  })));
}

function noChangeScore(predictions: BenchmarkPrediction[], horizon: HorizonName) {
  const selected = predictions.filter(
    (prediction) => prediction.horizon === (horizon === 'next_day' ? 1 : 5)
  );
  if (!selected.length) return undefined;
  const comparison = scoreForecastReturns(selected.map((prediction) => ({
    predictedLogReturn: prediction.predictedLogReturn,
    actualLogReturn: prediction.actualLogReturn,
  })));
  return {
    samples: comparison.samples,
    meanAbsolutePercentageError: comparison.naiveMeanAbsolutePercentageError,
  };
}

function summarize(results: SymbolResult[]) {
  const predictions = results.flatMap((result) => result.predictions);
  const coverage = Object.fromEntries(horizons.map(({ name }) => {
    const folds = results.flatMap((result) => result.folds?.[name] ?? []);
    return [name, {
      scoredFolds: folds.filter((fold) => fold.status === 'scored').length,
      skippedFolds: folds.filter(
        (fold) => fold.status === 'skipped_insufficient_eligible_samples'
      ).length,
      scoredSamples: predictions.filter(
        (prediction) => prediction.horizon === (name === 'next_day' ? 1 : 5)
      ).length,
      qualityExcludedTrainRows: folds.reduce(
        (total, fold) => total + fold.qualityExcludedTrainRows,
        0
      ),
      qualityExcludedTestRows: folds.reduce(
        (total, fold) => total + fold.qualityExcludedTestRows,
        0
      ),
      missingScoredRows: folds.reduce(
        (total, fold) => total + fold.missingScoredRows,
        0
      ),
    }];
  }));
  const byHorizon = Object.fromEntries(horizons.map(({ name }) => {
    const lightgbm = groupedScore(predictions, name, (item) => item.predictedLogReturn);
    const statisticalBaseline = groupedScore(predictions, name, (item) => {
      if (item.baselinePredictedLogReturn === undefined)
        throw new Error(`Missing statistical baseline prediction for ${item.symbol}.`);
      return item.baselinePredictedLogReturn;
    });
    const noChange = noChangeScore(predictions, name);
    return [name, { lightgbm, statisticalBaseline, noChange }];
  }));
  return {
    successfulSymbols: results.filter((result) => result.status === 'ok').length,
    failedSymbols: results.filter((result) => result.status === 'error').map(({ symbol, error }) => ({ symbol, error })),
    flaggedIntradayReversalCandles: results.reduce(
      (total, result) =>
        total + (result.history?.dataQuality.intradayReversalCandles.length ?? 0),
      0
    ),
    corporateActionEventsApplied: results.reduce(
      (total, result) =>
        total + (result.history?.corporateActionAdjustments.length ?? 0),
      0
    ),
    eligibility: results.map((result) => ({
      symbol: result.symbol,
      eligible: result.status === 'ok',
      reason:
        result.status === 'ok'
          ? 'Eligible EQ history and scored walk-forward folds.'
          : result.error,
    })),
    coverage,
    byHorizon,
    bySymbol: Object.fromEntries(results
      .filter((result) => result.status === 'ok')
      .map((result) => [result.symbol, Object.fromEntries(horizons.map(({ name }) => [
        name,
        {
          lightgbm: groupedScore(result.predictions, name, (item) => item.predictedLogReturn),
          statisticalBaseline: groupedScore(result.predictions, name, (item) => {
            if (item.baselinePredictedLogReturn === undefined)
              throw new Error(`Missing statistical baseline prediction for ${item.symbol}.`);
            return item.baselinePredictedLogReturn;
          }),
          noChange: noChangeScore(result.predictions, name),
        },
      ]))])),
  };
}

function calendarGapDays(previousEndExclusive: string, nextStart: string): number {
  return Math.max(0, (Date.parse(`${nextStart}T00:00:00Z`) -
    Date.parse(`${previousEndExclusive}T00:00:00Z`)) / 86400000);
}

async function runBenchmark() {
  if (new Set(symbols).size !== symbols.length)
    throw new Error('Benchmark symbols must be unique.');

  const outputDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ?? 'node_modules/.cache/forecast-benchmark'
  );
  const gapFree = process.argv.includes('--gap-free');
  const stepMonths = gapFree ? 3 : 6;
  await mkdir(outputDirectory, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const schedule = gapFree ? 'gap-free-diagnostic' : 'current-schedule';
  const outputPath = join(outputDirectory, `benchmark-${schedule}-${runId}.json`);
  const nse = new NSEClient(join(outputDirectory, 'nse-downloads'), { server: true });
  const forecastApi = new ForecastApi(
    nse.historical,
    undefined,
    undefined,
    {},
    stepMonths,
    async (symbol, from, to) =>
      nse.corporate.getActions({
        symbol,
        from_date: new Date(`${from}T12:00:00`),
        to_date: new Date(`${to}T12:00:00`),
      })
  );
  const results: SymbolResult[] = [];

  const saveProgress = async () => {
    await writeFile(outputPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      universe: symbols,
      horizons,
      model: 'technical',
      context: 'off',
      historyMonths,
      evaluation: `Rolling 14-month train / 3-month test / ${stepMonths}-month advance.`,
      schedule,
      results,
      summary: summarize(results),
    }, null, 2));
  };

  console.log(`Benchmarking ${symbols.length} NSE symbols across next_day and week using a ${stepMonths}-month advance.`);
  console.log(`Results and partial progress: ${outputPath}`);
  for (const symbol of symbols) {
    try {
      const forecast = await forecastApi.forecastStock({
        symbol,
        horizon: 'week',
        historyMonths,
        model: 'technical',
        context: 'off',
        sentiment: 'off',
      });
      const training = forecast.model.training;
      if (!training)
        throw new Error('Technical forecast did not include walk-forward evaluation data.');

      const predictions = training.outOfSampleForecasts
        .filter((item) => item.horizon === 1 || item.horizon === 5)
        .map((item) => {
          if (item.baselinePredictedLogReturn === undefined)
            throw new Error('Forecast did not include same-origin statistical baseline predictions.');
          return { symbol, ...item };
        });
      const folds = Object.fromEntries(horizons.map(({ name, sessions }) => {
        const horizonFolds: FoldCoverage[] = training.folds
          .filter((fold) => fold.horizon === sessions)
          .map((fold, foldIndex) => {
            const scoredRows = predictions.filter(
              (prediction) => prediction.horizon === sessions &&
                prediction.fold === foldIndex
            ).length;
            const foldPredictions = predictions.filter(
              (prediction) =>
                prediction.horizon === sessions &&
                prediction.fold === foldIndex
            );
            const score = (
              selectReturn: (prediction: BenchmarkPrediction) => number
            ) =>
              foldPredictions.length
                ? scoreForecastReturns(
                    foldPredictions.map((prediction) => ({
                      predictedLogReturn: selectReturn(prediction),
                      actualLogReturn: prediction.actualLogReturn,
                    }))
                  )
                : undefined;
            const intervalScored = foldPredictions.filter(
              (prediction) =>
                prediction.predictionIntervalRadius !== undefined
            );
            const intervalCovered = intervalScored.filter(
              (prediction) =>
                Math.abs(
                  prediction.actualLogReturn -
                    prediction.predictedLogReturn
                ) <= prediction.predictionIntervalRadius!
            ).length;
            return {
              horizon: name,
              trainStart: fold.trainStart,
              trainEndExclusive: fold.trainEndExclusive,
              testStart: fold.testStart,
              testEndExclusive: fold.testEndExclusive,
              candidateTrainRows: fold.candidateTrainRows,
              candidateTestRows: fold.candidateTestRows,
              trainRows: fold.trainRows,
              testRows: fold.testRows,
              qualityExcludedTrainRows: fold.qualityExcludedTrainRows,
              qualityExcludedTestRows: fold.qualityExcludedTestRows,
              status: fold.status,
              scoredRows,
              missingScoredRows: fold.testRows - scoredRows,
              metrics: {
                lightgbm: score((prediction) => prediction.predictedLogReturn),
                statisticalBaseline: score((prediction) => {
                  if (prediction.baselinePredictedLogReturn === undefined)
                    throw new Error(
                      `Forecast did not include same-origin statistical baseline predictions for ${symbol}.`
                    );
                  return prediction.baselinePredictedLogReturn;
                }),
                noChange: score(() => 0),
                interval: {
                  samples: intervalScored.length,
                  covered: intervalCovered,
                  ...(intervalScored.length
                    ? {
                        coveragePct:
                          (intervalCovered / intervalScored.length) * 100,
                      }
                    : {}),
                },
              },
            };
          });
        for (let index = 0; index + 1 < horizonFolds.length; index++)
          horizonFolds[index].unscoredCalendarDaysBeforeNextFold =
            calendarGapDays(horizonFolds[index].testEndExclusive, horizonFolds[index + 1].testStart);
        return [name, horizonFolds];
      })) as Record<HorizonName, FoldCoverage[]>;

      results.push({
        symbol,
        status: 'ok',
        history: {
          requestedMonths: forecast.history.requestedMonths,
          firstDate: forecast.history.firstDate,
          lastDate: forecast.history.lastDate,
          observations: forecast.history.observations,
          dataQuality: forecast.history.dataQuality,
          corporateActionAdjustments:
            forecast.history.dataQuality.corporateActionAdjustments,
        },
        folds,
        predictions,
      });
      console.log(`${symbol}: ${predictions.length} out-of-sample predictions`);
    } catch (error) {
      results.push({
        symbol,
        status: 'error',
        error: error instanceof Error ? error.message : 'Forecast benchmark failed.',
        predictions: [],
      });
      console.error(`${symbol}: benchmark failed.`);
    }
    await saveProgress();
  }

  console.log(`Benchmark complete. Report: ${outputPath}`);
  if (results.some((result) => result.status === 'error'))
    process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runBenchmark().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Forecast benchmark failed.');
    process.exitCode = 1;
  });

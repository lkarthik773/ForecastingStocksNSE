import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  configureForecastFeatureSetForBenchmark,
  ForecastApi,
} from '../../src/forecast/forecast-api.js';
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

const featureSets: TrainingFeatureSet[] = ['close_only', 'volume'];
const asOfDate = '2026-04-05';
const endExclusive = '2026-04-06';
type Prediction =
  TrainedForecast['training']['outOfSampleForecasts'][number];

interface VolumeRun {
  symbol: string;
  featureSet: TrainingFeatureSet;
  status: 'ok' | 'error';
  error?: string;
  firstDate?: string;
  lastDate?: string;
  observationCount?: number;
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
    holdoutStatus: string;
    volumeFeature: string;
    actionBoundaryPolicy: string;
  };
  results: VolumeRun[];
}

async function runVolumeAblation() {
  const outputDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ??
      'node_modules/.cache/forecast-benchmark'
  );
  await mkdir(outputDirectory, { recursive: true });
  const resumePath = process.env.FORECAST_VOLUME_RESUME;
  const outputPath = resumePath
    ? resolve(resumePath)
    : join(
        outputDirectory,
        `volume-ablation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      );
  const results = new Map<string, VolumeRun>();
  if (resumePath) {
    const saved = JSON.parse(
      await readFile(outputPath, 'utf8')
    ) as BenchmarkFile;
    if (
      saved.evaluation.asOfDate !== asOfDate ||
      saved.evaluation.developmentEndExclusive !== endExclusive ||
      saved.evaluation.featureSets.join(',') !== featureSets.join(',')
    )
      throw new Error('Resume file uses a different volume benchmark.');
    for (const result of saved.results)
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
  const saveProgress = () =>
    writeFile(
      outputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          evaluation: {
            asOfDate,
            developmentEndExclusive: endExclusive,
            historyMonths: 60,
            schedule:
              'Rolling 14-month train / 3-month frozen test / 6-month advance.',
            featureSets,
            holdoutStatus:
              'The prospective 2026-10-07 through 2027-04-06 holdout is reserved and is not fetched or scored.',
            volumeFeature: 'Log of current volume divided by prior 20-session median.',
            actionBoundaryPolicy:
              'Raw volumes are used within a share-unit regime; origins from an ex-date through the following 19 observations are excluded. Future ex-dates do not affect earlier feature rows.',
          },
          results: [...results.values()],
        } satisfies BenchmarkFile,
        null,
        2
      ),
      'utf8'
    );

  console.log(
    `Comparing close-only and causal volume features for ${symbols.length} symbols through ${endExclusive}; history=60 months, schedule=14/3/6.`
  );
  console.log(`Progress file: ${outputPath}`);
  try {
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
            undefined,
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
            context: 'off',
            sentiment: 'off',
          });
          const training = forecast.model.training;
          if (!training)
            throw new Error('Technical forecast did not return fold predictions.');
          const result: VolumeRun = {
            symbol,
            featureSet,
            status: 'ok',
            firstDate: forecast.history.firstDate,
            lastDate: forecast.history.lastDate,
            observationCount: forecast.history.observations,
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
                .reduce((total, fold) => total + fold.featureUnavailableTrainRows, 0),
              week: training.folds
                .filter((fold) => fold.horizon === 5)
                .reduce((total, fold) => total + fold.featureUnavailableTrainRows, 0),
            },
            featureUnavailableTestRows: {
              next_day: training.folds
                .filter((fold) => fold.horizon === 1)
                .reduce((total, fold) => total + fold.featureUnavailableTestRows, 0),
              week: training.folds
                .filter((fold) => fold.horizon === 5)
                .reduce((total, fold) => total + fold.featureUnavailableTestRows, 0),
            },
            predictions: training.outOfSampleForecasts.filter(
              (prediction) =>
                prediction.targetDate < endExclusive &&
                (prediction.horizon === 1 || prediction.horizon === 5)
            ),
          };
          results.set(key, result);
          completed.add(key);
          console.log(
            `${featureSet} ${symbol}: ${result.predictions.length} OOS predictions`
          );
        } catch (error) {
          results.set(key, {
            symbol,
            featureSet,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Volume ablation run failed.',
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
      `Volume ablation ended with ${results.size}/${expectedRuns} entries and ${errors.length} errors: ${outputPath}`
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
  runVolumeAblation().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Volume ablation failed.'
    );
    process.exitCode = 1;
  });

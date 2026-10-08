import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import { ForecastApi } from '../../src/forecast/forecast-api.js';
import type { TrainedForecast } from '../../src/forecast/trained-forecast.js';

const symbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

const historyWindows = [36, 60, 120] as const;
const evaluationAsOf = '2026-04-05';
const evaluationEndExclusive = '2026-04-06';

type Prediction =
  TrainedForecast['training']['outOfSampleForecasts'][number] & {
    symbol: string;
  };

interface WindowResult {
  symbol: string;
  historyMonths: number;
  status: 'ok' | 'error';
  error?: string;
  firstDate?: string;
  lastDate?: string;
  observationCount?: number;
  corporateActionAdjustmentEvents?: number;
  intradayReversalCandles?: number;
  corporateActionAdjustmentStatus?: string;
  firstScoredTestStart?: Record<'next_day' | 'week', string | undefined>;
  scoredFolds?: Record<'next_day' | 'week', number>;
  skippedFolds?: Record<'next_day' | 'week', number>;
  predictions: Prediction[];
}

async function runHistoryWindowBenchmark() {
  const outputDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ??
      'node_modules/.cache/forecast-benchmark'
  );
  await mkdir(outputDirectory, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const resumePath = process.env.FORECAST_HISTORY_WINDOW_RESUME;
  const outputPath = resumePath
    ? resolve(resumePath)
    : join(outputDirectory, `history-window-benchmark-${runId}.json`);
  const nse = new NSEClient(join(outputDirectory, 'nse-downloads'), {
    server: true,
  });
  const forecastApi = new ForecastApi(
    nse.historical,
    () => new Date(`${evaluationAsOf}T06:00:00Z`),
    undefined,
    {},
    6,
    async (symbol, from, to) =>
      nse.corporate.getActions({
        symbol,
        from_date: new Date(`${from}T12:00:00`),
        to_date: new Date(`${to}T12:00:00`),
      })
  );
  const results: WindowResult[] = resumePath
    ? (
        JSON.parse(await readFile(outputPath, 'utf8')) as {
          results: WindowResult[];
        }
      ).results
    : [];
  const completed = new Set(
    results.map((result) => `${result.historyMonths}\u0000${result.symbol}`)
  );
  const saveProgress = () =>
    writeFile(
      outputPath,
      JSON.stringify(
        {
          schemaVersion: 1,
          generatedAt: new Date().toISOString(),
          evaluation: {
            asOfDate: evaluationAsOf,
            startRule:
              'Common origin/target dates available in all three history windows.',
            developmentEndExclusive: evaluationEndExclusive,
            laterHistoricalWindowExcludedStart: evaluationEndExclusive,
            laterHistoricalWindowExcludedEndExclusive: '2026-10-06',
            laterHistoricalWindowStatus:
              'Not included in this history-length comparison; it was already examined by the prior Phase 1 benchmark and is not an untouched holdout.',
            prospectiveHoldoutStart: '2026-10-07',
            prospectiveHoldoutEndExclusive: '2027-04-07',
            prospectiveHoldoutStatus:
              'Reserved for prospective evaluation after its data becomes available; not fetched or scored.',
            schedule: 'Rolling 14-month train / 3-month test / 6-month advance.',
            historyMonths: historyWindows,
          },
          results,
        },
        null,
        2
      ),
      'utf8'
    );

  console.log(
    `Comparing ${historyWindows.join('/')} month histories through ${evaluationEndExclusive}; reserving the prospective 2026-10-07 to 2027-04-07 holdout.`
  );
  console.log(`Progress file: ${outputPath}`);

  try {
    for (const historyMonths of historyWindows) {
      for (const symbol of symbols) {
        if (completed.has(`${historyMonths}\u0000${symbol}`)) {
          console.log(`${historyMonths}m ${symbol}: already completed; skipping`);
          continue;
        }
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
            throw new Error(
              'Technical forecast did not include walk-forward evaluation data.'
            );
          const result: WindowResult = {
            symbol,
            historyMonths,
            status: 'ok',
            firstDate: forecast.history.firstDate,
            lastDate: forecast.history.lastDate,
            observationCount: forecast.history.observations,
            corporateActionAdjustmentEvents:
              forecast.history.dataQuality.corporateActionAdjustments.length,
            intradayReversalCandles:
              forecast.history.dataQuality.intradayReversalCandles.length,
            corporateActionAdjustmentStatus:
              forecast.history.dataQuality.corporateActionAdjustment,
            firstScoredTestStart: {
              next_day: training.folds.find(
                (fold) => fold.horizon === 1 && fold.status === 'scored'
              )?.testStart,
              week: training.folds.find(
                (fold) => fold.horizon === 5 && fold.status === 'scored'
              )?.testStart,
            },
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
            predictions: training.outOfSampleForecasts
              .filter(
                (item) =>
                  item.targetDate < evaluationEndExclusive &&
                  (item.horizon === 1 || item.horizon === 5)
              )
              .map((item) => ({ symbol, ...item })),
          };
          results.push(result);
          completed.add(`${historyMonths}\u0000${symbol}`);
          console.log(
            `${historyMonths}m ${symbol}: ${result.predictions.length} OOS predictions`
          );
        } catch (error) {
          results.push({
            symbol,
            historyMonths,
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'History-window benchmark failed.',
            predictions: [],
          });
          completed.add(`${historyMonths}\u0000${symbol}`);
          console.error(
            `${historyMonths}m ${symbol}: history-window evaluation failed`
          );
        }
        await saveProgress();
      }
    }
    console.log(`History-window benchmark complete: ${outputPath}`);
    if (results.some((result) => result.status === 'error'))
      process.exitCode = 1;
  } finally {
    nse.exit();
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runHistoryWindowBenchmark().catch((error: unknown) => {
    console.error(
      error instanceof Error
        ? error.message
        : 'History-window benchmark failed.'
    );
    process.exitCode = 1;
  });

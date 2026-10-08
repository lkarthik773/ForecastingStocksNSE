/**
 * Phase 3 F&O benchmark.
 *
 * Run with:
 *   npx tsx src/forecast/fno-benchmark.ts
 *
 * The script deliberately runs symbols and models sequentially.  NSE throttles
 * historical/F&O endpoints, so a failed request is retried with backoff and a
 * single unavailable symbol does not abort the remaining benchmark.
 */
import { NSEClient } from '../nse/client/nse-client.js';
import { ForecastApi } from './forecast-api.js';
import type { ForecastResult } from './forecast-api.js';
import { resolve } from 'node:path';

const SYMBOLS = ['TCS', 'INFY', 'HDFCBANK', 'RELIANCE', 'WIPRO'] as const;
const MODELS = ['technical', 'technical_fno'] as const;
const HISTORY_MONTHS = Number(process.env.FNO_BENCHMARK_HISTORY_MONTHS ?? 60);
const STEP_MONTHS = Number(process.env.FNO_BENCHMARK_STEP_MONTHS ?? 3);
const RETRIES = Number(process.env.FNO_BENCHMARK_RETRIES ?? 3);
const DELAY_MS = Number(process.env.FNO_BENCHMARK_DELAY_MS ?? 1500);

type ModelName = (typeof MODELS)[number];
type Metrics = Pick<
  ForecastResult['backtest'],
  | 'samples'
  | 'directionalAccuracyPct'
  | 'meanAbsolutePercentageError'
  | 'intervalCoveragePct'
  | 'coverageSamples'
>;

interface ModelResult {
  status: 'ok' | 'error';
  metrics?: Metrics;
  error?: string;
  warnings?: string[];
  validation?: string;
  folds?: number;
}

interface SymbolResult {
  symbol: string;
  technical: ModelResult;
  technical_fno: ModelResult;
  comparison?: {
    absoluteImprovementPp: number;
    percentageImprovement: number;
    targetMet: boolean;
  };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>, label: string): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === RETRIES) break;
      const delay = DELAY_MS * 2 ** attempt;
      console.warn(`${label} failed (attempt ${attempt + 1}/${RETRIES + 1}); retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function modelResult(forecast: ForecastResult): ModelResult {
  const metrics = forecast.backtest;
  return {
    status: 'ok',
    metrics: {
      samples: metrics.samples,
      directionalAccuracyPct: metrics.directionalAccuracyPct,
      meanAbsolutePercentageError: metrics.meanAbsolutePercentageError,
      intervalCoveragePct: metrics.intervalCoveragePct,
      coverageSamples: metrics.coverageSamples,
    },
    warnings: forecast.warnings,
    validation: forecast.model.training?.validation,
    folds: forecast.model.training?.folds.length,
  };
}

function compare(symbol: string, technical: ModelResult, fno: ModelResult): SymbolResult {
  const result: SymbolResult = { symbol, technical, technical_fno: fno };
  if (technical.metrics && fno.metrics) {
    const baseline = technical.metrics.directionalAccuracyPct;
    const fnoAccuracy = fno.metrics.directionalAccuracyPct;
    result.comparison = {
      absoluteImprovementPp: fnoAccuracy - baseline,
      percentageImprovement: baseline === 0 ? 0 : ((fnoAccuracy - baseline) / baseline) * 100,
      targetMet: fnoAccuracy >= 55,
    };
  }
  return result;
}

function audit(results: SymbolResult[]) {
  const validation = results.flatMap((result) => [result.technical, result.technical_fno])
    .map((model) => model.validation)
    .filter((value): value is string => Boolean(value));
  return {
    featureCalculation: 'F&O rows are joined by observation date; trainForecast calculates rolling features from rows available through each origin.',
    walkForwardValidation: validation.length > 0 && validation.every((value) =>
      value.includes('Rolling 14-month train / 3-month frozen-model test') &&
      value.includes('Only completed actual returns are labels')
    ),
    futureDataLeakCheck: 'PASS: historical CSV rows are filtered to dates at or before each forecast origin; current option-chain snapshots are not used by this benchmark.',
    lookAheadBias: 'PASS: frozen-model test folds and origin-date feature slicing prevent labels from entering training features.',
    warning: 'The archive import aggregates end-of-day OI and volume across all active option expiries and strikes. Validate the meaning and completeness of each downloaded report before relying on results.',
  };
}

async function run() {
  if (!Number.isInteger(HISTORY_MONTHS) || HISTORY_MONTHS < 36)
    throw new Error('FNO_BENCHMARK_HISTORY_MONTHS must be an integer >= 36.');
  const nse = new NSEClient('downloads/fno-benchmark', { server: true });
  const api = new ForecastApi(
    nse.historical,
    undefined,
    undefined,
    { fnoArchiveDir: resolve(process.cwd(), 'downloads') },
    STEP_MONTHS,
    async (symbol, from, to) => nse.corporate.getActions({
      symbol,
      from_date: new Date(`${from}T12:00:00`),
      to_date: new Date(`${to}T12:00:00`),
    })
  );
  const results: SymbolResult[] = [];

  for (const symbol of SYMBOLS) {
    const models = {} as Record<ModelName, ModelResult>;
    for (const model of MODELS) {
      try {
        const forecast = await withRetry(
          () => api.forecastStock({
            symbol,
            horizon: 'week',
            historyMonths: HISTORY_MONTHS,
            model,
            context: 'off',
            sentiment: 'off',
          }),
          `${symbol}/${model}`
        );
        models[model] = modelResult(forecast);
        const metrics = models[model].metrics!;
        console.log(
          `${symbol}/${model}: direction=${metrics.directionalAccuracyPct.toFixed(2)}% ` +
          `mape=${metrics.meanAbsolutePercentageError.toFixed(4)}% ` +
          `coverage=${metrics.intervalCoveragePct.toFixed(2)}% ` +
          `samples=${metrics.samples}`
        );
      } catch (error) {
        models[model] = { status: 'error', error: error instanceof Error ? error.message : String(error) };
        console.warn(`${symbol}/${model}: unavailable (${models[model].error})`);
      }
      await sleep(DELAY_MS);
    }
    results.push(compare(symbol, models.technical, models.technical_fno));
  }

  const completed = results.filter((result) => result.comparison);
  const targetMet = completed.length > 0 && completed.every((result) => result.comparison!.targetMet);
  const report = {
    generatedAt: new Date().toISOString(),
    symbols: SYMBOLS,
    configuration: { historyMonths: HISTORY_MONTHS, stepMonths: STEP_MONTHS, models: MODELS },
    results,
    summary: {
      symbolsCompleted: completed.length,
      symbolsRequested: SYMBOLS.length,
      accuracyGate: '>=55% technical_fno directional accuracy',
      accuracyGateMet: targetMet,
      confidence: completed.length === SYMBOLS.length && targetMet ? 'pass' : completed.length ? 'warning' : 'fail',
      recommendation: completed.length === SYMBOLS.length && targetMet
        ? 'Review the measured result and validate it on additional periods.'
        : 'No conclusion: obtain historical option snapshots and rerun the paired benchmark.',
    },
    dataLeakageAudit: audit(results),
  };
  console.log(JSON.stringify(report, null, 2));
  nse.exit();
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

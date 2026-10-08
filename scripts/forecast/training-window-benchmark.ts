import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import type { HistoricalApi } from '../../src/nse/api/historical-api.js';
import {
  configureForecastTrainingWindowForBenchmark,
  ForecastApi,
} from '../../src/forecast/forecast-api.js';
import {
  scoreForecastReturns,
  type ForecastReturnScore,
} from '../../src/forecast/evaluation.js';
import { addCalendarMonths } from '../../src/forecast/walk-forward.js';
import { movingBlockBootstrap } from './analyze-fno-generalization.js';

const symbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

const trainingWindows = [8, 14, 20] as const;
const commonTestAnchorMonths = 20;
const stepMonths = 6;
const horizons = [1, 5] as const;
const bootstrapReplicates = 2000;
const bootstrapBlockSessions = 20;
const requestTimeoutMs = 60_000;
const delayMs = 1000;
const historyMonths = Number(process.env.FORECAST_BENCHMARK_HISTORY_MONTHS ?? 60);
const resumePath = process.env.FORECAST_TRAINING_WINDOW_RESUME;
const asOfDate =
  process.env.FORECAST_TRAINING_WINDOW_AS_OF_DATE ??
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const benchmarkNow = new Date(`${asOfDate}T12:00:00+05:30`);

export type TrainingWindowMonths = (typeof trainingWindows)[number];

export interface WindowPrediction {
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  actualLogReturn: number;
}

interface WindowFold {
  horizon: number;
  testStart: string;
  testEndExclusive: string;
  candidateTrainRows: number;
  candidateTestRows: number;
  trainRows: number;
  testRows: number;
  status: 'scored' | 'skipped_insufficient_eligible_samples';
}

export interface WindowRun {
  trainMonths: TrainingWindowMonths;
  symbol: string;
  status: 'ok' | 'error';
  error?: string;
  folds: WindowFold[];
  predictions: WindowPrediction[];
}

export interface MatchedWindowPrediction {
  symbol: string;
  horizon: 1 | 5;
  originDate: string;
  targetDate: string;
  actualLogReturn: number;
  predictions: Record<TrainingWindowMonths, number>;
}

interface WindowScore extends ForecastReturnScore {
  trainMonths: TrainingWindowMonths;
  horizon: 1 | 5;
  symbols: number;
}

interface WindowUncertainty {
  horizon: 1 | 5;
  baselineTrainMonths: 14;
  candidateTrainMonths: 8 | 20;
  samples: number;
  blockSessions: number;
  directionChangePp: number;
  directionLower95Pp: number;
  directionUpper95Pp: number;
  mapeChangePp: number;
  mapeLower95Pp: number;
  mapeUpper95Pp: number;
}

interface WindowCoverage {
  symbol: string;
  trainMonths: TrainingWindowMonths;
  horizon: 1 | 5;
  foldCount: number;
  scoredFolds: number;
  skippedFolds: number;
  candidateTestRows: number;
  eligibleTestRows: number;
  predictedRows: number;
  eligibleCoveragePct: number;
}

function predictionKey(prediction: WindowPrediction): string {
  return `${prediction.horizon}\u0000${prediction.originDate}\u0000${prediction.targetDate}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePrediction(value: unknown): WindowPrediction {
  if (
    !isRecord(value) ||
    typeof value.horizon !== 'number' ||
    typeof value.originDate !== 'string' ||
    typeof value.targetDate !== 'string' ||
    typeof value.predictedLogReturn !== 'number' ||
    !Number.isFinite(value.predictedLogReturn) ||
    typeof value.actualLogReturn !== 'number' ||
    !Number.isFinite(value.actualLogReturn)
  )
    throw new Error('The resume file contains an invalid prediction.');
  return {
    horizon: value.horizon,
    originDate: value.originDate,
    targetDate: value.targetDate,
    predictedLogReturn: value.predictedLogReturn,
    actualLogReturn: value.actualLogReturn,
  };
}

function parseFold(value: unknown): WindowFold {
  if (
    !isRecord(value) ||
    typeof value.horizon !== 'number' ||
    typeof value.testStart !== 'string' ||
    typeof value.testEndExclusive !== 'string' ||
    !Number.isInteger(value.candidateTrainRows) ||
    !Number.isInteger(value.candidateTestRows) ||
    !Number.isInteger(value.trainRows) ||
    !Number.isInteger(value.testRows) ||
    (value.status !== 'scored' &&
      value.status !== 'skipped_insufficient_eligible_samples')
  )
    throw new Error('The resume file contains invalid fold metadata.');
  return {
    horizon: value.horizon,
    testStart: value.testStart,
    testEndExclusive: value.testEndExclusive,
    candidateTrainRows: value.candidateTrainRows,
    candidateTestRows: value.candidateTestRows,
    trainRows: value.trainRows,
    testRows: value.testRows,
    status: value.status,
  };
}

function parseRun(value: unknown): WindowRun {
  if (
    !isRecord(value) ||
    (value.trainMonths !== 8 &&
      value.trainMonths !== 14 &&
      value.trainMonths !== 20) ||
    typeof value.symbol !== 'string' ||
    !symbols.some((symbol) => symbol === value.symbol) ||
    (value.status !== 'ok' && value.status !== 'error') ||
    !Array.isArray(value.folds) ||
    !Array.isArray(value.predictions) ||
    (value.error !== undefined && typeof value.error !== 'string')
  )
    throw new Error('The resume file contains an invalid training-window run.');
  const run: WindowRun = {
    trainMonths: value.trainMonths,
    symbol: value.symbol,
    status: value.status,
    folds: value.folds.map(parseFold),
    predictions: value.predictions.map(parsePrediction),
  };
  if (typeof value.error === 'string') run.error = value.error;
  if (run.status === 'ok' && !run.predictions.length)
    throw new Error('A successful resume run has no predictions.');
  return run;
}

async function readSuccessfulProgress(
  path: string,
  evaluation: Record<string, unknown>,
  expectedFirstTestStart: string
): Promise<WindowRun[]> {
  if (!existsSync(path)) throw new Error(`Resume file not found: ${path}`);
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  const priorEvaluation = { ...evaluation };
  delete priorEvaluation.asOfDate;
  if (
    !isRecord(parsed) ||
    parsed.schemaVersion !== 1 ||
    parsed.status !== 'running' ||
    (JSON.stringify(parsed.evaluation) !== JSON.stringify(evaluation) &&
      JSON.stringify(parsed.evaluation) !== JSON.stringify(priorEvaluation)) ||
    !Array.isArray(parsed.runs)
  )
    throw new Error(
      'Resume file does not match the current training-window benchmark configuration.'
    );
  const reusable = parsed.runs.filter((value) => {
    if (!isRecord(value) || value.status !== 'ok' || !Array.isArray(value.folds))
      return false;
    const firstTestStart = value.folds
      .filter(
        (fold) =>
          isRecord(fold) &&
          fold.horizon === 1 &&
          typeof fold.testStart === 'string'
      )
      .map((fold) => (fold as Record<string, unknown>).testStart as string)
      .sort()[0];
    if (firstTestStart === expectedFirstTestStart) return true;
    console.warn(
      `Not resuming ${String(value.symbol)}/${String(value.trainMonths)}-month run: as-of test dates differ.`
    );
    return false;
  });
  const runs = reusable.map(parseRun);
  const keys = new Set<string>();
  for (const run of runs) {
    const key = `${run.trainMonths}:${run.symbol}`;
    if (keys.has(key))
      throw new Error(`Resume file contains a duplicate completed run: ${key}.`);
    keys.add(key);
  }
  return runs;
}

export function matchTrainingWindowPredictions(
  runs: WindowRun[]
): MatchedWindowPrediction[] {
  if (!runs.length) throw new Error('No training-window runs were provided.');
  const matched: MatchedWindowPrediction[] = [];
  const runSymbols = [...new Set(runs.map((run) => run.symbol))].sort();

  for (const symbol of runSymbols) {
    const symbolRuns = new Map<TrainingWindowMonths, WindowRun>();
    for (const trainMonths of trainingWindows) {
      const matches = runs.filter(
        (run) => run.symbol === symbol && run.trainMonths === trainMonths
      );
      if (matches.length !== 1)
        throw new Error(
          `${symbol}: expected exactly one run for the ${trainMonths}-month window.`
        );
      const run = matches[0];
      if (run.status !== 'ok')
        throw new Error(
          `${symbol}/${trainMonths}-month run failed: ${run.error ?? 'unknown error'}.`
        );
      symbolRuns.set(trainMonths, run);
    }

    const predictionMaps = new Map<
      TrainingWindowMonths,
      Map<string, WindowPrediction>
    >();
    for (const trainMonths of trainingWindows) {
      const predictions = new Map<string, WindowPrediction>();
      for (const prediction of symbolRuns.get(trainMonths)!.predictions) {
        if (prediction.horizon !== 1 && prediction.horizon !== 5) continue;
        const key = predictionKey(prediction);
        if (predictions.has(key))
          throw new Error(
            `${symbol}/${trainMonths}-month run contains a duplicate prediction at ${prediction.originDate}.`
          );
        predictions.set(key, prediction);
      }
      predictionMaps.set(trainMonths, predictions);
    }

    const baseline = predictionMaps.get(14)!;
    if (!baseline.size)
      throw new Error(`${symbol}: the 14-month run has no scored predictions.`);

    const baselineFoldWindows = symbolRuns.get(14)!.folds
      .map(({ horizon, testStart, testEndExclusive }) => ({
        horizon,
        testStart,
        testEndExclusive,
      }))
      .sort((left, right) =>
        left.horizon - right.horizon ||
        left.testStart.localeCompare(right.testStart)
      );
    for (const trainMonths of [8, 20] as const) {
      const candidateFoldWindows = symbolRuns.get(trainMonths)!.folds
        .map(({ horizon, testStart, testEndExclusive }) => ({
          horizon,
          testStart,
          testEndExclusive,
        }))
        .sort((left, right) =>
          left.horizon - right.horizon ||
          left.testStart.localeCompare(right.testStart)
        );
      if (
        JSON.stringify(candidateFoldWindows) !==
        JSON.stringify(baselineFoldWindows)
      )
        throw new Error(
          `${symbol}: fold test windows differ for ${trainMonths} and 14 months.`
        );
    }

    const commonKeys = new Set(baseline.keys());
    for (const trainMonths of [8, 20] as const) {
      const candidate = predictionMaps.get(trainMonths)!;
      for (const key of commonKeys)
        if (!candidate.has(key)) commonKeys.delete(key);
    }
    if (!commonKeys.size)
      throw new Error(`${symbol}: no forecasts are shared across all training windows.`);

    for (const key of commonKeys) {
      const baselinePrediction = baseline.get(key)!;
      const prediction8 = predictionMaps.get(8)!.get(key)!;
      const prediction20 = predictionMaps.get(20)!.get(key)!;
      if (baselinePrediction.horizon !== 1 && baselinePrediction.horizon !== 5)
        throw new Error('A matched prediction has an unsupported horizon.');
      if (
        Math.abs(prediction8.actualLogReturn - baselinePrediction.actualLogReturn) >
          1e-12 ||
        Math.abs(prediction20.actualLogReturn - baselinePrediction.actualLogReturn) >
          1e-12
      )
        throw new Error(
          `${symbol}: actual returns disagree across training windows at ${baselinePrediction.originDate}.`
        );
      matched.push({
        symbol,
        horizon: baselinePrediction.horizon,
        originDate: baselinePrediction.originDate,
        targetDate: baselinePrediction.targetDate,
        actualLogReturn: baselinePrediction.actualLogReturn,
        predictions: {
          8: prediction8.predictedLogReturn,
          14: baselinePrediction.predictedLogReturn,
          20: prediction20.predictedLogReturn,
        },
      });
    }
  }
  return matched.sort((left, right) =>
    left.originDate.localeCompare(right.originDate) ||
    left.symbol.localeCompare(right.symbol) ||
    left.horizon - right.horizon
  );
}

function summarizeWindows(
  matched: MatchedWindowPrediction[],
  runs: WindowRun[]
): {
  summary: WindowScore[];
  uncertainty: WindowUncertainty[];
  bySymbol: (WindowScore & { symbol: string })[];
  coverage: WindowCoverage[];
} {
  const summary: WindowScore[] = [];
  const uncertainty: WindowUncertainty[] = [];
  const bySymbol: (WindowScore & { symbol: string })[] = [];
  const coverage: WindowCoverage[] = [];

  for (const trainMonths of trainingWindows) {
    for (const horizon of horizons) {
      for (const run of runs.filter((item) => item.trainMonths === trainMonths)) {
        const folds = run.folds.filter((fold) => fold.horizon === horizon);
        const predictions = run.predictions.filter(
          (prediction) => prediction.horizon === horizon
        );
        const eligibleTestRows = folds.reduce((sum, fold) => sum + fold.testRows, 0);
        const scoredRows = folds
          .filter((fold) => fold.status === 'scored')
          .reduce((sum, fold) => sum + fold.testRows, 0);
        if (predictions.length !== scoredRows)
          throw new Error(
            `${run.symbol}/${trainMonths}-month/${horizon}-session coverage metadata does not match its predictions.`
          );
        coverage.push({
          symbol: run.symbol,
          trainMonths,
          horizon,
          foldCount: folds.length,
          scoredFolds: folds.filter((fold) => fold.status === 'scored').length,
          skippedFolds: folds.filter(
            (fold) => fold.status === 'skipped_insufficient_eligible_samples'
          ).length,
          candidateTestRows: folds.reduce(
            (sum, fold) => sum + fold.candidateTestRows,
            0
          ),
          eligibleTestRows,
          predictedRows: predictions.length,
          eligibleCoveragePct: eligibleTestRows
            ? (100 * predictions.length) / eligibleTestRows
            : 0,
        });
      }
    }
  }

  for (const horizon of horizons) {
    const horizonRows = matched.filter((row) => row.horizon === horizon);
    if (!horizonRows.length)
      throw new Error(`No matched forecasts for the ${horizon}-session horizon.`);
    for (const trainMonths of trainingWindows) {
      const score = (rows: MatchedWindowPrediction[]): WindowScore => ({
        trainMonths,
        horizon,
        symbols: new Set(rows.map((row) => row.symbol)).size,
        ...scoreForecastReturns(rows.map((row) => ({
          predictedLogReturn: row.predictions[trainMonths],
          actualLogReturn: row.actualLogReturn,
        }))),
      });
      summary.push(score(horizonRows));
      for (const symbol of [...new Set(horizonRows.map((row) => row.symbol))].sort())
        bySymbol.push({
          symbol,
          ...score(horizonRows.filter((row) => row.symbol === symbol)),
        });
    }

    for (const candidateTrainMonths of [8, 20] as const) {
      const paired = horizonRows.map((row) => ({
        originDate: row.originDate,
        actualLogReturn: row.actualLogReturn,
        baselineLogReturn: row.predictions[14],
        candidateLogReturn: row.predictions[candidateTrainMonths],
      }));
      uncertainty.push({
        horizon,
        baselineTrainMonths: 14,
        candidateTrainMonths,
        ...movingBlockBootstrap(
          paired,
          `training-window-${candidateTrainMonths}-vs-14-${horizon}`,
          bootstrapReplicates,
          bootstrapBlockSessions
        ),
      });
    }
  }
  return { summary, uncertainty, bySymbol, coverage };
}

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv<T extends object>(
  rows: T[],
  columns: (keyof T & string)[]
): string {
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvValue(row[column])).join(',')
    ),
  ].join('\r\n') + '\r\n';
}

async function runBenchmark() {
  if (!Number.isInteger(historyMonths) || historyMonths < 36 || historyMonths > 120)
    throw new Error('Benchmark history must be a whole number from 36 to 120 months.');
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) ||
    Number.isNaN(benchmarkNow.getTime()) ||
    benchmarkNow.toISOString().slice(0, 10) !== asOfDate
  )
    throw new Error(
      'FORECAST_TRAINING_WINDOW_AS_OF_DATE must be a valid YYYY-MM-DD date.'
    );
  if (new Set(symbols).size !== symbols.length)
    throw new Error('Benchmark symbols must be unique.');

  const outputDirectory = resolve(
    process.env.FORECAST_TRAINING_WINDOW_RESULTS_DIR ??
      'results/forecast-training-windows'
  );
  await mkdir(outputDirectory, { recursive: true });
  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputPath = resumePath
    ? resolve(resumePath)
    : join(outputDirectory, `training-window-benchmark-${runId}.json`);
  const nse = new NSEClient(join(outputDirectory, 'nse-downloads'), {
    server: false,
    timeout: requestTimeoutMs,
  });
  const historyCache = new Map<
    string,
    ReturnType<HistoricalApi['fetchEquityHistoricalData']>
  >();
  const historical = new Proxy(nse.historical, {
    get(target, property) {
      if (property !== 'fetchEquityHistoricalData') {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      return (
        params: Parameters<HistoricalApi['fetchEquityHistoricalData']>[0]
      ) => {
        const key = [
          params.symbol,
          params.series?.join(',') ?? '',
          params.from_date?.toISOString() ?? '',
          params.to_date?.toISOString() ?? '',
        ].join('|');
        let pending = historyCache.get(key);
        if (!pending) {
          pending = target.fetchEquityHistoricalData(params).catch((error: unknown) => {
            historyCache.delete(key);
            throw error;
          });
          historyCache.set(key, pending);
        }
        return pending;
      };
    },
  });
  const actionCache = new Map<
    string,
    ReturnType<typeof nse.corporate.getActions>
  >();
  const fetchCorporateActions = (symbol: string, from: string, to: string) => {
    const key = `${symbol}|${from}|${to}`;
    let pending = actionCache.get(key);
    if (!pending) {
      pending = nse.corporate.getActions({
        symbol,
        from_date: new Date(`${from}T12:00:00`),
        to_date: new Date(`${to}T12:00:00`),
      }).catch((error: unknown) => {
        actionCache.delete(key);
        throw error;
      });
      actionCache.set(key, pending);
    }
    return pending;
  };
  const apis = new Map(trainingWindows.map((trainMonths) => {
    const api = new ForecastApi(
      historical,
      () => benchmarkNow,
      undefined,
      {},
      stepMonths,
      fetchCorporateActions
    );
    configureForecastTrainingWindowForBenchmark(api, trainMonths);
    return [trainMonths, api] as const;
  }));
  const runs: WindowRun[] = [];
  const expectedFirstTestStart = addCalendarMonths(
    addCalendarMonths(asOfDate, -historyMonths),
    commonTestAnchorMonths
  );
  const evaluation = {
    asOfDate,
    symbols: [...symbols],
    horizons: [...horizons],
    historyMonths,
    trainingWindowsMonths: [...trainingWindows],
    commonTestAnchorMonths,
    testMonths: 3,
    stepMonths,
    model: 'technical',
    context: 'off',
    matching: 'shared symbol, horizon, origin, target, actual return, and identical test-fold boundaries',
    bootstrap: {
      method: 'paired moving block by forecast-origin session',
      blockSessions: bootstrapBlockSessions,
      replicates: bootstrapReplicates,
    },
  };
  if (resumePath)
    runs.push(
      ...await readSuccessfulProgress(
        outputPath,
        evaluation,
        expectedFirstTestStart
      )
    );
  const completedRuns = new Set(
    runs.map((run) => `${run.trainMonths}:${run.symbol}`)
  );
  const saveProgress = () =>
    writeFile(outputPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      status: 'running',
      evaluation,
      runs,
    }, null, 2));

  console.log(
    `Comparing ${trainingWindows.join('/')} month training windows on ${symbols.length} symbols; test windows are anchored to the same 20-month history point.`
  );
  console.log(`Partial progress and final predictions: ${outputPath}`);
  for (const trainMonths of trainingWindows) {
    const api = apis.get(trainMonths)!;
    for (const symbol of symbols) {
      const runKey = `${trainMonths}:${symbol}`;
      if (completedRuns.has(runKey)) {
        console.log(`${symbol} (${trainMonths} months): resumed; skipping.`);
        continue;
      }
      try {
        const forecast = await withRetry(
          () =>
            api.forecastStock({
              symbol,
              horizon: 'week',
              historyMonths,
              model: 'technical',
              context: 'off',
              sentiment: 'off',
            }),
          `${symbol}/${trainMonths}-month`
        );
        const training = forecast.model.training;
        if (!training)
          throw new Error('Technical forecast did not include walk-forward data.');
        if (forecast.history.dataQuality.corporateActionAdjustment !== 'applied')
          throw new Error('Corporate-action adjustments were not applied.');
        const predictions = training.outOfSampleForecasts
          .filter((item) => item.horizon === 1 || item.horizon === 5)
          .map(({ horizon, originDate, targetDate, predictedLogReturn, actualLogReturn }) => ({
            horizon,
            originDate,
            targetDate,
            predictedLogReturn,
            actualLogReturn,
          }));
        runs.push({
          trainMonths,
          symbol,
          status: 'ok',
          folds: training.folds.map(({
            horizon,
            testStart,
            testEndExclusive,
            candidateTrainRows,
            candidateTestRows,
            trainRows,
            testRows,
            status,
          }) => ({
            horizon,
            testStart,
            testEndExclusive,
            candidateTrainRows,
            candidateTestRows,
            trainRows,
            testRows,
            status,
          })),
          predictions,
        });
        completedRuns.add(runKey);
        console.log(
          `${symbol} (${trainMonths} months): captured ${predictions.length} forecasts.`
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown training-window error.';
        runs.push({
          trainMonths,
          symbol,
          status: 'error',
          error: message,
          folds: [],
          predictions: [],
        });
        console.error(`${symbol} (${trainMonths} months): ${message}`);
      }
      await saveProgress();
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    async function withRetry<T>(
      operation: () => Promise<T>,
      label: string
    ): Promise<T> {
      let lastError: unknown;
      for (let attempt = 0; attempt <= 2; attempt++) {
        try {
          return await operation();
        } catch (error) {
          lastError = error;
          if (attempt === 2) break;
          const retryDelay = 1000 * 2 ** attempt;
          console.warn(
            `${label} failed (attempt ${attempt + 1}/3); retrying in ${retryDelay}ms.`
          );
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    }
  }

  const failures = runs.filter((run) => run.status !== 'ok');
  if (failures.length)
    throw new Error(
      `${failures.length} training-window runs failed; inspect partial output at ${outputPath}.`
    );
  if (
    runs.length !== symbols.length * trainingWindows.length ||
    runs.some((run) => run.predictions.length === 0)
  )
    throw new Error(`Expected ${symbols.length * trainingWindows.length} complete runs.`);

  const matched = matchTrainingWindowPredictions(runs);
  if (new Set(matched.map((row) => row.symbol)).size !== symbols.length)
    throw new Error('Matched results do not contain every benchmark symbol.');
  const metrics = summarizeWindows(matched, runs);
  await writeFile(outputPath, JSON.stringify({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    status: 'complete',
    evaluation,
    summary: metrics.summary,
    uncertainty: metrics.uncertainty,
    bySymbol: metrics.bySymbol,
    coverage: metrics.coverage,
    matchedPredictions: matched,
    runs,
  }, null, 2));
  await writeFile(
    join(outputDirectory, `summary-${runId}.csv`),
    csv(metrics.summary, [
      'trainMonths', 'horizon', 'symbols', 'samples',
      'meanAbsolutePercentageError', 'naiveMeanAbsolutePercentageError',
      'directionalAccuracyPct', 'beatsNaive',
    ])
  );
  await writeFile(
    join(outputDirectory, `uncertainty-${runId}.csv`),
    csv(metrics.uncertainty, [
      'horizon', 'baselineTrainMonths', 'candidateTrainMonths', 'samples',
      'blockSessions', 'directionChangePp', 'directionLower95Pp',
      'directionUpper95Pp', 'mapeChangePp', 'mapeLower95Pp',
      'mapeUpper95Pp',
    ])
  );
  await writeFile(
    join(outputDirectory, `by-symbol-${runId}.csv`),
    csv(metrics.bySymbol, [
      'symbol', 'trainMonths', 'horizon', 'samples',
      'meanAbsolutePercentageError', 'naiveMeanAbsolutePercentageError',
      'directionalAccuracyPct', 'beatsNaive',
    ])
  );
  await writeFile(
    join(outputDirectory, `coverage-${runId}.csv`),
    csv(metrics.coverage, [
      'symbol', 'trainMonths', 'horizon', 'foldCount', 'scoredFolds',
      'skippedFolds', 'candidateTestRows', 'eligibleTestRows', 'predictedRows',
      'eligibleCoveragePct',
    ])
  );
  for (const row of metrics.summary)
    console.log(
      `${row.trainMonths}-month train, ${row.horizon}-session horizon: ` +
      `${row.samples} matched forecasts; MAPE ${row.meanAbsolutePercentageError.toFixed(4)}%; ` +
      `no-change ${row.naiveMeanAbsolutePercentageError.toFixed(4)}%; ` +
      `direction ${row.directionalAccuracyPct.toFixed(2)}%.`
    );
  for (const row of metrics.uncertainty)
    console.log(
      `${row.candidateTrainMonths} vs 14 months, ${row.horizon}-session horizon: ` +
      `direction delta ${row.directionChangePp.toFixed(2)} pp ` +
      `[${row.directionLower95Pp.toFixed(2)}, ${row.directionUpper95Pp.toFixed(2)}]; ` +
      `MAPE delta ${row.mapeChangePp.toFixed(4)} pp ` +
      `[${row.mapeLower95Pp.toFixed(4)}, ${row.mapeUpper95Pp.toFixed(4)}].`
    );
  console.log(`Complete results: ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runBenchmark().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Training-window benchmark failed.'
    );
    process.exitCode = 1;
  });

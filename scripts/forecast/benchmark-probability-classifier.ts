import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  configureForecastProbabilityEventsForBenchmark,
  ForecastApi,
  type HistoricalDataQuality,
} from '../../src/forecast/forecast-api.js';
import {
  forecastEvents,
  priorEventProbability,
  scoreBinaryProbabilities,
  type DatedForecastOutcome,
  type ForecastEvent,
} from '../../src/forecast/target-outcomes.js';
import { probabilityBenchmarkSymbols as symbols } from './probability-prospective-common.js';

const horizons = [
  { name: 'next_day', sessions: 1 },
  { name: 'week', sessions: 5 },
] as const;
const blockSessions = 20;
const bootstrapReplicates = 2000;

type HorizonName = (typeof horizons)[number]['name'];

interface ProbabilityPrediction {
  symbol: string;
  horizon: number;
  event: ForecastEvent;
  originDate: string;
  targetDate: string;
  actualLogReturn: number;
  occurred: boolean;
  probability: number;
  fold: number;
  testStart: string;
  testEndExclusive: string;
  priorProbability?: number;
}

interface SymbolResult {
  symbol: string;
  status: 'ok' | 'error';
  error?: string;
  history?: {
    dataQuality: HistoricalDataQuality;
    requestedMonths: number;
  };
  predictions: ProbabilityPrediction[];
}

interface MetricRow {
  horizon: HorizonName;
  event: ForecastEvent;
  fold?: number;
  testStart?: string;
  testEndExclusive?: string;
  symbols: number;
  samples: number;
  eventCount: number;
  observedRatePct: number;
  classifierBrierScore: number;
  classifierLogLoss: number;
  priorBrierScore: number;
  priorLogLoss: number;
  neutralBrierScore: number;
  neutralLogLoss: number;
}

interface BootstrapSummary {
  horizon: HorizonName;
  event: ForecastEvent;
  samples: number;
  blockSessions: number;
  replicates: number;
  classifierMinusPriorBrier: number;
  classifierMinusPriorBrierLower95: number;
  classifierMinusPriorBrierUpper95: number;
  classifierMinusPriorLogLoss: number;
  classifierMinusPriorLogLossLower95: number;
  classifierMinusPriorLogLossUpper95: number;
  classifierMinusNeutralBrier: number;
  classifierMinusNeutralBrierLower95: number;
  classifierMinusNeutralBrierUpper95: number;
  classifierMinusNeutralLogLoss: number;
  classifierMinusNeutralLogLossLower95: number;
  classifierMinusNeutralLogLossUpper95: number;
}

const outputRoot = resolve(
  process.env.FORECAST_PROBABILITY_RESULTS_DIR ??
    'results/forecast-probability-classifier'
);
const historyMonths = Number(process.env.FORECAST_BENCHMARK_HISTORY_MONTHS ?? 60);

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv<T extends object>(rows: T[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((row) => {
      const values = new Map(Object.entries(row));
      return columns.map((column) => csvValue(values.get(column))).join(',');
    }),
  ].join('\r\n') + '\r\n';
}

function groupedScore(
  rows: ProbabilityPrediction[],
  horizon: HorizonName,
  event: ForecastEvent,
  fold?: number
): MetricRow {
  const selected = rows.filter(
    (row) =>
      row.horizon === (horizon === 'next_day' ? 1 : 5) &&
      row.event === event &&
      (fold === undefined || row.fold === fold)
  );
  if (!selected.length)
    throw new Error(`No probability predictions found for ${horizon} ${event}.`);
  if (selected.some((row) => row.priorProbability === undefined))
    throw new Error(`Missing causal prior probability for ${horizon} ${event}.`);
  const classifier = scoreBinaryProbabilities(selected.map((row) => ({
    probability: row.probability,
    occurred: row.occurred,
  })));
  const prior = scoreBinaryProbabilities(selected.map((row) => ({
    probability: row.priorProbability!,
    occurred: row.occurred,
  })));
  const neutral = scoreBinaryProbabilities(selected.map((row) => ({
    probability: 0.5,
    occurred: row.occurred,
  })));
  return {
    horizon,
    event,
    ...(fold === undefined
      ? {}
      : {
          fold,
          testStart: selected[0].testStart,
          testEndExclusive: selected[0].testEndExclusive,
        }),
    symbols: new Set(selected.map((row) => row.symbol)).size,
    samples: classifier.samples,
    eventCount: Math.round(classifier.observedRatePct * classifier.samples / 100),
    observedRatePct: classifier.observedRatePct,
    classifierBrierScore: classifier.brierScore,
    classifierLogLoss: classifier.logLoss,
    priorBrierScore: prior.brierScore,
    priorLogLoss: prior.logLoss,
    neutralBrierScore: neutral.brierScore,
    neutralLogLoss: neutral.logLoss,
  };
}

function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (const character of seedText) {
    seed ^= character.charCodeAt(0);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed += 0x6d2b79f5;
    let value = seed;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.floor((sorted.length - 1) * quantile)];
}

function clippedProbability(value: number): number {
  return Math.min(1 - 1e-15, Math.max(1e-15, value));
}

function logLoss(probability: number, occurred: boolean): number {
  const clipped = clippedProbability(probability);
  return occurred ? -Math.log(clipped) : -Math.log(1 - clipped);
}

export function bootstrapProbabilityDifferences(
  rows: ProbabilityPrediction[],
  seedText: string,
  replicates = bootstrapReplicates,
  requestedBlockSessions = blockSessions
): Omit<
  BootstrapSummary,
  'horizon' | 'event' | 'samples' | 'blockSessions' | 'replicates'
> {
  if (!rows.length || !Number.isInteger(replicates) || replicates < 100)
    throw new Error('Bootstrap needs paired rows and at least 100 replicates.');
  if (!Number.isInteger(requestedBlockSessions) || requestedBlockSessions < 1)
    throw new Error('Bootstrap block length must be a positive session count.');
  if (rows.some((row) => row.priorProbability === undefined))
    throw new Error('Bootstrap rows need paired causal-prior predictions.');

  const byFold = new Map<string, Map<string, ProbabilityPrediction[]>>();
  for (const row of rows) {
    const foldKey = `${row.fold}:${row.testStart}`;
    const byDate = byFold.get(foldKey) ?? new Map<string, ProbabilityPrediction[]>();
    const dateRows = byDate.get(row.originDate) ?? [];
    dateRows.push(row);
    byDate.set(row.originDate, dateRows);
    byFold.set(foldKey, byDate);
  }
  const folds = [...byFold.values()].map((byDate) => {
    const dates = [...byDate.keys()].sort();
    return {
      dates,
      byDate,
      blockSessions: Math.min(requestedBlockSessions, dates.length),
    };
  });
  const random = seededRandom(seedText);
  const deltas: Record<
    'classifierMinusPriorBrier' |
    'classifierMinusPriorLogLoss' |
    'classifierMinusNeutralBrier' |
    'classifierMinusNeutralLogLoss',
    number[]
  > = {
    classifierMinusPriorBrier: [],
    classifierMinusPriorLogLoss: [],
    classifierMinusNeutralBrier: [],
    classifierMinusNeutralLogLoss: [],
  };

  for (let replicate = 0; replicate < replicates; replicate++) {
    let samples = 0;
    let classifierBrier = 0;
    let priorBrier = 0;
    let neutralBrier = 0;
    let classifierLogLoss = 0;
    let priorLogLoss = 0;
    let neutralLogLoss = 0;
    for (const fold of folds) {
      const weights = new Map<string, number>();
      let sampledDates = 0;
      while (sampledDates < fold.dates.length) {
        const maxStart = Math.max(0, fold.dates.length - fold.blockSessions);
        const start = Math.floor(random() * (maxStart + 1));
        for (const date of fold.dates.slice(start, start + fold.blockSessions)) {
          if (sampledDates >= fold.dates.length) break;
          weights.set(date, (weights.get(date) ?? 0) + 1);
          sampledDates++;
        }
      }
      for (const [date, multiplicity] of weights) {
        for (const row of fold.byDate.get(date)!) {
          const actual = Number(row.occurred);
          const classifierError = row.probability - actual;
          const priorError = row.priorProbability! - actual;
          const neutralError = 0.5 - actual;
          samples += multiplicity;
          classifierBrier += multiplicity * classifierError ** 2;
          priorBrier += multiplicity * priorError ** 2;
          neutralBrier += multiplicity * neutralError ** 2;
          classifierLogLoss += multiplicity * logLoss(row.probability, row.occurred);
          priorLogLoss += multiplicity * logLoss(row.priorProbability!, row.occurred);
          neutralLogLoss += multiplicity * logLoss(0.5, row.occurred);
        }
      }
    }
    deltas.classifierMinusPriorBrier.push(
      (classifierBrier - priorBrier) / samples
    );
    deltas.classifierMinusPriorLogLoss.push(
      (classifierLogLoss - priorLogLoss) / samples
    );
    deltas.classifierMinusNeutralBrier.push(
      (classifierBrier - neutralBrier) / samples
    );
    deltas.classifierMinusNeutralLogLoss.push(
      (classifierLogLoss - neutralLogLoss) / samples
    );
  }

  const bounds = (values: number[]) => {
    values.sort((left, right) => left - right);
    return {
      lower: percentile(values, 0.025),
      upper: percentile(values, 0.975),
    };
  };
  const priorBrierBounds = bounds(deltas.classifierMinusPriorBrier);
  const priorLogLossBounds = bounds(deltas.classifierMinusPriorLogLoss);
  const neutralBrierBounds = bounds(deltas.classifierMinusNeutralBrier);
  const neutralLogLossBounds = bounds(deltas.classifierMinusNeutralLogLoss);
  const pointDeltas = rows.reduce(
    (total, row) => {
      const actual = Number(row.occurred);
      const classifierError = row.probability - actual;
      const priorError = row.priorProbability! - actual;
      const neutralError = 0.5 - actual;
      total.classifierMinusPriorBrier +=
        classifierError ** 2 - priorError ** 2;
      total.classifierMinusPriorLogLoss +=
        logLoss(row.probability, row.occurred) -
        logLoss(row.priorProbability!, row.occurred);
      total.classifierMinusNeutralBrier +=
        classifierError ** 2 - neutralError ** 2;
      total.classifierMinusNeutralLogLoss +=
        logLoss(row.probability, row.occurred) - logLoss(0.5, row.occurred);
      return total;
    },
    {
      classifierMinusPriorBrier: 0,
      classifierMinusPriorLogLoss: 0,
      classifierMinusNeutralBrier: 0,
      classifierMinusNeutralLogLoss: 0,
    }
  );
  return {
    classifierMinusPriorBrier: pointDeltas.classifierMinusPriorBrier / rows.length,
    classifierMinusPriorLogLoss: pointDeltas.classifierMinusPriorLogLoss / rows.length,
    classifierMinusNeutralBrier: pointDeltas.classifierMinusNeutralBrier / rows.length,
    classifierMinusNeutralLogLoss: pointDeltas.classifierMinusNeutralLogLoss / rows.length,
    classifierMinusPriorBrierLower95: priorBrierBounds.lower,
    classifierMinusPriorBrierUpper95: priorBrierBounds.upper,
    classifierMinusPriorLogLossLower95: priorLogLossBounds.lower,
    classifierMinusPriorLogLossUpper95: priorLogLossBounds.upper,
    classifierMinusNeutralBrierLower95: neutralBrierBounds.lower,
    classifierMinusNeutralBrierUpper95: neutralBrierBounds.upper,
    classifierMinusNeutralLogLossLower95: neutralLogLossBounds.lower,
    classifierMinusNeutralLogLossUpper95: neutralLogLossBounds.upper,
  };
}

function aggregate(
  rows: ProbabilityPrediction[],
  horizon: HorizonName,
  event: ForecastEvent
) {
  const result = groupedScore(rows, horizon, event);
  return {
    ...result,
    classifierMinusPriorBrier:
      result.classifierBrierScore - result.priorBrierScore,
    classifierMinusPriorLogLoss:
      result.classifierLogLoss - result.priorLogLoss,
    classifierMinusNeutralBrier:
      result.classifierBrierScore - result.neutralBrierScore,
    classifierMinusNeutralLogLoss:
      result.classifierLogLoss - result.neutralLogLoss,
  };
}

function calibrationRows(
  rows: ProbabilityPrediction[],
  horizon: HorizonName,
  event: ForecastEvent
) {
  const selected = rows.filter(
    (row) =>
      row.horizon === (horizon === 'next_day' ? 1 : 5) &&
      row.event === event
  );
  return Array.from({ length: 10 }, (_, index) => {
    const bin = selected.filter((row) =>
      Math.min(9, Math.floor(row.probability * 10)) === index
    );
    return {
      horizon,
      event,
      probabilityBin: index,
      binStartInclusive: index / 10,
      binEndExclusive: (index + 1) / 10,
      samples: bin.length,
      meanPredictedProbability: bin.length
        ? bin.reduce((sum, row) => sum + row.probability, 0) / bin.length
        : undefined,
      observedRatePct: bin.length
        ? bin.filter((row) => row.occurred).length / bin.length * 100
        : undefined,
    };
  });
}

function summarize(rows: ProbabilityPrediction[]) {
  const summary: ReturnType<typeof aggregate>[] = [];
  const folds: MetricRow[] = [];
  const calibration: ReturnType<typeof calibrationRows> = [];
  const uncertainty: BootstrapSummary[] = [];

  for (const { name, sessions } of horizons) {
    for (const event of forecastEvents) {
      const selected = rows.filter(
        (row) => row.horizon === sessions && row.event === event
      );
      if (!selected.length) continue;
      const outcomes: DatedForecastOutcome[] = selected.map((row) => ({
        horizon: sessions,
        targetDate: row.targetDate,
        actualLogReturn: row.actualLogReturn,
      }));
      for (const row of selected) {
        row.priorProbability = priorEventProbability(
          outcomes,
          sessions,
          row.testStart,
          event
        ).probability;
      }
      summary.push(aggregate(rows, name, event));
      const foldGroups = new Map<number, ProbabilityPrediction[]>();
      for (const row of selected) {
        const group = foldGroups.get(row.fold) ?? [];
        group.push(row);
        foldGroups.set(row.fold, group);
      }
      for (const [fold, group] of foldGroups)
        folds.push(groupedScore(group, name, event, fold));
      calibration.push(...calibrationRows(rows, name, event));
      const bootstrap = bootstrapProbabilityDifferences(
        selected,
        `${name}:${event}:logistic-vs-prior`,
        bootstrapReplicates,
        blockSessions
      );
      const dateCount = new Set(selected.map((row) => row.originDate)).size;
      uncertainty.push({
        horizon: name,
        event,
        samples: selected.length,
        blockSessions: Math.min(blockSessions, dateCount),
        replicates: bootstrapReplicates,
        ...bootstrap,
      });
    }
  }
  return { summary, folds, calibration, uncertainty };
}

async function runBenchmark() {
  if (new Set(symbols).size !== symbols.length)
    throw new Error('Probability benchmark symbols must be unique.');
  if (!Number.isInteger(historyMonths) || historyMonths < 36 || historyMonths > 120)
    throw new Error('Benchmark history must be a whole number from 36 to 120 months.');

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const outputDirectory = join(outputRoot, `current-schedule-${runId}`);
  const cacheDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ?? 'node_modules/.cache/forecast-benchmark'
  );
  await mkdir(outputDirectory, { recursive: true });
  const nse = new NSEClient(join(cacheDirectory, 'nse-downloads'), { server: true });
  const forecastApi = new ForecastApi(
    nse.historical,
    undefined,
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
  configureForecastProbabilityEventsForBenchmark(forecastApi, forecastEvents);
  const results: SymbolResult[] = [];

  const saveProgress = async () => {
    await writeFile(
      join(outputDirectory, 'progress.json'),
      JSON.stringify({
        generatedAt: new Date().toISOString(),
        schedule: 'current-schedule',
        historyMonths,
        model: 'per-symbol standardized logistic regression, L2 0.01',
        trainMonths: 14,
        testMonths: 3,
        stepMonths: 6,
        symbols: results,
      }, null, 2)
    );
  };

  for (const symbol of symbols) {
    try {
      const forecast = await forecastApi.forecastStock({
        symbol,
        horizon: 'week',
        historyMonths,
        context: 'off',
        sentiment: 'off',
        model: 'technical',
      });
      const training = forecast.model.training;
      if (!training?.outOfSampleProbabilities)
        throw new Error('Forecast returned no benchmark probability predictions.');
      const predictions: ProbabilityPrediction[] =
        training.outOfSampleProbabilities.map((prediction) => {
          if (!Number.isFinite(prediction.actualLogReturn))
            throw new Error(
              `Missing actual return for ${symbol} ${prediction.originDate} horizon ${prediction.horizon}.`
            );
          return {
            symbol,
            ...prediction,
          };
        });
      if (!predictions.length)
        throw new Error('Forecast returned an empty probability test set.');
      results.push({
        symbol,
        status: 'ok',
        history: {
          dataQuality: forecast.history.dataQuality,
          requestedMonths: forecast.history.requestedMonths,
        },
        predictions,
      });
      console.log(`${symbol}: ${predictions.length} out-of-sample probabilities`);
    } catch (error) {
      results.push({
        symbol,
        status: 'error',
        error: error instanceof Error
          ? error.message
          : 'Probability benchmark failed.',
        predictions: [],
      });
      console.error(`${symbol}: probability benchmark failed.`);
    }
    await saveProgress();
  }

  const successful = results.filter((result) => result.status === 'ok');
  const predictions = successful.flatMap((result) => result.predictions);
  if (!predictions.length)
    throw new Error('Probability benchmark produced no successful predictions.');
  const metrics = summarize(predictions);
  const completedAt = new Date().toISOString();
  await writeFile(
    join(outputDirectory, 'predictions.json'),
    JSON.stringify({
      generatedAt: completedAt,
      schedule: 'current-schedule',
      historyMonths,
      expectedSymbols: symbols.length,
      successfulSymbols: successful.length,
      failedSymbols: results
        .filter((result) => result.status === 'error')
        .map(({ symbol, error }) => ({ symbol, error })),
      model: {
        name: 'per-symbol standardized logistic regression',
        features: 'same causal close-only technical features as LightGBM technical',
        l2Penalty: 0.01,
        trainingWindowMonths: 14,
        frozenTestWindowMonths: 3,
        advanceMonths: 6,
      },
      predictions,
      ...metrics,
    }, null, 2)
  );
  await writeFile(
    join(outputDirectory, 'summary.csv'),
    csv(metrics.summary, [
      'horizon', 'event', 'symbols', 'samples', 'eventCount',
      'observedRatePct', 'classifierBrierScore', 'classifierLogLoss',
      'priorBrierScore', 'priorLogLoss', 'neutralBrierScore',
      'neutralLogLoss', 'classifierMinusPriorBrier',
      'classifierMinusPriorLogLoss', 'classifierMinusNeutralBrier',
      'classifierMinusNeutralLogLoss',
    ])
  );
  await writeFile(
    join(outputDirectory, 'by-fold.csv'),
    csv(metrics.folds, [
      'horizon', 'event', 'fold', 'testStart', 'testEndExclusive',
      'symbols', 'samples', 'eventCount', 'observedRatePct',
      'classifierBrierScore', 'classifierLogLoss', 'priorBrierScore',
      'priorLogLoss', 'neutralBrierScore', 'neutralLogLoss',
    ])
  );
  await writeFile(
    join(outputDirectory, 'calibration.csv'),
    csv(metrics.calibration, [
      'horizon', 'event', 'probabilityBin', 'binStartInclusive',
      'binEndExclusive', 'samples', 'meanPredictedProbability',
      'observedRatePct',
    ])
  );
  await writeFile(
    join(outputDirectory, 'uncertainty.csv'),
    csv(metrics.uncertainty, Object.keys(metrics.uncertainty[0] ?? {}))
  );
  await unlink(join(outputDirectory, 'progress.json'));
  if (successful.length !== symbols.length) process.exitCode = 1;
  console.log(
    `Probability benchmark completed for ${successful.length}/${symbols.length} symbols. Results: ${outputDirectory}`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runBenchmark().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Probability benchmark failed.'
    );
    process.exitCode = 1;
  });

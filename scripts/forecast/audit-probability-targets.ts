import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  forecastEventOccurred,
  forecastEvents,
  priorEventProbability,
  scoreBinaryProbabilities,
  type DatedForecastOutcome,
  type ForecastEvent,
} from '../../src/forecast/target-outcomes.js';

type HorizonName = 'next_day' | 'week';

interface Prediction {
  symbol: string;
  horizon: number;
  originDate: string;
  targetDate: string;
  actualLogReturn: number;
  fold: number;
}

interface Fold {
  testStart: string;
  testEndExclusive: string;
}

interface SymbolResult {
  symbol: string;
  status: 'ok' | 'error';
  history?: {
    dataQuality?: {
      corporateActionAdjustment?: string;
    };
  };
  folds?: Record<HorizonName, Fold[]>;
  predictions: Prediction[];
}

interface Benchmark {
  generatedAt: string;
  schedule: string;
  historyMonths: number;
  results: SymbolResult[];
}

interface EvaluatedOutcome extends DatedForecastOutcome {
  symbol: string;
  originDate: string;
  fold: number;
  testStart: string;
  testEndExclusive: string;
}

interface FoldResult {
  schedule: string;
  horizon: HorizonName;
  event: ForecastEvent;
  fold: number;
  testStart: string;
  testEndExclusive: string;
  symbols: number;
  samples: number;
  eventCount: number;
  observedRatePct: number;
  priorProbability: number;
  priorOutcomeSamples: number;
  usedNeutralFallback: boolean;
  brierScore: number;
  logLoss: number;
}

const inputDirectory = resolve(
  process.env.FORECAST_BENCHMARK_DIR ??
    'node_modules/.cache/forecast-benchmark'
);
const resultsDirectory = resolve('results');
const benchmarkPrefixes = [
  'benchmark-current-schedule-',
  'benchmark-gap-free-diagnostic-',
];
const horizons: { name: HorizonName; sessions: number }[] = [
  { name: 'next_day', sessions: 1 },
  { name: 'week', sessions: 5 },
];

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
  ].join('\r\n') + '\r\n';
}

function foldCsvRows(rows: FoldResult[]): Record<string, unknown>[] {
  return rows.map((row) => ({
    schedule: row.schedule,
    horizon: row.horizon,
    event: row.event,
    fold: row.fold,
    testStart: row.testStart,
    testEndExclusive: row.testEndExclusive,
    symbols: row.symbols,
    samples: row.samples,
    eventCount: row.eventCount,
    observedRatePct: row.observedRatePct,
    priorProbability: row.priorProbability,
    priorOutcomeSamples: row.priorOutcomeSamples,
    usedNeutralFallback: row.usedNeutralFallback,
    brierScore: row.brierScore,
    logLoss: row.logLoss,
  }));
}

async function latestBenchmark(prefix: string): Promise<Benchmark> {
  const files = (await readdir(inputDirectory))
    .filter((file) => file.startsWith(prefix) && file.endsWith('.json'))
    .sort();
  const file = files.at(-1);
  if (!file)
    throw new Error(`No benchmark artifact beginning '${prefix}' in ${inputDirectory}.`);
  const benchmark = JSON.parse(
    await readFile(join(inputDirectory, file), 'utf8')
  ) as Benchmark;
  const successful = benchmark.results.filter(
    (result) => result.status === 'ok'
  );
  if (successful.length !== 29)
    throw new Error(`${file} has ${successful.length} successful symbols; expected 29.`);
  if (successful.some(
    (result) => result.history?.dataQuality?.corporateActionAdjustment !== 'applied'
  ))
    throw new Error(`${file} includes a symbol without applied corporate-action adjustments.`);
  return benchmark;
}

function collectOutcomes(
  benchmark: Benchmark,
  horizon: HorizonName,
  sessions: number
): EvaluatedOutcome[] {
  const outcomes: EvaluatedOutcome[] = [];
  for (const result of benchmark.results) {
    if (result.status !== 'ok') continue;
    const folds = result.folds?.[horizon];
    if (!folds)
      throw new Error(`Missing ${horizon} fold boundaries for ${result.symbol}.`);
    for (const prediction of result.predictions) {
      if (prediction.horizon !== sessions) continue;
      const fold = folds[prediction.fold];
      if (!fold)
        throw new Error(`Missing fold ${prediction.fold} for ${result.symbol} ${horizon}.`);
      if (!Number.isFinite(prediction.actualLogReturn))
        throw new Error(`Invalid target return for ${result.symbol} ${horizon}.`);
      outcomes.push({
        symbol: result.symbol,
        horizon: sessions,
        originDate: prediction.originDate,
        targetDate: prediction.targetDate,
        actualLogReturn: prediction.actualLogReturn,
        fold: prediction.fold,
        testStart: fold.testStart,
        testEndExclusive: fold.testEndExclusive,
      });
    }
  }
  const keys = new Set<string>();
  for (const outcome of outcomes) {
    const key = `${outcome.symbol}:${outcome.originDate}:${outcome.horizon}`;
    if (keys.has(key))
      throw new Error(`Duplicate out-of-sample origin found: ${key}.`);
    keys.add(key);
  }
  if (!outcomes.length)
    throw new Error(`No outcome rows found for ${horizon}.`);
  return outcomes;
}

function analyzeEvent(
  schedule: string,
  horizon: HorizonName,
  event: ForecastEvent,
  outcomes: EvaluatedOutcome[]
): FoldResult[] {
  const groups = new Map<string, EvaluatedOutcome[]>();
  for (const outcome of outcomes) {
    const group = groups.get(outcome.testStart) ?? [];
    group.push(outcome);
    groups.set(outcome.testStart, group);
  }

  return [...groups.entries()].map(([testStart, group]) => {
    const prior = priorEventProbability(
      outcomes,
      group[0].horizon,
      testStart,
      event
    );
    const binary = group.map((outcome) => ({
      probability: prior.probability,
      occurred: forecastEventOccurred(outcome.actualLogReturn, event),
    }));
    const score = scoreBinaryProbabilities(binary);
    return {
      schedule,
      horizon,
      event,
      fold: group[0].fold,
      testStart,
      testEndExclusive: group[0].testEndExclusive,
      symbols: new Set(group.map((outcome) => outcome.symbol)).size,
      samples: score.samples,
      eventCount: Math.round(score.observedRatePct * score.samples / 100),
      observedRatePct: score.observedRatePct,
      priorProbability: prior.probability,
      priorOutcomeSamples: prior.samples,
      usedNeutralFallback: prior.fallback,
      brierScore: score.brierScore,
      logLoss: score.logLoss,
    };
  });
}

const foldRows: FoldResult[] = [];
for (const prefix of benchmarkPrefixes) {
  const benchmark = await latestBenchmark(prefix);
  for (const { name, sessions } of horizons) {
    const outcomes = collectOutcomes(benchmark, name, sessions);
    for (const event of forecastEvents)
      foldRows.push(...analyzeEvent(benchmark.schedule, name, event, outcomes));
  }
}

const aggregateRows = new Map<string, Record<string, unknown>>();
for (const group of foldRows) {
  const key = `${group.schedule}:${group.horizon}:${group.event}`;
  const current = aggregateRows.get(key) ?? {
    schedule: group.schedule,
    horizon: group.horizon,
    event: group.event,
    folds: 0,
    samples: 0,
    eventCount: 0,
    brierTotal: 0,
    logLossTotal: 0,
    neutralFallbackFolds: 0,
    priorOutcomeSamplesMin: Number.POSITIVE_INFINITY,
    priorOutcomeSamplesMax: 0,
  };
  current.folds = Number(current.folds) + 1;
  current.samples = Number(current.samples) + group.samples;
  current.eventCount = Number(current.eventCount) + group.eventCount;
  current.brierTotal = Number(current.brierTotal) + group.brierScore * group.samples;
  current.logLossTotal = Number(current.logLossTotal) + group.logLoss * group.samples;
  current.neutralFallbackFolds = Number(current.neutralFallbackFolds) +
    (group.usedNeutralFallback ? 1 : 0);
  current.priorOutcomeSamplesMin = Math.min(
    Number(current.priorOutcomeSamplesMin),
    group.priorOutcomeSamples
  );
  current.priorOutcomeSamplesMax = Math.max(
    Number(current.priorOutcomeSamplesMax),
    group.priorOutcomeSamples
  );
  aggregateRows.set(key, current);
}

const finalizedRows = [...aggregateRows.values()].map((row) => ({
  schedule: row.schedule,
  horizon: row.horizon,
  event: row.event,
  folds: row.folds,
  samples: row.samples,
  eventCount: row.eventCount,
  observedRatePct: Number(row.eventCount) / Number(row.samples) * 100,
  brierScore: Number(row.brierTotal) / Number(row.samples),
  logLoss: Number(row.logLossTotal) / Number(row.samples),
  neutralFallbackFolds: row.neutralFallbackFolds,
  priorOutcomeSamplesMin: row.priorOutcomeSamplesMin,
  priorOutcomeSamplesMax: row.priorOutcomeSamplesMax,
}));

await mkdir(resultsDirectory, { recursive: true });
await writeFile(
  join(resultsDirectory, 'forecast-probability-target-audit.csv'),
  csv(finalizedRows, [
    'schedule',
    'horizon',
    'event',
    'folds',
    'samples',
    'eventCount',
    'observedRatePct',
    'brierScore',
    'logLoss',
    'neutralFallbackFolds',
    'priorOutcomeSamplesMin',
    'priorOutcomeSamplesMax',
  ])
);
await writeFile(
  join(resultsDirectory, 'forecast-probability-target-audit-by-fold.csv'),
  csv(foldCsvRows(foldRows), [
    'schedule',
    'horizon',
    'event',
    'fold',
    'testStart',
    'testEndExclusive',
    'symbols',
    'samples',
    'eventCount',
    'observedRatePct',
    'priorProbability',
    'priorOutcomeSamples',
    'usedNeutralFallback',
    'brierScore',
    'logLoss',
  ])
);
console.log(`Audited ${finalizedRows.length} schedule/horizon/event combinations.`);
console.log('Wrote aggregate and per-fold target audits to results/.');

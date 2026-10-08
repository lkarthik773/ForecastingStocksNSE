import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ForecastEvent } from '../../src/forecast/target-outcomes.js';

export const probabilityBenchmarkSymbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

export const probabilitySnapshotModelVersion =
  'logistic-close-only-l2-0.01-v1';
export const probabilityProspectiveDirectory = resolve(
  process.env.FORECAST_PROBABILITY_PROSPECTIVE_DIR ??
    'results/forecast-probability-prospective'
);
export const probabilityHistoricalDirectory = resolve(
  process.env.FORECAST_PROBABILITY_RESULTS_DIR ??
    'results/forecast-probability-classifier'
);

export interface ProbabilityOutcome {
  symbol: string;
  horizon: number;
  targetDate: string;
  actualLogReturn: number;
  originDate?: string;
}

export interface ProbabilitySnapshotPrediction {
  symbol: string;
  originDate: string;
  horizon: 1 | 5;
  event: ForecastEvent;
  probability: number;
  priorProbability: number;
  priorOutcomeSamples: number;
  usedNeutralPriorFallback: boolean;
  trainingRows: number;
  positiveTrainingRows: number;
  negativeTrainingRows: number;
}

export interface ProbabilitySnapshot {
  generatedAt: string;
  captureDate: string;
  modelVersion: string;
  historyMonths: number;
  historicalBenchmarkRun: string;
  historicalOutcomeCount: number;
  symbols: string[];
  predictions: ProbabilitySnapshotPrediction[];
}

interface HistoricalPrediction {
  symbol: string;
  horizon: number;
  event: ForecastEvent;
  originDate: string;
  targetDate: string;
  actualLogReturn: number;
}

interface HistoricalBenchmarkArtifact {
  schedule: string;
  successfulSymbols: number;
  model: {
    name: string;
    features: string;
    l2Penalty: number;
  };
  predictions: HistoricalPrediction[];
}

export function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csv(
  rows: Record<string, unknown>[],
  columns: string[]
): string {
  return [
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')),
  ].join('\r\n') + '\r\n';
}

export async function latestHistoricalOutcomes(): Promise<{
  run: string;
  outcomes: ProbabilityOutcome[];
}> {
  const directories = (await readdir(probabilityHistoricalDirectory, {
    withFileTypes: true,
  }))
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith('current-schedule-') &&
        existsSync(join(probabilityHistoricalDirectory, entry.name, 'predictions.json'))
    )
    .map((entry) => entry.name)
    .sort();
  const run = directories.at(-1);
  if (!run)
    throw new Error(
      `No completed probability benchmark is available under ${probabilityHistoricalDirectory}.`
    );
  const artifact = JSON.parse(
    await readFile(
      join(probabilityHistoricalDirectory, run, 'predictions.json'),
      'utf8'
    )
  ) as HistoricalBenchmarkArtifact;
  if (
    artifact.schedule !== 'current-schedule' ||
    artifact.successfulSymbols !== probabilityBenchmarkSymbols.length ||
    artifact.model?.name !== 'per-symbol standardized logistic regression' ||
    artifact.model.l2Penalty !== 0.01 ||
    artifact.model.features !==
      'same causal close-only technical features as LightGBM technical'
  )
    throw new Error(
      `Historical probability benchmark ${run} does not match the frozen 29-symbol classifier configuration.`
    );
  const selected = artifact.predictions.filter((row) => row.event === 'up');
  const keys = new Set<string>();
  const outcomes = selected.map((row) => {
    if (
      !Number.isFinite(row.actualLogReturn) ||
      (row.horizon !== 1 && row.horizon !== 5)
    )
      throw new Error('Historical probability benchmark contains an invalid outcome.');
    const key = `${row.symbol}:${row.originDate}:${row.horizon}`;
    if (keys.has(key))
      throw new Error(`Duplicate historical outcome found: ${key}.`);
    keys.add(key);
    return {
      symbol: row.symbol,
      horizon: row.horizon,
      targetDate: row.targetDate,
      actualLogReturn: row.actualLogReturn,
      originDate: row.originDate,
    };
  });
  if (!outcomes.length)
    throw new Error('Historical probability benchmark has no outcome rows.');
  return { run, outcomes };
}

export async function readMaturedOutcomes(): Promise<ProbabilityOutcome[]> {
  const path = join(probabilityProspectiveDirectory, 'matured-outcomes.json');
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(await readFile(path, 'utf8')) as {
    outcomes: ProbabilityOutcome[];
  };
  if (
    !Array.isArray(parsed.outcomes) ||
    parsed.outcomes.some(
      (row) =>
        typeof row.symbol !== 'string' ||
        (row.horizon !== 1 && row.horizon !== 5) ||
        typeof row.targetDate !== 'string' ||
        !Number.isFinite(row.actualLogReturn) ||
        (row.originDate !== undefined && typeof row.originDate !== 'string')
    )
  )
    throw new Error('Prospective matured-outcomes file has an invalid schema.');
  return parsed.outcomes;
}

export async function readProbabilitySnapshots(): Promise<ProbabilitySnapshot[]> {
  const directory = join(probabilityProspectiveDirectory, 'snapshots');
  if (!existsSync(directory)) return [];
  const files = (await readdir(directory))
    .filter((file) => file.endsWith('.json'))
    .sort();
  const snapshots: ProbabilitySnapshot[] = [];
  for (const file of files) {
    const snapshot = JSON.parse(
      await readFile(join(directory, file), 'utf8')
    ) as ProbabilitySnapshot;
    if (
      snapshot.modelVersion !== probabilitySnapshotModelVersion ||
      !Array.isArray(snapshot.predictions) ||
      snapshot.predictions.some(
        (row) =>
          !Number.isFinite(row.probability) ||
          row.probability < 0 ||
          row.probability > 1 ||
          !Number.isFinite(row.priorProbability) ||
          row.priorProbability < 0 ||
          row.priorProbability > 1
      )
    )
      throw new Error(`Prospective probability snapshot has an invalid schema: ${file}.`);
    snapshots.push(snapshot);
  }
  return snapshots;
}

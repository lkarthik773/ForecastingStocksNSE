import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

const developmentSymbols: readonly string[] = [
  'TCS',
  'INFY',
  'HDFCBANK',
  'RELIANCE',
  'WIPRO',
];
const confirmationSymbols: readonly string[] = [
  'ICICIBANK',
  'SBIN',
  'LT',
  'BAJFINANCE',
  'SUNPHARMA',
  'ITC',
  'MARUTI',
  'BHARTIARTL',
];
const holdoutStart = '2025-10-07';
const holdoutEndExclusive = '2026-10-08';
const bootstrapReplicates = 2000;
const bootstrapBlockSessions = 20;

interface Prediction {
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  actualLogReturn: number;
}

interface VariantRun {
  symbol: string;
  variant: string;
  status: 'ok' | 'error';
  error?: string;
  predictions: Prediction[];
}

interface AblationFile {
  evaluation: {
    asOfDate: string;
    symbols: string[];
    historyMonths: number;
    stepMonths: number;
    horizonSessions: number;
    variants: string[];
  };
  results: VariantRun[];
}

interface MatchedOrigin {
  symbol: string;
  originDate: string;
  targetDate: string;
  actualLogReturn: number;
  predictions: Record<string, number>;
}

interface PairedOrigin {
  originDate: string;
  actualLogReturn: number;
  baselineLogReturn: number;
  candidateLogReturn: number;
}

export interface BootstrapInterval {
  samples: number;
  blockSessions: number;
  directionChangePp: number;
  directionLower95Pp: number;
  directionUpper95Pp: number;
  mapeChangePp: number;
  mapeLower95Pp: number;
  mapeUpper95Pp: number;
}

const periods = [
  { id: 'all_matched', label: 'All matched origins' },
  {
    id: '2023-06_to_2024-06',
    label: '2023-06-07 to 2024-06-06',
    from: '2023-06-07',
    to: '2024-06-07',
  },
  {
    id: '2024-06_to_2025-06',
    label: '2024-06-07 to 2025-06-06',
    from: '2024-06-07',
    to: '2025-06-07',
  },
  {
    id: '2025-06_to_2026-10',
    label: '2025-06-07 to 2026-10-07',
    from: '2025-06-07',
    to: holdoutEndExclusive,
  },
  {
    id: 'last_12_months',
    label: 'Predeclared holdout: 2025-10-07 to 2026-10-07',
    from: holdoutStart,
    to: holdoutEndExclusive,
  },
] as const;

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvValue(row[column])).join(',')
    ),
  ].join('\r\n') + '\r\n';
}

function originKey(prediction: Prediction): string {
  return `${prediction.originDate}\u0000${prediction.targetDate}`;
}

function makeMatchedOrigins(file: AblationFile): MatchedOrigin[] {
  const { evaluation } = file;
  if (
    evaluation.horizonSessions !== 5 ||
    !Array.isArray(evaluation.symbols) ||
    !Array.isArray(evaluation.variants) ||
    evaluation.variants.length < 2 ||
    new Set(evaluation.variants).size !== evaluation.variants.length ||
    !evaluation.variants.includes('technical') ||
    !evaluation.variants.includes('options_only') ||
    !Array.isArray(file.results)
  )
    throw new Error('The input file is not a valid five-session ablation run.');

  const missingSymbols = [
    ...developmentSymbols,
    ...confirmationSymbols,
  ].filter((symbol) => !evaluation.symbols.includes(symbol));
  if (missingSymbols.length)
    throw new Error(
      `The run is missing required symbols: ${missingSymbols.join(', ')}.`
    );

  const origins: MatchedOrigin[] = [];
  for (const symbol of evaluation.symbols) {
    const predictionsByVariant = new Map<string, Map<string, Prediction>>();
    for (const variant of evaluation.variants) {
      const run = file.results.find(
        (item) => item.symbol === symbol && item.variant === variant
      );
      if (!run || run.status !== 'ok')
        throw new Error(
          `Incomplete run for ${symbol}/${variant}: ${run?.error ?? 'no result'}.`
        );
      const predictions = new Map(
        run.predictions
          .filter((prediction) => prediction.horizon === 5)
          .map((prediction) => [originKey(prediction), prediction])
      );
      predictionsByVariant.set(variant, predictions);
    }

    const firstVariant = evaluation.variants[0];
    const commonKeys = new Set(predictionsByVariant.get(firstVariant)!.keys());
    for (const variant of evaluation.variants.slice(1)) {
      const variantPredictions = predictionsByVariant.get(variant)!;
      for (const key of commonKeys)
        if (!variantPredictions.has(key)) commonKeys.delete(key);
    }
    if (!commonKeys.size)
      throw new Error(`No common forecast origins for ${symbol}.`);

    for (const key of commonKeys) {
      const sample = predictionsByVariant.get(firstVariant)!.get(key)!;
      const predictions: Record<string, number> = {};
      for (const variant of evaluation.variants) {
        const prediction = predictionsByVariant.get(variant)!.get(key)!;
        if (Math.abs(prediction.actualLogReturn - sample.actualLogReturn) > 1e-12)
          throw new Error(
            `Actual returns disagree for ${symbol}/${sample.originDate}/${variant}.`
          );
        predictions[variant] = prediction.predictedLogReturn;
      }
      origins.push({
        symbol,
        originDate: sample.originDate,
        targetDate: sample.targetDate,
        actualLogReturn: sample.actualLogReturn,
        predictions,
      });
    }
  }
  return origins;
}

function pairedOrigins(
  origins: MatchedOrigin[],
  baselineVariant: string,
  candidateVariant: string
): PairedOrigin[] {
  return origins.map((origin) => ({
    originDate: origin.originDate,
    actualLogReturn: origin.actualLogReturn,
    baselineLogReturn: origin.predictions[baselineVariant],
    candidateLogReturn: origin.predictions[candidateVariant],
  }));
}

function directionalHit(predicted: number, actual: number): number {
  return Number(Math.sign(predicted) === Math.sign(actual));
}

function absolutePercentageError(predicted: number, actual: number): number {
  return Math.abs(Math.expm1(predicted - actual)) * 100;
}

function pairedDelta(rows: PairedOrigin[]): {
  directionChangePp: number;
  mapeChangePp: number;
} {
  if (!rows.length) throw new Error('No paired forecast origins to score.');
  let directionChange = 0;
  let mapeChange = 0;
  for (const row of rows) {
    directionChange +=
      directionalHit(row.candidateLogReturn, row.actualLogReturn) -
      directionalHit(row.baselineLogReturn, row.actualLogReturn);
    mapeChange +=
      absolutePercentageError(row.candidateLogReturn, row.actualLogReturn) -
      absolutePercentageError(row.baselineLogReturn, row.actualLogReturn);
  }
  return {
    directionChangePp: (directionChange / rows.length) * 100,
    mapeChangePp: mapeChange / rows.length,
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

export function movingBlockBootstrap(
  rows: PairedOrigin[],
  seedText: string,
  replicates = bootstrapReplicates,
  blockSessions = bootstrapBlockSessions
): BootstrapInterval {
  if (!rows.length || !Number.isInteger(replicates) || replicates < 100)
    throw new Error('Bootstrap needs paired rows and at least 100 replicates.');
  if (!Number.isInteger(blockSessions) || blockSessions < 1)
    throw new Error('Bootstrap block length must be a positive session count.');
  const byDate = new Map<string, PairedOrigin[]>();
  for (const row of rows) {
    const dateRows = byDate.get(row.originDate) ?? [];
    dateRows.push(row);
    byDate.set(row.originDate, dateRows);
  }
  const dates = [...byDate.keys()].sort();
  const actualBlockSessions = Math.min(blockSessions, dates.length);
  const random = seededRandom(seedText);
  const directionReplicates: number[] = [];
  const mapeReplicates: number[] = [];

  for (let replicate = 0; replicate < replicates; replicate++) {
    const sampledDates: string[] = [];
    while (sampledDates.length < dates.length) {
      const maxStart = Math.max(0, dates.length - actualBlockSessions);
      const start = Math.floor(random() * (maxStart + 1));
      sampledDates.push(
        ...dates.slice(start, start + actualBlockSessions)
      );
    }
    const weights = new Map<string, number>();
    for (const date of sampledDates.slice(0, dates.length))
      weights.set(date, (weights.get(date) ?? 0) + 1);

    let samples = 0;
    let directionChange = 0;
    let mapeChange = 0;
    for (const [date, multiplicity] of weights) {
      for (const row of byDate.get(date)!) {
        samples += multiplicity;
        directionChange +=
          multiplicity *
          (directionalHit(row.candidateLogReturn, row.actualLogReturn) -
            directionalHit(row.baselineLogReturn, row.actualLogReturn));
        mapeChange +=
          multiplicity *
          (absolutePercentageError(
            row.candidateLogReturn,
            row.actualLogReturn
          ) -
            absolutePercentageError(
              row.baselineLogReturn,
              row.actualLogReturn
            ));
      }
    }
    directionReplicates.push((directionChange / samples) * 100);
    mapeReplicates.push(mapeChange / samples);
  }

  directionReplicates.sort((a, b) => a - b);
  mapeReplicates.sort((a, b) => a - b);
  const point = pairedDelta(rows);
  return {
    samples: rows.length,
    blockSessions: actualBlockSessions,
    directionChangePp: point.directionChangePp,
    directionLower95Pp: percentile(directionReplicates, 0.025),
    directionUpper95Pp: percentile(directionReplicates, 0.975),
    mapeChangePp: point.mapeChangePp,
    mapeLower95Pp: percentile(mapeReplicates, 0.025),
    mapeUpper95Pp: percentile(mapeReplicates, 0.975),
  };
}

function selectPeriod(
  origins: MatchedOrigin[],
  period: (typeof periods)[number]
): MatchedOrigin[] {
  if (!('from' in period)) return origins;
  return origins.filter(
    (origin) => origin.originDate >= period.from && origin.originDate < period.to
  );
}

function symbolMetrics(
  origins: MatchedOrigin[],
  variant: string,
  symbol: string
) {
  const rows = origins.filter(
    (origin) => symbol === 'ALL' || origin.symbol === symbol
  );
  if (!rows.length) return;
  const baseline = scoreForecastReturns(
    rows.map((origin) => ({
      predictedLogReturn: origin.predictions.technical,
      actualLogReturn: origin.actualLogReturn,
    }))
  );
  const score = scoreForecastReturns(
    rows.map((origin) => ({
      predictedLogReturn: origin.predictions[variant],
      actualLogReturn: origin.actualLogReturn,
    }))
  );
  return {
    pairedSamples: rows.length,
    directionalAccuracyPct: score.directionalAccuracyPct,
    directionChangePp:
      score.directionalAccuracyPct - baseline.directionalAccuracyPct,
    mapePct: score.meanAbsolutePercentageError,
    mapeChangePp:
      score.meanAbsolutePercentageError -
      baseline.meanAbsolutePercentageError,
  };
}

function writeTimeSliceRows(origins: MatchedOrigin[], variants: string[]) {
  const rows: Record<string, unknown>[] = [];
  const symbols = [...new Set(origins.map((origin) => origin.symbol))].sort();
  for (const period of periods) {
    const periodOrigins = selectPeriod(origins, period);
    for (const variant of variants) {
      for (const symbol of ['ALL', ...symbols]) {
        const metrics = symbolMetrics(periodOrigins, variant, symbol);
        if (!metrics) continue;
        rows.push({
          period: period.id,
          period_label: period.label,
          symbol,
          variant,
          paired_samples: metrics.pairedSamples,
          directional_accuracy_pct: metrics.directionalAccuracyPct,
          direction_change_vs_technical_pp: metrics.directionChangePp,
          mape_pct: metrics.mapePct,
          mape_change_vs_technical_pp: metrics.mapeChangePp,
        });
      }
    }
  }
  return rows;
}

function bootstrapRows(origins: MatchedOrigin[]) {
  const populations = [
    {
      id: 'new_symbols_all_periods',
      label: 'New symbols, all matched origins',
      symbols: confirmationSymbols,
      from: undefined,
      to: undefined,
    },
    {
      id: 'new_symbols_last_12_months',
      label: 'Primary: new symbols, 2025-10-07 to 2026-10-07',
      symbols: confirmationSymbols,
      from: holdoutStart,
      to: holdoutEndExclusive,
    },
    {
      id: 'previous_symbols_last_12_months',
      label: 'Previously explored symbols, 2025-10-07 to 2026-10-07',
      symbols: developmentSymbols,
      from: holdoutStart,
      to: holdoutEndExclusive,
    },
    {
      id: 'all_symbols_last_12_months',
      label: 'All symbols, 2025-10-07 to 2026-10-07',
      symbols: [...developmentSymbols, ...confirmationSymbols],
      from: holdoutStart,
      to: holdoutEndExclusive,
    },
  ] as const;

  const rows: Record<string, unknown>[] = [];
  for (const population of populations) {
    const selected = origins.filter(
      (origin) =>
        population.symbols.includes(origin.symbol) &&
        (!population.from || origin.originDate >= population.from) &&
        (!population.to || origin.originDate < population.to)
    );
    for (const variant of ['options_only']) {
      const paired = pairedOrigins(selected, 'technical', variant);
      const interval = movingBlockBootstrap(
        paired,
        `${population.id}/${variant}`
      );
      const positiveSymbolCount = confirmationSymbols.filter((symbol) => {
          const symbolPairs = pairedOrigins(
            selected.filter((origin) => origin.symbol === symbol),
            'technical',
            variant
          );
          return symbolPairs.length && pairedDelta(symbolPairs).directionChangePp > 0;
        }).length;
      const positiveSymbols = population.symbols.some((symbol) =>
        confirmationSymbols.includes(symbol)
      )
        ? positiveSymbolCount
        : '';
      const meetsCriteria =
        population.id !== 'new_symbols_last_12_months'
          ? ''
          : interval.directionChangePp >= 0.5 &&
            interval.directionLower95Pp > 0 &&
            interval.mapeUpper95Pp <= 0.05 &&
            positiveSymbolCount >= 5;
      rows.push({
        population: population.id,
        population_label: population.label,
        baseline: 'technical',
        candidate: variant,
        paired_samples: interval.samples,
        block_sessions: interval.blockSessions,
        bootstrap_replicates: bootstrapReplicates,
        direction_change_pp: interval.directionChangePp,
        direction_ci95_lower_pp: interval.directionLower95Pp,
        direction_ci95_upper_pp: interval.directionUpper95Pp,
        mape_change_pp: interval.mapeChangePp,
        mape_ci95_lower_pp: interval.mapeLower95Pp,
        mape_ci95_upper_pp: interval.mapeUpper95Pp,
        new_symbols_with_positive_direction_delta: positiveSymbols,
        predeclared_criteria:
          population.id === 'new_symbols_last_12_months'
            ? 'direction >= +0.5 pp; 95% CI lower > 0; MAPE 95% CI upper <= +0.05 pp; >=5/8 symbols direction-positive'
            : '',
        meets_predeclared_criteria: meetsCriteria,
      });
    }
  }
  return rows;
}

async function main() {
  const inputPath = process.argv[2] ?? process.env.FORECAST_FNO_ABLATION_RESUME;
  if (!inputPath)
    throw new Error(
      'Pass the ablation progress JSON path or set FORECAST_FNO_ABLATION_RESUME.'
    );
  const file = JSON.parse(
    await readFile(resolve(inputPath), 'utf8')
  ) as AblationFile;
  const origins = makeMatchedOrigins(file);
  const variantNames = file.evaluation.variants;
  const resultsDirectory = resolve(
    process.env.FORECAST_FNO_RESULTS_DIR ?? 'results'
  );
  const timeSliceRows = writeTimeSliceRows(origins, variantNames);
  const bootstrapResults = bootstrapRows(origins);
  const primary = bootstrapResults.find(
    (row) => row.population === 'new_symbols_last_12_months'
  )!;

  await mkdir(resultsDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-time-slices.csv'),
      csv(timeSliceRows, Object.keys(timeSliceRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-bootstrap.csv'),
      csv(bootstrapResults, Object.keys(bootstrapResults[0])),
      'utf8'
    ),
  ]);
  console.log(
    `Matched ${origins.length.toLocaleString('en-US')} symbol-origin pairs across ${file.evaluation.symbols.length} symbols and ${variantNames.length} variants.`
  );
  console.log(
    `Primary options-only holdout decision: ${primary.meets_predeclared_criteria ? 'MEETS' : 'DOES NOT MEET'} the predeclared criteria.`
  );
  console.table([primary]);
  console.log(`Analysis exports: ${resultsDirectory}`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    console.error(`F&O generalization analysis failed: ${message}`);
    process.exitCode = 1;
  });
}

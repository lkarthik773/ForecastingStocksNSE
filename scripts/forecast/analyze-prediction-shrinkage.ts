import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';
import {
  calibratePredictionShrinkage,
  selectMaturedShrinkageObservations,
} from '../../src/forecast/prediction-shrinkage.js';

type HorizonName = 'next_day' | 'week';

interface Prediction {
  symbol: string;
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  baselinePredictedLogReturn?: number;
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

interface EvaluationPrediction extends Prediction {
  testStart: string;
  testEndExclusive: string;
  calibrationFactor: number;
  calibrationSamples: number;
}

interface Metrics {
  samples: number;
  mape: number;
  logReturnMaePct: number;
  directionAccuracyPct: number;
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
const models = [
  'LightGBM',
  'Causal shrinkage',
  'No-change',
  'Statistical baseline',
] as const;

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

function horizonPredictions(
  benchmark: Benchmark,
  horizon: HorizonName,
  sessions: number
): EvaluationPrediction[] {
  const predictions: EvaluationPrediction[] = [];
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
      if (!Number.isFinite(prediction.baselinePredictedLogReturn))
        throw new Error(`Missing statistical baseline prediction for ${result.symbol} ${horizon}.`);
      predictions.push({
        ...prediction,
        testStart: fold.testStart,
        testEndExclusive: fold.testEndExclusive,
        calibrationFactor: 0,
        calibrationSamples: 0,
      });
    }
  }
  if (!predictions.length)
    throw new Error(`No predictions found for ${horizon}.`);

  const keys = new Set<string>();
  for (const prediction of predictions) {
    const key = `${prediction.symbol}:${prediction.originDate}:${prediction.horizon}`;
    if (keys.has(key))
      throw new Error(`Duplicate out-of-sample origin found: ${key}.`);
    keys.add(key);
  }

  const calibrations = new Map<
    string,
    ReturnType<typeof calibratePredictionShrinkage>
  >();
  for (const prediction of predictions) {
    let calibration = calibrations.get(prediction.testStart);
    if (!calibration) {
      const prior = selectMaturedShrinkageObservations(
        predictions,
        prediction.horizon,
        prediction.testStart
      );
      calibration = calibratePredictionShrinkage(prior);
      calibrations.set(prediction.testStart, calibration);
    }
    prediction.calibrationFactor = calibration.factor;
    prediction.calibrationSamples = calibration.samples;
  }
  return predictions;
}

function metrics(
  predictions: EvaluationPrediction[],
  selectReturn: (prediction: EvaluationPrediction) => number
): Metrics {
  const score = scoreForecastReturns(
    predictions.map((prediction) => ({
      predictedLogReturn: selectReturn(prediction),
      actualLogReturn: prediction.actualLogReturn,
    }))
  );
  return {
    samples: score.samples,
    mape: score.meanAbsolutePercentageError,
    logReturnMaePct: score.meanAbsoluteLogReturnErrorPct,
    directionAccuracyPct: score.directionalAccuracyPct,
  };
}

function modelMetrics(predictions: EvaluationPrediction[]) {
  return {
    LightGBM: metrics(predictions, (prediction) => prediction.predictedLogReturn),
    'Causal shrinkage': metrics(
      predictions,
      (prediction) => prediction.calibrationFactor * prediction.predictedLogReturn
    ),
    'No-change': metrics(predictions, () => 0),
    'Statistical baseline': metrics(
      predictions,
      (prediction) => prediction.baselinePredictedLogReturn!
    ),
  };
}

function svgChart(rows: Record<string, unknown>[]): string {
  const width = 1120;
  const height = 720;
  const panelWidth = 520;
  const panelHeight = 288;
  const panelPositions = [
    { x: 40, y: 55, schedule: 'current-schedule', horizon: 'next_day', title: 'Current schedule - next day' },
    { x: 580, y: 55, schedule: 'current-schedule', horizon: 'week', title: 'Current schedule - next 5 sessions' },
    { x: 40, y: 370, schedule: 'gap-free-diagnostic', horizon: 'next_day', title: 'Gap-free diagnostic - next day' },
    { x: 580, y: 370, schedule: 'gap-free-diagnostic', horizon: 'week', title: 'Gap-free diagnostic - next 5 sessions' },
  ];
  const colors = ['#5470c6', '#ee6666', '#91cc75', '#fac858'];
  const fragments = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    '<rect width="100%" height="100%" fill="#fff"/>',
    '<style>text{font-family:Arial,sans-serif;fill:#263238}.title{font-size:18px;font-weight:bold}.label{font-size:14px}.value{font-size:13px}.axis{stroke:#9aa4aa;stroke-width:1}</style>',
    '<text x="40" y="27" class="title">Walk-forward return forecast MAPE (lower is better)</text>',
  ];
  for (const panel of panelPositions) {
    const panelRows = rows.filter(
      (row) => row.schedule === panel.schedule && row.horizon === panel.horizon
    );
    const max = Math.max(
      ...panelRows.map((row) => Number(row.mapePct)),
      0.01
    ) * 1.12;
    const plotX = panel.x + 180;
    const plotWidth = panelWidth - 210;
    fragments.push(
      `<text x="${panel.x}" y="${panel.y}" class="title">${panel.title}</text>`,
      `<line x1="${plotX}" y1="${panel.y + 22}" x2="${plotX}" y2="${panel.y + panelHeight - 24}" class="axis"/>`
    );
    models.forEach((model, index) => {
      const row = panelRows.find((item) => item.model === model);
      if (!row) return;
      const y = panel.y + 48 + index * 48;
      const value = Number(row.mapePct);
      const barWidth = Math.max((value / max) * plotWidth, 1);
      fragments.push(
        `<text x="${panel.x}" y="${y + 16}" class="label">${model}</text>`,
        `<rect x="${plotX}" y="${y}" width="${barWidth.toFixed(2)}" height="24" rx="3" fill="${colors[index]}"/>`,
        `<text x="${(plotX + barWidth + 8).toFixed(2)}" y="${y + 17}" class="value">${value.toFixed(3)}%</text>`
      );
    });
  }
  fragments.push(
    '<text x="40" y="680" class="value">Shrink factor is selected only from earlier completed out-of-sample folds; fewer than 100 prior predictions falls back to no-change.</text>',
    '<text x="40" y="702" class="value">Gap-free results are a schedule sensitivity check, not an independent holdout.</text>',
    '</svg>'
  );
  return fragments.join('\n');
}

const aggregateRows: Record<string, unknown>[] = [];
const foldRows: Record<string, unknown>[] = [];
for (const prefix of benchmarkPrefixes) {
  const benchmark = await latestBenchmark(prefix);
  for (const { name, sessions } of horizons) {
    const predictions = horizonPredictions(benchmark, name, sessions);
    const allMetrics = modelMetrics(predictions);
    for (const model of models) {
      const score = allMetrics[model];
      aggregateRows.push({
        schedule: benchmark.schedule,
        generatedAt: benchmark.generatedAt,
        historyMonths: benchmark.historyMonths,
        horizon: name,
        model,
        samples: score.samples,
        mapePct: score.mape,
        logReturnMaePct: score.logReturnMaePct,
        directionAccuracyPct: score.directionAccuracyPct,
      });
    }

    const groups = new Map<string, EvaluationPrediction[]>();
    for (const prediction of predictions) {
      const key = `${prediction.fold}:${prediction.testStart}`;
      const group = groups.get(key) ?? [];
      group.push(prediction);
      groups.set(key, group);
    }
    for (const [key, group] of groups) {
      const [fold, testStart] = key.split(':');
      const foldMetrics = modelMetrics(group);
      foldRows.push({
        schedule: benchmark.schedule,
        horizon: name,
        fold,
        testStart,
        testEndExclusive: group[0].testEndExclusive,
        symbols: new Set(group.map((prediction) => prediction.symbol)).size,
        samples: group.length,
        shrinkageFactor: group[0].calibrationFactor,
        shrinkageFactorsInFold: new Set(group.map((prediction) => prediction.calibrationFactor)).size,
        priorCalibrationSamplesMin: Math.min(...group.map((prediction) => prediction.calibrationSamples)),
        priorCalibrationSamplesMax: Math.max(...group.map((prediction) => prediction.calibrationSamples)),
        lightgbmMapePct: foldMetrics.LightGBM.mape,
        calibratedMapePct: foldMetrics['Causal shrinkage'].mape,
        noChangeMapePct: foldMetrics['No-change'].mape,
        statisticalBaselineMapePct: foldMetrics['Statistical baseline'].mape,
      });
    }
  }
}

await mkdir(resultsDirectory, { recursive: true });
await writeFile(
  join(resultsDirectory, 'forecast-prediction-shrinkage-comparison.csv'),
  csv(aggregateRows, [
    'schedule',
    'generatedAt',
    'historyMonths',
    'horizon',
    'model',
    'samples',
    'mapePct',
    'logReturnMaePct',
    'directionAccuracyPct',
  ])
);
await writeFile(
  join(resultsDirectory, 'forecast-prediction-shrinkage-by-fold.csv'),
  csv(foldRows, [
    'schedule',
    'horizon',
    'fold',
    'testStart',
    'testEndExclusive',
    'symbols',
    'samples',
    'shrinkageFactor',
    'shrinkageFactorsInFold',
    'priorCalibrationSamplesMin',
    'priorCalibrationSamplesMax',
    'lightgbmMapePct',
    'calibratedMapePct',
    'noChangeMapePct',
    'statisticalBaselineMapePct',
  ])
);
await writeFile(
  join(resultsDirectory, 'forecast-prediction-shrinkage-comparison.svg'),
  svgChart(aggregateRows)
);
console.log(`Analyzed ${aggregateRows.length / models.length} schedule/horizon pairs.`);
console.log('Wrote aggregate, per-fold and chart results to results/.');

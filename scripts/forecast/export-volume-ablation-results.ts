import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

interface Prediction {
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  baselinePredictedLogReturn?: number;
  actualLogReturn: number;
  predictionIntervalRadius?: number;
}

interface VolumeRun {
  symbol: string;
  featureSet: string;
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

interface VolumeBenchmark {
  generatedAt: string;
  evaluation: {
    asOfDate: string;
    developmentEndExclusive: string;
    historyMonths: number;
    schedule: string;
    featureSets: string[];
    holdoutStatus: string;
    volumeFeature: string;
    actionBoundaryPolicy: string;
  };
  results: VolumeRun[];
}

const outputDirectory = resolve(
  process.env.FORECAST_BENCHMARK_DIR ??
    'node_modules/.cache/forecast-benchmark'
);
const resultsDirectory = resolve('results');
const featureSets = ['close_only', 'volume'];
const horizons = [
  { name: 'next_day', label: 'Next trading day', sessions: 1 },
  { name: 'week', label: 'Next 5 trading days', sessions: 5 },
];
const expectedSymbols = 29;

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

function predictionKey(prediction: Prediction): string {
  return `${prediction.originDate}\u0000${prediction.targetDate}`;
}

function metric(
  predictions: Prediction[],
  select: (prediction: Prediction) => number
) {
  if (!predictions.length) return undefined;
  const score = scoreForecastReturns(
    predictions.map((prediction) => ({
      predictedLogReturn: select(prediction),
      actualLogReturn: prediction.actualLogReturn,
    }))
  );
  const intervals = predictions.filter(
    (prediction) => prediction.predictionIntervalRadius !== undefined
  );
  const covered = intervals.filter(
    (prediction) =>
      Math.abs(prediction.actualLogReturn - prediction.predictedLogReturn) <=
      prediction.predictionIntervalRadius!
  ).length;
  return {
    samples: score.samples,
    mapePct: score.meanAbsolutePercentageError,
    maeLogReturnPctPoints: score.meanAbsoluteLogReturnErrorPct,
    directionalAccuracyPct: score.directionalAccuracyPct,
    intervalSamples: intervals.length,
    intervalCovered: covered,
    intervalCoveragePct: intervals.length
      ? (covered / intervals.length) * 100
      : undefined,
  };
}

async function latestRun(): Promise<VolumeBenchmark> {
  const names = (await readdir(outputDirectory))
    .filter(
      (name) => name.startsWith('volume-ablation-') && name.endsWith('.json')
    )
    .sort()
    .reverse();
  if (!names.length) throw new Error('No volume ablation run found.');
  return JSON.parse(
    await readFile(join(outputDirectory, names[0]), 'utf8')
  ) as VolumeBenchmark;
}

function renderChart(
  rows: Record<string, unknown>[],
  sampleCounts: number[]
): string {
  const panels = horizons
    .map(({ name, label }, panelIndex) => {
      const panelX = panelIndex === 0 ? 55 : 575;
      const max = panelIndex === 0 ? 1.8 : 5.5;
      const plotLeft = panelX + 58;
      const plotRight = panelX + 465;
      const plotTop = 200;
      const plotBottom = 455;
      const y = (value: number) =>
        plotBottom - (value / max) * (plotBottom - plotTop);
      const series = [
        { name: 'No-change', color: '#8794a8', model: 'No-change' },
        { name: 'Close-only model', color: '#e3a52f', model: 'Close-only model' },
        { name: 'Volume candidate', color: '#3677c8', model: 'Volume candidate' },
      ];
      const bars = series
        .map((item, itemIndex) => {
          const row = rows.find(
            (candidate) =>
              candidate.horizon === name && candidate.model === item.model
          );
          const value = row?.mape_pct;
          if (typeof value !== 'number' || !Number.isFinite(value))
            throw new Error(`Missing chart metric for ${name} / ${item.name}.`);
          const x = plotLeft + 50 + itemIndex * 108;
          const barY = y(value);
          return `<rect x="${x}" y="${barY}" width="56" height="${plotBottom - barY}" rx="3" fill="${item.color}"/><text x="${x + 28}" y="${barY - 8}" class="value" text-anchor="middle">${value.toFixed(2)}%</text><text x="${x + 28}" y="${plotBottom + 22}" class="category" text-anchor="middle">${item.name}</text>`;
        })
        .join('\n');
      const ticks = [0, max / 4, max / 2, (max * 3) / 4, max]
        .map((value) => {
          const tickY = y(value);
          return `<line x1="${plotLeft}" y1="${tickY}" x2="${plotRight}" y2="${tickY}" stroke="#e1e6ed"/><text x="${plotLeft - 9}" y="${tickY + 4}" class="axis" text-anchor="end">${value.toFixed(1)}%</text>`;
        })
        .join('\n');
      return `<g><text x="${panelX}" y="145" class="panel">${label} | ${sampleCounts[panelIndex].toLocaleString('en-US')} matched pairs</text><text x="${panelX}" y="168" class="subtitle">Average price-estimate error (MAPE); lower is better</text>${ticks}<line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#687386"/><line x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}" stroke="#687386"/>${bars}</g>`;
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="590" style="max-width:100%;height:auto;display:block" viewBox="0 0 1100 590" role="img" aria-labelledby="title description">
<title id="title">Does relative trading volume improve price forecasts?</title>
<desc id="description">Matched-date mean absolute percentage error for the close-only model, a causal relative-volume candidate, and the no-change baseline. Lower is better.</desc>
<style>text{font-family:Arial,Helvetica,sans-serif;fill:#263244}.title{font-size:26px;font-weight:700}.subtitle{font-size:14px;fill:#596579}.panel{font-size:18px;font-weight:700}.axis{font-size:12px;fill:#596579}.value{font-size:12px;font-weight:700}.category{font-size:12px;font-weight:600}</style>
<rect width="1100" height="590" fill="#fff"/>
<text x="55" y="48" class="title">Does relative trading volume improve price forecasts?</text>
<text x="55" y="76" class="subtitle">Same history, rolling folds and matched forecast origins; action-adjacent volume windows are excluded.</text>
${panels}
<text x="55" y="540" class="subtitle">No-change means keeping the last closing price. Lower MAPE is better; historical results do not predict future performance.</text>
<text x="55" y="564" class="subtitle">See companion CSVs for direction accuracy, interval coverage, symbol-level results and excluded volume rows.</text>
</svg>
`;
}

async function exportResults() {
  const run = await latestRun();
  const expectedRuns = expectedSymbols * featureSets.length;
  const keys = run.results.map(
    (result) => `${result.featureSet}\u0000${result.symbol}`
  );
  if (run.results.length !== expectedRuns || new Set(keys).size !== expectedRuns)
    throw new Error(
      `Expected ${expectedRuns} unique symbol/feature entries; found ${run.results.length}.`
    );
  const errors = run.results.filter((result) => result.status !== 'ok');
  if (errors.length)
    throw new Error(`Volume run contains ${errors.length} failed entries.`);

  const summaryRows: Record<string, unknown>[] = [];
  const symbolRows: Record<string, unknown>[] = [];
  const eligibilityRows: Record<string, unknown>[] = [];
  const sampleCounts: number[] = [];
  for (const result of run.results)
    eligibilityRows.push({
      symbol: result.symbol,
      feature_set: result.featureSet,
      eligible: result.status === 'ok',
      first_observation: result.firstDate,
      last_observation: result.lastDate,
      observations: result.observationCount,
      intraday_reversal_candles: result.intradayReversalCandles,
      corporate_action_adjustment_events:
        result.corporateActionAdjustmentEvents,
      corporate_action_adjustment_status:
        result.corporateActionAdjustmentStatus,
      next_day_scored_folds: result.scoredFolds?.next_day,
      next_day_skipped_folds: result.skippedFolds?.next_day,
      week_scored_folds: result.scoredFolds?.week,
      week_skipped_folds: result.skippedFolds?.week,
      next_day_unavailable_train_rows:
        result.featureUnavailableTrainRows?.next_day,
      next_day_unavailable_test_rows:
        result.featureUnavailableTestRows?.next_day,
      week_unavailable_train_rows:
        result.featureUnavailableTrainRows?.week,
      week_unavailable_test_rows:
        result.featureUnavailableTestRows?.week,
      error: result.error,
    });

  for (const { name, sessions } of horizons) {
    const byFeature = new Map(
      featureSets.map((featureSet) => [
        featureSet,
        new Map(
          run.results
            .filter((result) => result.featureSet === featureSet)
            .map((result) => [
              result.symbol,
              new Map(
                result.predictions
                  .filter((prediction) => prediction.horizon === sessions)
                  .map((prediction) => [predictionKey(prediction), prediction])
              ),
            ])
        ),
      ])
    );
    const commonBySymbol = new Map<string, string[]>();
    for (const [symbol, control] of byFeature.get('close_only')!) {
      const candidate = byFeature.get('volume')!.get(symbol);
      if (candidate)
        commonBySymbol.set(
          symbol,
          [...control.keys()].filter((key) => candidate.has(key))
        );
    }
    const commonCount = [...commonBySymbol.values()].reduce(
      (total, sampleKeys) => total + sampleKeys.length,
      0
    );
    if (!commonCount)
      throw new Error(`No common volume ${name} samples remain.`);
    sampleCounts.push(commonCount);

    for (const featureSet of featureSets) {
      const modelName =
        featureSet === 'close_only' ? 'Close-only model' : 'Volume candidate';
      const predictions = [...commonBySymbol.entries()].flatMap(
        ([symbol, sampleKeys]) => {
          const byKey = byFeature.get(featureSet)!.get(symbol)!;
          return sampleKeys.flatMap((key) => {
            const prediction = byKey.get(key);
            return prediction ? [{ symbol, ...prediction }] : [];
          });
        }
      );
      const modelScore = metric(
        predictions,
        (prediction) => prediction.predictedLogReturn
      );
      const statisticalScore = metric(predictions, (prediction) => {
        if (prediction.baselinePredictedLogReturn === undefined)
          throw new Error('A common origin is missing its statistical baseline.');
        return prediction.baselinePredictedLogReturn;
      });
      const noChangeScore = metric(predictions, () => 0);
      if (!modelScore || !statisticalScore || !noChangeScore)
        throw new Error(`Could not score all models for ${name}.`);
      for (const [model, scored] of [
        [modelName, modelScore],
        ['Statistical baseline', statisticalScore],
        ['No-change', noChangeScore],
      ] as const) {
        summaryRows.push({
          horizon: name,
          model,
          feature_set: featureSet,
          history_months: run.evaluation.historyMonths,
          common_symbols: commonBySymbol.size,
          common_origin_target_samples: predictions.length,
          common_start_date: predictions.map((p) => p.originDate).sort()[0],
          common_end_date: predictions
            .map((p) => p.targetDate)
            .sort()
            .at(-1),
          development_end_exclusive: run.evaluation.developmentEndExclusive,
          samples: scored.samples,
          mape_pct: scored.mapePct,
          no_change_mape_pct:
            model === 'No-change' ? undefined : noChangeScore.mapePct,
          mae_log_return_pct_points: scored.maeLogReturnPctPoints,
          directional_accuracy_pct:
            model === 'No-change' ? undefined : scored.directionalAccuracyPct,
          interval_samples:
            model === modelName ? scored.intervalSamples : undefined,
          interval_covered:
            model === modelName ? scored.intervalCovered : undefined,
          interval_coverage_pct:
            model === modelName ? scored.intervalCoveragePct : undefined,
          beats_no_change:
            model === 'No-change'
              ? undefined
              : scored.mapePct < noChangeScore.mapePct,
        });
      }
      for (const [symbol, sampleKeys] of commonBySymbol) {
        const byKey = byFeature.get(featureSet)!.get(symbol)!;
        const symbolPredictions = sampleKeys.flatMap((key) => {
          const prediction = byKey.get(key);
          return prediction ? [prediction] : [];
        });
        const baseline = metric(symbolPredictions, () => 0);
        for (const [model, select] of [
          [
            modelName,
            (prediction: Prediction) => prediction.predictedLogReturn,
          ],
          [
            'Statistical baseline',
            (prediction: Prediction) => {
              if (prediction.baselinePredictedLogReturn === undefined)
                throw new Error(`Missing baseline for ${symbol}.`);
              return prediction.baselinePredictedLogReturn;
            },
          ],
          ['No-change', () => 0],
        ] as const) {
          const scored = metric(symbolPredictions, select);
          if (!scored) continue;
          symbolRows.push({
            symbol,
            horizon: name,
            model,
            feature_set: featureSet,
            common_origin_target_samples: scored.samples,
            mape_pct: scored.mapePct,
            no_change_mape_pct:
              model === 'No-change' ? undefined : baseline?.mapePct,
            mae_log_return_pct_points: scored.maeLogReturnPctPoints,
            directional_accuracy_pct:
              model === 'No-change' ? undefined : scored.directionalAccuracyPct,
            interval_samples:
              model === modelName ? scored.intervalSamples : undefined,
            interval_covered:
              model === modelName ? scored.intervalCovered : undefined,
            interval_coverage_pct:
              model === modelName ? scored.intervalCoveragePct : undefined,
          });
        }
      }
    }
  }

  await mkdir(resultsDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(resultsDirectory, 'forecast-volume-ablation-comparison.csv'),
      csv(summaryRows, Object.keys(summaryRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-volume-ablation-by-symbol.csv'),
      csv(symbolRows, Object.keys(symbolRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-volume-ablation-eligibility.csv'),
      csv(eligibilityRows, Object.keys(eligibilityRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-volume-ablation-comparison.svg'),
      renderChart(summaryRows, sampleCounts),
      'utf8'
    ),
  ]);
  console.log(
    `Exported volume results using ${sampleCounts
      .map((value) => value.toLocaleString('en-US'))
      .join('/')} next-day/week pairs over ${commonBySymbolCount(summaryRows)} symbols.`
  );
}

function commonBySymbolCount(rows: Record<string, unknown>[]): number {
  return Number(rows[0]?.common_symbols ?? 0);
}

exportResults().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Volume results export failed.'
  );
  process.exitCode = 1;
});

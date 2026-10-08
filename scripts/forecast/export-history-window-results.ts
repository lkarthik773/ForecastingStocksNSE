import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

interface Prediction {
  symbol: string;
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  baselinePredictedLogReturn?: number;
  actualLogReturn: number;
  predictionIntervalRadius?: number;
}

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

interface Run {
  generatedAt: string;
  evaluation: {
    developmentEndExclusive: string;
    laterHistoricalWindowExcludedStart?: string;
    laterHistoricalWindowExcludedEndExclusive?: string;
    prospectiveHoldoutStart?: string;
    prospectiveHoldoutEndExclusive?: string;
    prospectiveHoldoutStatus?: string;
    historyMonths: number[];
  };
  results: WindowResult[];
}

const outputDirectory = resolve(
  process.env.FORECAST_BENCHMARK_DIR ??
    'node_modules/.cache/forecast-benchmark'
);
const resultsDirectory = resolve('results');
const horizons = [
  { name: 'next_day', sessions: 1 },
  { name: 'week', sessions: 5 },
] as const;
const models = ['LightGBM technical', 'Statistical baseline', 'No-change'] as const;

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

function renderComparisonChart(
  rows: Record<string, unknown>[],
  sampleCounts: number[]
): string {
  const horizons = [
    { name: 'next_day', label: 'Next trading day', x: 55, max: 1.6 },
    { name: 'week', label: 'Next 5 trading days', x: 575, max: 5 },
  ] as const;
  const modelNames = [
    'No-change',
    'Statistical baseline',
    'LightGBM technical',
  ] as const;
  const colors: Record<(typeof modelNames)[number], string> = {
    'No-change': '#8794a8',
    'Statistical baseline': '#e3a52f',
    'LightGBM technical': '#3677c8',
  };
  const windows = [36, 60, 120] as const;
  const getMape = (horizon: string, model: string, months: number) => {
    const row = rows.find(
      (item) =>
        item.horizon === horizon &&
        item.model === model &&
        item.history_months === months
    );
    const value = row?.mape_pct;
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new Error(
        `Missing MAPE for ${horizon}, ${model}, ${months}-month history.`
      );
    return value;
  };
  const panel = horizons
    .map(({ name, label, x, max }, panelIndex) => {
      const plotTop = 205;
      const plotBottom = 465;
      const plotHeight = plotBottom - plotTop;
      const plotLeft = x + 58;
      const plotWidth = 405;
      const y = (value: number) => plotBottom - (value / max) * plotHeight;
      const sampleCount = sampleCounts[panelIndex].toLocaleString('en-US');
      const ticks = [0, max / 4, max / 2, (max * 3) / 4, max]
        .map((tick) => {
          const tickY = y(tick);
          return `<line x1="${plotLeft}" y1="${tickY}" x2="${plotLeft + plotWidth}" y2="${tickY}" stroke="#e1e6ed"/><text x="${plotLeft - 9}" y="${tickY + 4}" class="axis" text-anchor="end">${tick.toFixed(1)}%</text>`;
        })
        .join('\n');
      const bars = windows
        .map((months, groupIndex) => {
          const center = plotLeft + 80 + groupIndex * 125;
          const groupBars = modelNames
            .map((model, modelIndex) => {
              const value = getMape(name, model, months);
              const barWidth = 23;
              const barX = center - 37 + modelIndex * 26;
              const barY = y(value);
              return `<rect x="${barX}" y="${barY}" width="${barWidth}" height="${plotBottom - barY}" rx="2" fill="${colors[model]}"/><text x="${barX + barWidth / 2}" y="${barY - 7}" class="value" text-anchor="middle">${value.toFixed(2)}%</text>`;
            })
            .join('\n');
          return `${groupBars}\n<text x="${center}" y="${plotBottom + 24}" class="category" text-anchor="middle">${months} months</text>`;
        })
        .join('\n');
      return `<g>
  <text x="${x}" y="150" class="panel">${label} | ${sampleCount} shared comparisons</text>
  <text x="${x}" y="172" class="subtitle">Average price-estimate error (MAPE); lower is better</text>
  ${ticks}
  <line x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}" stroke="#687386"/>
  <line x1="${plotLeft}" y1="${plotBottom}" x2="${plotLeft + plotWidth}" y2="${plotBottom}" stroke="#687386"/>
  ${bars}
</g>`;
    })
    .join('\n');
  const legend = modelNames
    .map(
      (model, index) =>
        `<rect x="${205 + index * 230}" y="535" width="14" height="14" rx="2" fill="${colors[model]}"/><text x="${226 + index * 230}" y="547" class="legend">${model}</text>`
    )
    .join('\n');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="640" style="max-width:100%;height:auto;display:block" viewBox="0 0 1100 640" role="img" aria-labelledby="title description">
<title id="title">Does a longer price history improve the stock forecasts?</title>
<desc id="description">Mean absolute percentage error for three model approaches trained on 36, 60, and 120 months of data, compared on identical dates across 29 NSE stocks. Lower is better. The no-change baseline has the lowest error.</desc>
<style>
  text{font-family:Arial,Helvetica,sans-serif;fill:#263244}
  .title{font-size:26px;font-weight:700}
  .subtitle{font-size:14px;fill:#596579}
  .panel{font-size:18px;font-weight:700}
  .axis{font-size:12px;fill:#596579}
  .value{font-size:11px;font-weight:700}
  .category{font-size:13px;font-weight:600}
  .legend{font-size:14px}
</style>
<rect width="1100" height="640" fill="#fff"/>
<text x="55" y="48" class="title">Does a longer price history improve the stock forecasts?</text>
<text x="55" y="76" class="subtitle">Same 29 NSE stocks and exact forecast dates for each history length; fixed 14-month train / 3-month test / 6-month advance schedule.</text>
<text x="55" y="100" class="subtitle">The bars show MAPE (%). No-change means keeping the last close; lower values are better.</text>
${panel}
${legend}
<text x="55" y="590" class="subtitle">The technical model does not beat the no-change baseline at either horizon for any tested history length.</text>
<text x="55" y="614" class="subtitle">Directional accuracy, interval coverage, symbol-level results and holdout status are in the accompanying CSV files. Historical results do not predict future performance.</text>
</svg>
`;
}

function predictionKey(prediction: Prediction): string {
  return `${prediction.symbol}\u0000${prediction.originDate}\u0000${prediction.targetDate}`;
}

function metric(
  predictions: Prediction[],
  model: (prediction: Prediction) => number
) {
  if (!predictions.length) return undefined;
  const returns = predictions.map((prediction) => ({
    predictedLogReturn: model(prediction),
    actualLogReturn: prediction.actualLogReturn,
  }));
  const score = scoreForecastReturns(returns);
  const interval = predictions.filter(
    (prediction) => prediction.predictionIntervalRadius !== undefined
  );
  const covered = interval.filter(
    (prediction) =>
      Math.abs(
        prediction.actualLogReturn - prediction.predictedLogReturn
      ) <= prediction.predictionIntervalRadius!
  ).length;
  return {
    samples: score.samples,
    mapePct: score.meanAbsolutePercentageError,
    maeLogReturnPctPoints: score.meanAbsoluteLogReturnErrorPct,
    directionalAccuracyPct: score.directionalAccuracyPct,
    intervalSamples: interval.length,
    intervalCovered: covered,
    intervalCoveragePct: interval.length
      ? (covered / interval.length) * 100
      : undefined,
  };
}

async function latestRun(): Promise<Run> {
  const names = (await readdir(outputDirectory))
    .filter(
      (name) =>
        name.startsWith('history-window-benchmark-') && name.endsWith('.json')
    )
    .sort()
    .reverse();
  if (!names.length)
    throw new Error('No history-window benchmark run was found.');
  return JSON.parse(
    await readFile(join(outputDirectory, names[0]), 'utf8')
  ) as Run;
}

async function exportHistoryWindowResults() {
  const run = await latestRun();
  const expectedRuns = run.evaluation.historyMonths.length * 29;
  if (run.results.length < expectedRuns)
    throw new Error(
      `History-window benchmark is incomplete: found ${run.results.length} of ${expectedRuns} symbol/window runs.`
    );
  const expectedSymbols = new Set(
    run.results.map((result) => result.symbol)
  );
  const failed = run.results.filter((result) => result.status !== 'ok');
  await mkdir(resultsDirectory, { recursive: true });
  const summaryRows: Record<string, unknown>[] = [];
  const symbolRows: Record<string, unknown>[] = [];
  const eligibilityRows: Record<string, unknown>[] = [];
  const holdoutRows: Record<string, unknown>[] = [];
  const commonSampleCounts: number[] = [];

  for (const result of run.results) {
    eligibilityRows.push({
      symbol: result.symbol,
      history_months: result.historyMonths,
      eligible: result.status === 'ok',
      first_observation: result.firstDate,
      last_observation: result.lastDate,
      observations: result.observationCount,
      corporate_action_adjustment_events:
        result.corporateActionAdjustmentEvents,
      intraday_reversal_candles: result.intradayReversalCandles,
      corporate_action_adjustment_status:
        result.corporateActionAdjustmentStatus,
      next_day_scored_folds: result.scoredFolds?.next_day,
      next_day_skipped_folds: result.skippedFolds?.next_day,
      week_scored_folds: result.scoredFolds?.week,
      week_skipped_folds: result.skippedFolds?.week,
      first_next_day_test: result.firstScoredTestStart?.next_day,
      first_week_test: result.firstScoredTestStart?.week,
      error: result.error,
    });
  }
  holdoutRows.push({
    holdout_start: run.evaluation.laterHistoricalWindowExcludedStart ?? '2026-04-06',
    holdout_end_exclusive:
      run.evaluation.laterHistoricalWindowExcludedEndExclusive ?? '2026-10-06',
    status:
      'Historical period excluded from this comparison but not an untouched holdout.',
    fetched_or_scored: false,
    reason:
      'This date range was already examined in the prior Phase 1 benchmark. It is reported as excluded here, not claimed as unseen.',
  });
  holdoutRows.push({
    holdout_start: run.evaluation.prospectiveHoldoutStart ?? '2026-10-07',
    holdout_end_exclusive:
      run.evaluation.prospectiveHoldoutEndExclusive ?? '2027-04-07',
    status:
      run.evaluation.prospectiveHoldoutStatus ??
      'Reserved for prospective evaluation after its data becomes available; not fetched or scored.',
    fetched_or_scored: false,
    reason:
      'A genuinely untouched forward holdout cannot be evaluated until these observations exist.',
  });

  for (const { name, sessions } of horizons) {
    const eligible = run.results.filter(
      (result) => result.status === 'ok'
    );
    const byWindow = new Map(
      run.evaluation.historyMonths.map((historyMonths) => [
        historyMonths,
        new Map(
          eligible
            .filter((result) => result.historyMonths === historyMonths)
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
    const commonKeysBySymbol = new Map<string, string[]>();
    for (const symbol of expectedSymbols) {
      const predictionSets = run.evaluation.historyMonths.map(
        (historyMonths) => byWindow.get(historyMonths)?.get(symbol)
      );
      if (predictionSets.some((predictions) => !predictions)) continue;
      const shared = [...predictionSets[0]!.keys()].filter((key) =>
        predictionSets.slice(1).every((set) => set!.has(key))
      );
      commonKeysBySymbol.set(symbol, shared);
    }
    const commonSamples = [...commonKeysBySymbol.values()].reduce(
      (total, keys) => total + keys.length,
      0
    );
    commonSampleCounts.push(commonSamples);
    if (!commonSamples)
      throw new Error(`No common ${name} forecast origins across windows.`);

    for (const historyMonths of run.evaluation.historyMonths) {
      const commonPredictions = [...commonKeysBySymbol.entries()].flatMap(
        ([symbol, keys]) =>
          keys.flatMap((key) => {
            const prediction = byWindow.get(historyMonths)?.get(symbol)?.get(key);
            return prediction ? [prediction] : [];
          })
      );
      for (const modelName of models) {
        const select =
          modelName === 'LightGBM technical'
            ? (prediction: Prediction) => prediction.predictedLogReturn
            : modelName === 'Statistical baseline'
              ? (prediction: Prediction) => {
                  if (prediction.baselinePredictedLogReturn === undefined)
                    throw new Error(
                      'A shared prediction is missing its causal statistical baseline.'
                    );
                  return prediction.baselinePredictedLogReturn;
                }
              : () => 0;
        const scored = metric(commonPredictions, select);
        if (!scored)
          throw new Error(
            `No common predictions to score for ${historyMonths} months.`
          );
        const noChange = metric(commonPredictions, () => 0);
        summaryRows.push({
          horizon: name,
          model: modelName,
          history_months: historyMonths,
          common_symbols: commonKeysBySymbol.size,
          common_origin_target_samples: commonPredictions.length,
          common_start_date: commonPredictions
            .map((prediction) => prediction.originDate)
            .sort()[0],
          common_end_date: commonPredictions
            .map((prediction) => prediction.targetDate)
            .sort()
            .at(-1),
          development_end_exclusive: run.evaluation.developmentEndExclusive,
          prospective_holdout_start:
            run.evaluation.prospectiveHoldoutStart ?? '2026-10-07',
          samples: scored.samples,
          mape_pct: scored.mapePct,
          no_change_mape_pct:
            modelName === 'No-change' ? undefined : noChange?.mapePct,
          mae_log_return_pct_points: scored.maeLogReturnPctPoints,
          directional_accuracy_pct:
            modelName === 'No-change'
              ? undefined
              : scored.directionalAccuracyPct,
          interval_samples:
            modelName === 'LightGBM technical'
              ? scored.intervalSamples
              : undefined,
          interval_covered:
            modelName === 'LightGBM technical'
              ? scored.intervalCovered
              : undefined,
          interval_coverage_pct:
            modelName === 'LightGBM technical'
              ? scored.intervalCoveragePct
              : undefined,
          beats_no_change:
            modelName === 'No-change'
              ? undefined
              : scored.mapePct < (noChange?.mapePct ?? Infinity),
        });

        for (const symbol of commonKeysBySymbol.keys()) {
          const predictions = commonKeysBySymbol
            .get(symbol)!
            .flatMap((key) => {
              const prediction = byWindow
                .get(historyMonths)
                ?.get(symbol)
                ?.get(key);
              return prediction ? [prediction] : [];
            });
          const symbolScore = metric(predictions, select);
          const symbolNoChange = metric(predictions, () => 0);
          if (!symbolScore) continue;
          symbolRows.push({
            symbol,
            horizon: name,
            model: modelName,
            history_months: historyMonths,
            common_origin_target_samples: symbolScore.samples,
            mape_pct: symbolScore.mapePct,
            no_change_mape_pct:
              modelName === 'No-change'
                ? undefined
                : symbolNoChange?.mapePct,
            mae_log_return_pct_points: symbolScore.maeLogReturnPctPoints,
            directional_accuracy_pct:
              modelName === 'No-change'
                ? undefined
                : symbolScore.directionalAccuracyPct,
            interval_samples:
              modelName === 'LightGBM technical'
                ? symbolScore.intervalSamples
                : undefined,
            interval_covered:
              modelName === 'LightGBM technical'
                ? symbolScore.intervalCovered
                : undefined,
            interval_coverage_pct:
              modelName === 'LightGBM technical'
                ? symbolScore.intervalCoveragePct
                : undefined,
          });
        }
      }
    }
  }

  const summaryColumns = Object.keys(summaryRows[0] ?? {});
  const symbolColumns = Object.keys(symbolRows[0] ?? {});
  await Promise.all([
    writeFile(
      join(resultsDirectory, 'forecast-history-window-comparison.csv'),
      csv(summaryRows, summaryColumns),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-history-window-by-symbol.csv'),
      csv(symbolRows, symbolColumns),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-history-window-eligibility.csv'),
      csv(eligibilityRows, Object.keys(eligibilityRows[0] ?? {})),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-final-holdout.csv'),
      csv(holdoutRows, Object.keys(holdoutRows[0] ?? {})),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-history-window-comparison.svg'),
      renderComparisonChart(summaryRows, commonSampleCounts),
      'utf8'
    ),
  ]);
  console.log(
    `Exported common-date history comparison using ${commonSampleCounts
      .map((count) => count.toLocaleString('en-US'))
      .join('/')} shared origin/target pairs for next-day/week. ${failed.length} symbol/window runs failed.`
  );
  if (failed.length) process.exitCode = 1;
}

exportHistoryWindowResults().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : 'History-window results export failed.'
  );
  process.exitCode = 1;
});

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ForecastReturnScore } from '../../src/forecast/evaluation.js';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

interface Prediction {
  symbol: string;
  horizon: number;
  originDate: string;
  targetDate: string;
  predictedLogReturn: number;
  baselinePredictedLogReturn: number;
  actualLogReturn: number;
  fold: number;
  predictionIntervalRadius?: number;
}

interface Fold {
  horizon: 'next_day' | 'week';
  trainStart: string;
  trainEndExclusive: string;
  testStart: string;
  testEndExclusive: string;
  candidateTrainRows: number;
  candidateTestRows: number;
  trainRows: number;
  testRows: number;
  qualityExcludedTrainRows: number;
  qualityExcludedTestRows: number;
  status: string;
  scoredRows: number;
  missingScoredRows: number;
  unscoredCalendarDaysBeforeNextFold?: number;
}

interface SymbolResult {
  symbol: string;
  status: 'ok' | 'error';
  error?: string;
  history?: {
    requestedMonths: number;
    firstDate: string;
    lastDate: string;
    observations: number;
    corporateActionAdjustments: {
      exDate: string;
      subject: string;
      shareFactor: number;
    }[];
    dataQuality: {
      corporateActionAdjustment: string;
      corporateActionAdjustments: {
        exDate: string;
        subject: string;
        shareFactor: number;
      }[];
      intradayReversalCandles: {
        date: string;
        open: number;
        high: number;
        low: number;
        close: number;
        rangePctOfOpen: number;
        bodyPctOfOpen: number;
        bodyPctOfRange: number;
      }[];
      nonEquityRows: number;
      largeDailyChanges: {
        fromDate: string;
        toDate: string;
        changePct: number;
      }[];
    };
  };
  folds?: Record<'next_day' | 'week', Fold[]>;
  predictions: Prediction[];
}

interface Run {
  schedule: string;
  generatedAt: string;
  historyMonths: number;
  universe: string[];
  results: SymbolResult[];
}

const outputDirectory = resolve(
  process.env.FORECAST_BENCHMARK_DIR ?? 'node_modules/.cache/forecast-benchmark'
);
const resultsDirectory = resolve('results');
const horizons = [
  { name: 'next_day', sessions: 1 },
  { name: 'week', sessions: 5 },
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

async function latestRun(schedule: string, adjustment: 'applied' | 'raw'): Promise<Run> {
  const names = (await readdir(outputDirectory))
    .filter((name) => name.startsWith(`benchmark-${schedule}-`) && name.endsWith('.json'))
    .sort()
    .reverse();
  for (const name of names) {
    const path = join(outputDirectory, name);
    const run = JSON.parse(await readFile(path, 'utf8')) as Run;
    const status =
      run.results.find((result) => result.history)?.history?.dataQuality
        .corporateActionAdjustment;
    if (
      (adjustment === 'applied' && status === 'applied') ||
      (adjustment === 'raw' && status !== 'applied')
    )
      return run;
  }
  throw new Error(`No ${adjustment} ${schedule} benchmark JSON was found.`);
}

function score(
  predictions: Prediction[],
  model: 'lightgbm' | 'statistical' | 'no_change'
): ForecastReturnScore | undefined {
  if (!predictions.length) return undefined;
  return scoreForecastReturns(
    predictions.map((prediction) => ({
      predictedLogReturn:
        model === 'lightgbm'
          ? prediction.predictedLogReturn
          : model === 'statistical'
            ? prediction.baselinePredictedLogReturn
            : 0,
      actualLogReturn: prediction.actualLogReturn,
    }))
  );
}

function summaryRow(
  run: Run,
  symbol: string,
  horizon: 'next_day' | 'week',
  model: 'LightGBM technical' | 'Statistical baseline' | 'No-change',
  predictions: Prediction[],
  eligibleSymbols: number,
  failedSymbols: number,
  flaggedCandles: number,
  scoredFolds: number,
  skippedFolds: number,
  excludedTrain: number,
  excludedTest: number,
  unscoredEligible: number
) {
  const modelKey =
    model === 'LightGBM technical'
      ? 'lightgbm'
      : model === 'Statistical baseline'
        ? 'statistical'
        : 'no_change';
  const result = score(predictions, modelKey);
  const baseline = score(predictions, 'no_change');
  const interval = predictions.filter(
    (prediction) => prediction.predictionIntervalRadius !== undefined
  );
  const intervalCovered = interval.filter(
    (prediction) =>
      Math.abs(prediction.actualLogReturn - prediction.predictedLogReturn) <=
      prediction.predictionIntervalRadius!
  ).length;
  return {
    schedule:
      run.schedule === 'current-schedule'
        ? '6-month advance'
        : '3-month advance diagnostic',
    horizon,
    ...(symbol === 'ALL' ? {} : { symbol }),
    model,
    successful_symbols: eligibleSymbols,
    failed_symbols: failedSymbols,
    flagged_candles: flaggedCandles,
    scored_folds: scoredFolds,
    skipped_folds: skippedFolds,
    quality_excluded_train_sample_rows: excludedTrain,
    quality_excluded_test_sample_rows: excludedTest,
    unscored_eligible_test_rows: unscoredEligible,
    samples: result?.samples ?? 0,
    mape_pct: result?.meanAbsolutePercentageError,
    no_change_mape_pct:
      model === 'No-change'
        ? undefined
        : baseline?.meanAbsolutePercentageError,
    mean_absolute_log_return_error_pct: result?.meanAbsoluteLogReturnErrorPct,
    directional_accuracy_pct:
      model === 'No-change' ? undefined : result?.directionalAccuracyPct,
    interval_samples:
      model === 'LightGBM technical' ? interval.length : undefined,
    interval_covered:
      model === 'LightGBM technical' ? intervalCovered : undefined,
    interval_coverage_pct:
      model === 'LightGBM technical' && interval.length
        ? (intervalCovered / interval.length) * 100
        : undefined,
    beats_no_change:
      model === 'No-change'
        ? undefined
        : result && baseline
          ? result.meanAbsolutePercentageError <
            baseline.meanAbsolutePercentageError
          : undefined,
  };
}

function resultPredictions(result: SymbolResult, sessions: number): Prediction[] {
  return result.predictions.filter((prediction) => prediction.horizon === sessions);
}

async function exportResults() {
  const current = await latestRun('current-schedule', 'applied');
  const currentRaw = await latestRun('current-schedule', 'raw');
  const gapFree = await latestRun('gap-free-diagnostic', 'applied');
  const gapFreeRaw = await latestRun('gap-free-diagnostic', 'raw');
  const runs = [current, gapFree];
  const rawRuns = [currentRaw, gapFreeRaw];
  for (const run of runs) {
    if (run.results.some(
      (result) =>
        result.status === 'ok' &&
        result.history?.dataQuality.corporateActionAdjustment !== 'applied'
    ))
      throw new Error(`${run.schedule} run contains a symbol without action adjustment.`);
  }
  await mkdir(resultsDirectory, { recursive: true });

  const comparison: Record<string, unknown>[] = [];
  const perSymbol: Record<string, unknown>[] = [];
  const folds: Record<string, unknown>[] = [];
  const eligibility: Record<string, unknown>[] = [];
  const actionAudit: Record<string, unknown>[] = [];
  const intradayAudit: Record<string, unknown>[] = [];
  const matchedComparison: Record<string, unknown>[] = [];
  const auditedActions = new Set<string>();
  const auditedCandles = new Set<string>();
  for (const [runIndex, run] of runs.entries()) {
    const rawRun = rawRuns[runIndex];
    const eligibleSymbols = run.results.filter(
      (result) => result.status === 'ok'
    ).length;
    const failedSymbols = run.results.length - eligibleSymbols;
    const flaggedCandles = run.results.reduce(
      (total, result) =>
        total + (result.history?.dataQuality.intradayReversalCandles.length ?? 0),
      0
    );
    for (const result of run.results) {
      const quality = result.history?.dataQuality;
      eligibility.push({
        schedule: run.schedule,
        symbol: result.symbol,
        eligible: result.status === 'ok',
        instrument:
          result.status === 'ok' &&
          (result.history?.dataQuality.nonEquityRows ?? 0) === 0
            ? 'NSE EQ'
            : 'unverified',
        observations: result.history?.observations,
        history_months: result.history?.requestedMonths,
        next_day_scored_folds:
          result.folds?.next_day.filter((fold) => fold.status === 'scored')
            .length ?? 0,
        next_day_skipped_folds:
          result.folds?.next_day.filter((fold) => fold.status !== 'scored')
            .length ?? 0,
        week_scored_folds:
          result.folds?.week.filter((fold) => fold.status === 'scored')
            .length ?? 0,
        week_skipped_folds:
          result.folds?.week.filter((fold) => fold.status !== 'scored')
            .length ?? 0,
        action_adjustments:
          result.history?.corporateActionAdjustments.length ?? 0,
        exclusion_reason: result.status === 'ok' ? '' : result.error,
        data_adjustment_status: quality?.corporateActionAdjustment,
      });
    }
    eligibility.push({
      schedule: run.schedule,
      symbol: 'TATAMOTORS',
      eligible: false,
      instrument: 'historical response symbol mismatch',
      observations: '',
      history_months: run.historyMonths,
      next_day_scored_folds: 0,
      next_day_skipped_folds: 0,
      week_scored_folds: 0,
      week_skipped_folds: 0,
      action_adjustments: 0,
      exclusion_reason:
        "Excluded at the user's prior direction because the historical endpoint did not return the requested instrument.",
      data_adjustment_status: '',
    });
    for (const { name, sessions } of horizons) {
      const horizonResults = run.results.filter(
        (result) => result.status === 'ok'
      );
      const horizonFolds = horizonResults.flatMap(
        (result) => result.folds?.[name] ?? []
      );
      const scoredFolds = horizonFolds.filter(
        (fold) => fold.status === 'scored'
      ).length;
      const skippedFolds = horizonFolds.length - scoredFolds;
      const excludedTrain = horizonFolds.reduce(
        (sum, fold) => sum + fold.qualityExcludedTrainRows,
        0
      );
      const excludedTest = horizonFolds.reduce(
        (sum, fold) => sum + fold.qualityExcludedTestRows,
        0
      );
      const unscoredEligible = horizonFolds
        .filter((fold) => fold.status !== 'scored')
        .reduce((sum, fold) => sum + fold.testRows, 0);
      const allPredictions = horizonResults.flatMap((result) =>
        resultPredictions(result, sessions)
      );
      for (const model of [
        'LightGBM technical',
        'Statistical baseline',
        'No-change',
      ] as const)
        comparison.push(
          summaryRow(
            run,
            'ALL',
            name,
            model,
            allPredictions,
            eligibleSymbols,
            failedSymbols,
            flaggedCandles,
            scoredFolds,
            skippedFolds,
            excludedTrain,
            excludedTest,
            unscoredEligible
          )
        );

      for (const result of horizonResults) {
        const symbolFolds = result.folds?.[name] ?? [];
        const symbolPredictions = resultPredictions(result, sessions);
        const symbolScoredFolds = symbolFolds.filter(
          (fold) => fold.status === 'scored'
        ).length;
        const symbolSkippedFolds = symbolFolds.length - symbolScoredFolds;
        const symbolExcludedTrain = symbolFolds.reduce(
          (sum, fold) => sum + fold.qualityExcludedTrainRows,
          0
        );
        const symbolExcludedTest = symbolFolds.reduce(
          (sum, fold) => sum + fold.qualityExcludedTestRows,
          0
        );
        const symbolUnscoredEligible = symbolFolds
          .filter((fold) => fold.status !== 'scored')
          .reduce((sum, fold) => sum + fold.testRows, 0);
        for (const model of [
          'LightGBM technical',
          'Statistical baseline',
          'No-change',
        ] as const)
          perSymbol.push(
            summaryRow(
              run,
              result.symbol,
              name,
              model,
              symbolPredictions,
              1,
              0,
              result.history?.dataQuality.intradayReversalCandles.length ?? 0,
              symbolScoredFolds,
              symbolSkippedFolds,
              symbolExcludedTrain,
              symbolExcludedTest,
              symbolUnscoredEligible
            )
          );

        for (const fold of symbolFolds) {
          const selected = symbolPredictions.filter(
            (prediction) => prediction.fold === symbolFolds.indexOf(fold)
          );
          const lightgbm = score(selected, 'lightgbm');
          const statistical = score(selected, 'statistical');
          const noChange = score(selected, 'no_change');
          const interval = selected.filter(
            (prediction) => prediction.predictionIntervalRadius !== undefined
          );
          const covered = interval.filter(
            (prediction) =>
              Math.abs(
                prediction.actualLogReturn - prediction.predictedLogReturn
              ) <= prediction.predictionIntervalRadius!
          ).length;
          folds.push({
            schedule: run.schedule,
            symbol: result.symbol,
            horizon: name,
            train_start: fold.trainStart,
            train_end_exclusive: fold.trainEndExclusive,
            test_start: fold.testStart,
            test_end_exclusive: fold.testEndExclusive,
            status: fold.status,
            candidate_train_rows: fold.candidateTrainRows,
            eligible_train_rows: fold.trainRows,
            quality_excluded_train_rows: fold.qualityExcludedTrainRows,
            candidate_test_rows: fold.candidateTestRows,
            eligible_test_rows: fold.testRows,
            quality_excluded_test_rows: fold.qualityExcludedTestRows,
            scored_rows: fold.scoredRows,
            missing_scored_rows: fold.missingScoredRows,
            lightgbm_mape_pct: lightgbm?.meanAbsolutePercentageError,
            lightgbm_mae_log_return_pct_points:
              lightgbm?.meanAbsoluteLogReturnErrorPct,
            lightgbm_directional_accuracy_pct:
              lightgbm?.directionalAccuracyPct,
            statistical_mape_pct:
              statistical?.meanAbsolutePercentageError,
            statistical_mae_log_return_pct_points:
              statistical?.meanAbsoluteLogReturnErrorPct,
            statistical_directional_accuracy_pct:
              statistical?.directionalAccuracyPct,
            no_change_mape_pct: noChange?.meanAbsolutePercentageError,
            no_change_mae_log_return_pct_points:
              noChange?.meanAbsoluteLogReturnErrorPct,
            no_change_directional_accuracy_pct:
              noChange?.directionalAccuracyPct,
            interval_samples: interval.length,
            interval_covered: covered,
            interval_coverage_pct: interval.length
              ? (covered / interval.length) * 100
              : undefined,
            calendar_days_to_next_fold:
              fold.unscoredCalendarDaysBeforeNextFold,
          });
        }

      }
    }

    for (const result of run.results) {
      if (result.status !== 'ok' || !result.history) continue;
      const rawResult = rawRun.results.find(
        (candidate) => candidate.symbol === result.symbol
      );
      for (const action of result.history.corporateActionAdjustments) {
        const actionKey = `${result.symbol}\u0000${action.exDate}\u0000${action.subject}`;
        if (auditedActions.has(actionKey)) continue;
        auditedActions.add(actionKey);
        const rawMove = rawResult?.history?.dataQuality.largeDailyChanges.find(
          (move) => move.toDate === action.exDate
        );
        const factor = result.history.corporateActionAdjustments
          .filter((candidate) => candidate.exDate === action.exDate)
          .reduce((value, candidate) => value * candidate.shareFactor, 1);
        actionAudit.push({
          symbol: result.symbol,
          ex_date: action.exDate,
          action: action.subject,
          share_factor: action.shareFactor,
          combined_share_factor_same_date: factor,
          raw_transition_pct: rawMove?.changePct,
          action_adjusted_transition_pct:
            rawMove && factor
              ? ((1 + rawMove.changePct / 100) * factor - 1) * 100
              : undefined,
          assessment:
            rawMove && factor > 1
              ? 'Known share-count discontinuity corrected in benchmark prices.'
              : 'Share adjustment applied; no raw >25% close move recorded on ex-date.',
        });
      }
      for (const candle of rawResult?.history?.dataQuality.intradayReversalCandles ?? []) {
        const candleKey = `${result.symbol}\u0000${candle.date}`;
        if (auditedCandles.has(candleKey)) continue;
        auditedCandles.add(candleKey);
        intradayAudit.push({
          symbol: result.symbol,
          ...candle,
          screen:
            'high-low range >= 10% of open AND open-close body <= 50% of range',
        });
      }
    }
  }

  for (const run of runs) {
    const rawRun = rawRuns[runs.indexOf(run)];
    for (const { name, sessions } of horizons) {
      const adjustedPredictions = run.results.flatMap((result) =>
        result.predictions.filter(
          (prediction) => prediction.horizon === sessions
        )
      );
      const rawPredictions = rawRun.results.flatMap((result) =>
        result.predictions.filter(
          (prediction) => prediction.horizon === sessions
        )
      );
      const rawMap = new Map(
        rawPredictions.map((prediction) => [
          `${prediction.symbol}\u0000${prediction.originDate}\u0000${prediction.targetDate}`,
          prediction,
        ])
      );
      const overlap = adjustedPredictions.flatMap((adjusted) => {
        const raw = rawMap.get(
          `${adjusted.symbol}\u0000${adjusted.originDate}\u0000${adjusted.targetDate}`
        );
        return raw ? [{ raw, adjusted }] : [];
      });
      for (const model of [
        'lightgbm',
        'statistical',
        'no_change',
      ] as const) {
        const rawScore = score(
          overlap.map(({ raw }) => raw),
          model
        );
        const adjustedScore = score(
          overlap.map(({ adjusted }) => adjusted),
          model
        );
        matchedComparison.push({
          schedule: run.schedule,
          horizon: name,
          model:
            model === 'lightgbm'
              ? 'LightGBM technical'
              : model === 'statistical'
                ? 'Statistical baseline'
                : 'No-change',
          shared_origin_target_samples: overlap.length,
          raw_mape_pct: rawScore?.meanAbsolutePercentageError,
          adjusted_mape_pct: adjustedScore?.meanAbsolutePercentageError,
          raw_mae_log_return_pct_points:
            rawScore?.meanAbsoluteLogReturnErrorPct,
          adjusted_mae_log_return_pct_points:
            adjustedScore?.meanAbsoluteLogReturnErrorPct,
          raw_directional_accuracy_pct:
            model === 'no_change'
              ? undefined
              : rawScore?.directionalAccuracyPct,
          adjusted_directional_accuracy_pct:
            model === 'no_change'
              ? undefined
              : adjustedScore?.directionalAccuracyPct,
        });
      }
    }
  }

  const comparisonColumns = [
    'schedule',
    'horizon',
    'model',
    'successful_symbols',
    'failed_symbols',
    'flagged_candles',
    'scored_folds',
    'skipped_folds',
    'quality_excluded_train_sample_rows',
    'quality_excluded_test_sample_rows',
    'unscored_eligible_test_rows',
    'samples',
    'mape_pct',
    'no_change_mape_pct',
    'mean_absolute_log_return_error_pct',
    'directional_accuracy_pct',
    'interval_samples',
    'interval_covered',
    'interval_coverage_pct',
    'beats_no_change',
  ];
  const files = [
    ['forecast-benchmark-comparison.csv', comparison, comparisonColumns],
    [
      'forecast-benchmark-by-symbol.csv',
      perSymbol,
      ['symbol', ...comparisonColumns.filter((column) => !['successful_symbols', 'failed_symbols'].includes(column))],
    ],
    [
      'forecast-benchmark-folds.csv',
      folds,
      Object.keys(folds[0] ?? {}),
    ],
    [
      'forecast-benchmark-eligibility.csv',
      eligibility,
      Object.keys(eligibility[0] ?? {}),
    ],
    [
      'forecast-corporate-action-adjustment.csv',
      actionAudit,
      Object.keys(actionAudit[0] ?? {}),
    ],
    [
      'forecast-intraday-reversal-audit.csv',
      intradayAudit,
      Object.keys(intradayAudit[0] ?? {}),
    ],
    [
      'forecast-benchmark-raw-vs-adjusted.csv',
      matchedComparison,
      Object.keys(matchedComparison[0] ?? {}),
    ],
  ] as const;
  for (const [name, rows, columns] of files)
    await writeFile(
      join(resultsDirectory, name),
      csv(rows, [...columns]),
      'utf8'
    );
  console.log(
    `Exported adjusted and matched-date benchmark reports to ${resultsDirectory}.`
  );
}

exportResults().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Benchmark export failed.'
  );
  process.exitCode = 1;
});

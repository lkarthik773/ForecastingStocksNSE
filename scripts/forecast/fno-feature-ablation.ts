import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  configureFnoArchiveOptionsForBenchmark,
  configureFnoFeatureLookbacksForBenchmark,
  configureForecastFeatureSetForBenchmark,
  configureFnoFeatureSetForBenchmark,
  ForecastApi,
  type ForecastResult,
} from '../../src/forecast/forecast-api.js';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';
import {
  FNO_FEATURE_NAMES,
  type FnoFeatureLookbacks,
  type FnoFeatures,
} from '../../src/forecast/fno-features.js';
import type { FnoArchiveOptions } from '../../src/forecast/fno-archive.js';
import type { TrainingFeatureSet } from '../../src/forecast/trained-forecast.js';

const symbols = (
  process.env.FORECAST_FNO_ABLATION_SYMBOLS ??
  'TCS,INFY,HDFCBANK,RELIANCE,WIPRO'
)
  .split(',')
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const historyMonths = Number(
  process.env.FORECAST_FNO_ABLATION_HISTORY_MONTHS ?? 60
);
const stepMonths = Number(
  process.env.FORECAST_FNO_ABLATION_STEP_MONTHS ?? 3
);
const delayMs = Number(process.env.FORECAST_FNO_ABLATION_DELAY_MS ?? 1500);
const asOfDate = new Date().toISOString().slice(0, 10);
const optionFeatures = new Set<keyof FnoFeatures>([
  'callOIChangePct',
  'putOIChangePct',
  'putCallRatio',
  'putCallRatioTrend',
  'putCallVolumeRatio',
  'callOIExtreme',
  'putOIExtreme',
  'oiSkewFavorsCall',
  'oiSkewFavorsPut',
  'callVolumeRelative',
  'putVolumeRelative',
  'callPutStrength',
  'oiBias',
]);

type VariantId =
  | 'technical'
  | 'technical_futures'
  | 'technical_fno'
  | 'archive_futures_only'
  | 'options_only'
  | 'without_pcr'
  | 'without_options_volume'
  | 'without_futures_premium'
  | 'without_futures_oi'
  | 'premium_lookback_3day'
  | 'oi_lookback_3_10day'
  | 'premium_oi_lookback_3_10day'
  | 'options_front_expiry'
  | 'options_front_expiry_atm';

interface Variant {
  id: VariantId;
  label: string;
  model: 'technical' | 'technical_futures' | 'technical_fno';
  featureSet: TrainingFeatureSet;
  includedFnoFeatures?: readonly (keyof FnoFeatures)[];
  fnoLookbacks?: FnoFeatureLookbacks;
  fnoArchiveOptions?: FnoArchiveOptions;
  color: string;
}

const variants: Variant[] = [
  {
    id: 'technical',
    label: 'Technical baseline',
    model: 'technical',
    featureSet: 'close_only',
    color: '#8794a8',
  },
  {
    id: 'technical_futures',
    label: 'Historical futures',
    model: 'technical_futures',
    featureSet: 'technical_futures',
    color: '#2d8b72',
  },
  {
    id: 'technical_fno',
    label: 'All archive F&O',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES,
    color: '#3677c8',
  },
  {
    id: 'archive_futures_only',
    label: 'Archive futures group',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter(
      (name) => !optionFeatures.has(name)
    ),
    color: '#4b9b68',
  },
  {
    id: 'options_only',
    label: 'Options group only',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter((name) =>
      optionFeatures.has(name)
    ),
    color: '#9a69bd',
  },
  {
    id: 'without_pcr',
    label: 'All F&O, no PCR',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter(
      (name) => name !== 'putCallRatio' && name !== 'putCallRatioTrend'
    ),
    color: '#e3a52f',
  },
  {
    id: 'without_options_volume',
    label: 'All F&O, no options volume',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter(
      (name) =>
        name !== 'putCallVolumeRatio' &&
        name !== 'callVolumeRelative' &&
        name !== 'putVolumeRelative'
    ),
    color: '#d47745',
  },
  {
    id: 'without_futures_premium',
    label: 'All F&O, no premium',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter(
      (name) =>
        name !== 'futuresPremiumPct' &&
        name !== 'premiumTrendCh1Day' &&
        name !== 'premiumTrendCh5Day' &&
        name !== 'premiumSma5'
    ),
    color: '#c85962',
  },
  {
    id: 'without_futures_oi',
    label: 'All F&O, no futures OI',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter(
      (name) =>
        name !== 'totalOIChangePct' &&
        name !== 'totalOISma5' &&
        name !== 'totalOISma20' &&
        name !== 'oiMomentum' &&
        name !== 'priceUpOIUp' &&
        name !== 'priceUpOIDown' &&
        name !== 'priceDownOIUp' &&
        name !== 'priceDownOIDown'
    ),
    color: '#5887a5',
  },
  {
    id: 'premium_lookback_3day',
    label: '3-day premium lookback',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES,
    fnoLookbacks: { premium: 3, oiShort: 5, oiLong: 20 },
    color: '#1b9e77',
  },
  {
    id: 'oi_lookback_3_10day',
    label: '3/10-day OI lookbacks',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES,
    fnoLookbacks: { premium: 5, oiShort: 3, oiLong: 10 },
    color: '#66a61e',
  },
  {
    id: 'premium_oi_lookback_3_10day',
    label: '3-day premium + 3/10-day OI',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES,
    fnoLookbacks: { premium: 3, oiShort: 3, oiLong: 10 },
    color: '#a6d854',
  },
  {
    id: 'options_front_expiry',
    label: 'Options: front expiry',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter((name) =>
      optionFeatures.has(name)
    ),
    fnoArchiveOptions: { optionsAggregation: 'front-expiry' },
    color: '#7570b3',
  },
  {
    id: 'options_front_expiry_atm',
    label: 'Options: front expiry ATM',
    model: 'technical_fno',
    featureSet: 'technical_fno',
    includedFnoFeatures: FNO_FEATURE_NAMES.filter((name) =>
      optionFeatures.has(name)
    ),
    fnoArchiveOptions: { optionsAggregation: 'front-expiry-atm' },
    color: '#e7298a',
  },
];

type Prediction = NonNullable<
  ForecastResult['model']['training']
>['outOfSampleForecasts'][number];

interface VariantRun {
  symbol: string;
  variant: VariantId;
  status: 'ok' | 'error';
  error?: string;
  predictions: Prediction[];
}

interface RunFile {
  generatedAt: string;
  evaluation: {
    asOfDate: string;
    symbols: string[];
    historyMonths: number;
    stepMonths: number;
    horizonSessions: 5;
    variants: VariantId[];
    matchedOriginsAcrossAllVariants: true;
  };
  results: VariantRun[];
}

interface ScoredRow {
  symbol: string;
  variant: VariantId;
  label: string;
  pairedSamples: number;
  mapePct: number;
  directionalAccuracyPct: number;
  directionChangePp: number;
  mapeChangePp: number;
  commonStartOrigin: string;
  commonEndTarget: string;
}

const outputDirectory = resolve(
  process.env.FORECAST_BENCHMARK_DIR ??
    'node_modules/.cache/forecast-benchmark'
);
const resultsDirectory = resolve(
  process.env.FORECAST_FNO_RESULTS_DIR ?? 'results'
);
const progressPath = process.env.FORECAST_FNO_ABLATION_RESUME
  ? resolve(process.env.FORECAST_FNO_ABLATION_RESUME)
  : join(
      outputDirectory,
      `fno-feature-ablation-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    );

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function csv(rows: Record<string, unknown>[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvValue(row[column])).join(',')
    ),
  ].join('\r\n') + '\r\n';
}

function predictionKey(prediction: Prediction): string {
  return `${prediction.originDate}\u0000${prediction.targetDate}`;
}

function variantRun(
  results: VariantRun[],
  symbol: string,
  variant: VariantId
): VariantRun | undefined {
  return results.find(
    (result) => result.symbol === symbol && result.variant === variant
  );
}

function scoreRows(
  rows: Array<{ predictedLogReturn: number; actualLogReturn: number }>
) {
  const scored = scoreForecastReturns(rows);
  return {
    pairedSamples: scored.samples,
    mapePct: scored.meanAbsolutePercentageError,
    directionalAccuracyPct: scored.directionalAccuracyPct,
  };
}

function matchedScores(results: VariantRun[]): ScoredRow[] {
  const successfulSymbols = symbols.filter((symbol) =>
    variants.every(
      (variant) =>
        variantRun(results, symbol, variant.id)?.status === 'ok'
    )
  );
  const commonKeysBySymbol = new Map<string, Set<string>>();
  for (const symbol of successfulSymbols) {
    const forecasts = variants.map((variant) => {
      const run = variantRun(results, symbol, variant.id)!;
      return new Map(
        run.predictions
          .filter((prediction) => prediction.horizon === 5)
          .map((prediction) => [predictionKey(prediction), prediction])
      );
    });
    const commonKeys = new Set(forecasts[0].keys());
    for (const forecast of forecasts.slice(1))
      for (const key of commonKeys)
        if (!forecast.has(key)) commonKeys.delete(key);
    for (const key of commonKeys) {
      const actuals = forecasts.map((forecast) => forecast.get(key)!.actualLogReturn);
      if (actuals.some((actual) => Math.abs(actual - actuals[0]) > 1e-12))
        throw new Error(
          `Actual returns disagree across model runs for ${symbol}/${key}.`
        );
    }
    if (commonKeys.size) commonKeysBySymbol.set(symbol, commonKeys);
  }
  if (!commonKeysBySymbol.size)
    throw new Error(
      'No symbols have complete, matched 5-session predictions for every variant.'
    );
  const commonPairs = [...commonKeysBySymbol.values()].flatMap((keys) =>
    [...keys].map((key) => key.split('\u0000'))
  );
  const commonStartOrigin = commonPairs
    .map(([origin]) => origin)
    .sort()[0];
  const commonEndTarget = commonPairs
    .map(([, target]) => target)
    .sort()
    .at(-1)!;

  const baselineRows = [...commonKeysBySymbol.entries()].flatMap(
    ([symbol, keys]) => {
      const baseline = new Map(
        variantRun(results, symbol, 'technical')!.predictions
          .filter((prediction) => prediction.horizon === 5)
          .map((prediction) => [predictionKey(prediction), prediction])
      );
      return [...keys].map((key) => baseline.get(key)!);
    }
  );
  const baselineOverall = scoreRows(
    baselineRows.map((prediction) => ({
      predictedLogReturn: prediction.predictedLogReturn,
      actualLogReturn: prediction.actualLogReturn,
    }))
  );
  const output: ScoredRow[] = [];
  for (const variant of variants) {
    const overall = [...commonKeysBySymbol.entries()].flatMap(
      ([symbol, keys]) => {
        const byKey = new Map(
          variantRun(results, symbol, variant.id)!.predictions
            .filter((prediction) => prediction.horizon === 5)
            .map((prediction) => [predictionKey(prediction), prediction])
        );
        return [...keys].map((key) => byKey.get(key)!);
      }
    );
    const overallScore = scoreRows(
      overall.map((prediction) => ({
        predictedLogReturn: prediction.predictedLogReturn,
        actualLogReturn: prediction.actualLogReturn,
      }))
    );
    output.push({
      symbol: 'ALL',
      variant: variant.id,
      label: variant.label,
      ...overallScore,
      directionChangePp:
        overallScore.directionalAccuracyPct -
        baselineOverall.directionalAccuracyPct,
      mapeChangePp: overallScore.mapePct - baselineOverall.mapePct,
      commonStartOrigin,
      commonEndTarget,
    });
    for (const [symbol, keys] of commonKeysBySymbol) {
      const byKey = new Map(
        variantRun(results, symbol, variant.id)!.predictions
          .filter((prediction) => prediction.horizon === 5)
          .map((prediction) => [predictionKey(prediction), prediction])
      );
      const candidateScore = scoreRows(
        [...keys].map((key) => ({
          predictedLogReturn: byKey.get(key)!.predictedLogReturn,
          actualLogReturn: byKey.get(key)!.actualLogReturn,
        }))
      );
      const baselineByKey = new Map(
        variantRun(results, symbol, 'technical')!.predictions
          .filter((prediction) => prediction.horizon === 5)
          .map((prediction) => [predictionKey(prediction), prediction])
      );
      const baselineScore = scoreRows(
        [...keys].map((key) => ({
          predictedLogReturn: baselineByKey.get(key)!.predictedLogReturn,
          actualLogReturn: baselineByKey.get(key)!.actualLogReturn,
        }))
      );
      output.push({
        symbol,
        variant: variant.id,
        label: variant.label,
        ...candidateScore,
        directionChangePp:
          candidateScore.directionalAccuracyPct -
          baselineScore.directionalAccuracyPct,
        mapeChangePp: candidateScore.mapePct - baselineScore.mapePct,
        commonStartOrigin,
        commonEndTarget,
      });
    }
  }
  return output;
}

function renderChart(rows: ScoredRow[]): string {
  const overall = rows.filter((row) => row.symbol === 'ALL');
  const directionValues = overall.map((row) => row.directionalAccuracyPct);
  const mapeValues = overall.map((row) => row.mapePct);
  const directionMin = Math.max(
    0,
    Math.floor((Math.min(...directionValues) - 2) / 5) * 5
  );
  const directionMax = Math.min(
    100,
    Math.ceil((Math.max(...directionValues) + 2) / 5) * 5
  );
  const mapeMax = Math.ceil((Math.max(...mapeValues) * 1.15) / 0.5) * 0.5;
  const rowStart = 208;
  const rowHeight = 35;
  const footerY = rowStart + variants.length * rowHeight + 42;
  const chartHeight = Math.max(650, footerY + 35);
  const panels = [
    {
      title: 'Directional accuracy',
      subtitle: 'Higher is better; common origins only',
      key: 'directionalAccuracyPct' as const,
      x: 60,
      plotLeft: 330,
      plotRight: 585,
      min: directionMin,
      max: directionMax,
      ticks: 4,
      suffix: '%',
    },
    {
      title: 'MAPE',
      subtitle: 'Lower is better; common origins only',
      key: 'mapePct' as const,
      x: 625,
      plotLeft: 875,
      plotRight: 1145,
      min: 0,
      max: mapeMax,
      ticks: 5,
      suffix: '%',
    },
  ]
    .map((panel) => {
      const xFor = (value: number) =>
        panel.plotLeft +
        ((value - panel.min) / (panel.max - panel.min)) *
          (panel.plotRight - panel.plotLeft);
      const grid = Array.from({ length: panel.ticks + 1 }, (_, index) => {
        const value =
          panel.min + ((panel.max - panel.min) * index) / panel.ticks;
        const x = xFor(value);
        return `<line x1="${x}" y1="${rowStart - 14}" x2="${x}" y2="${rowStart + variants.length * rowHeight - 8}" stroke="#e1e6ed"/><text x="${x}" y="${rowStart + variants.length * rowHeight + 15}" class="axis" text-anchor="middle">${value.toFixed(1)}${panel.suffix}</text>`;
      }).join('\n');
      const bars = variants
        .map((variant, index) => {
          const row = overall.find((candidate) => candidate.variant === variant.id);
          if (!row) throw new Error(`Missing chart row for ${variant.id}.`);
          const value = row[panel.key];
          const x = xFor(value);
          const barStart = xFor(panel.min);
          const barWidth = Math.max(1, x - barStart);
          const y = rowStart + index * rowHeight;
          const isBaseline = variant.id === 'technical';
          return `<text x="${panel.x}" y="${y + 15}" class="category">${escapeXmlText(variant.label)}</text><rect x="${barStart}" y="${y}" width="${barWidth}" height="19" rx="3" fill="${variant.color}" opacity="${isBaseline ? '0.8' : '1'}"/><text x="${Math.min(x + 6, panel.plotRight - 3)}" y="${y + 15}" class="value">${value.toFixed(2)}%</text>`;
        })
        .join('\n');
      return `<g><text x="${panel.x}" y="158" class="panel">${panel.title}</text><text x="${panel.x}" y="180" class="subtitle">${panel.subtitle}</text>${grid}<line x1="${panel.plotLeft}" y1="${rowStart - 14}" x2="${panel.plotLeft}" y2="${rowStart + variants.length * rowHeight - 8}" stroke="#687386"/>${bars}</g>`;
    })
    .join('\n');
  const sampleCount = overall[0]?.pairedSamples ?? 0;
  const symbolCount = new Set(
    rows.filter((row) => row.symbol !== 'ALL').map((row) => row.symbol)
  ).size;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${chartHeight}" style="max-width:100%;height:auto;display:block" viewBox="0 0 1200 ${chartHeight}" role="img" aria-labelledby="title description">
<title id="title">Which F&amp;O feature groups improve five-session forecasts?</title>
<desc id="description">Directional accuracy and mean absolute percentage error for ${variants.length} technical and F&amp;O feature variants, scored on the same forecast origins across ${symbolCount} symbols and ${sampleCount} symbol-origin pairs.</desc>
<style>text{font-family:Arial,Helvetica,sans-serif;fill:#263244}.title{font-size:25px;font-weight:700}.subtitle{font-size:13px;fill:#596579}.panel{font-size:18px;font-weight:700}.axis{font-size:11px;fill:#596579}.value{font-size:11px;font-weight:700}.category{font-size:11px;font-weight:600}</style>
<rect width="1200" height="${chartHeight}" fill="#fff"/>
<text x="60" y="48" class="title">Which F&amp;O feature groups improve five-session forecasts?</text>
<text x="60" y="76" class="subtitle">Each bar uses identical walk-forward origin/target pairs; ablations zero only the excluded F&amp;O inputs.</text>
<text x="60" y="101" class="subtitle">${symbolCount} symbols | ${sampleCount.toLocaleString('en-US')} matched symbol-origin pairs | All variants retain the same technical inputs.</text>
${panels}
<text x="60" y="${footerY}" class="subtitle">Archive futures/options groups are tested separately; “Historical futures” uses the independent futures feature set.</text>
<text x="60" y="${footerY + 23}" class="subtitle">Results are historical and exploratory. Higher direction accuracy and lower MAPE are desirable; neither alone proves future performance.</text>
</svg>
`;
}

async function saveProgress(results: VariantRun[]) {
  const run: RunFile = {
    generatedAt: new Date().toISOString(),
    evaluation: {
      asOfDate,
      symbols,
      historyMonths,
      stepMonths,
      horizonSessions: 5,
      variants: variants.map((variant) => variant.id),
      matchedOriginsAcrossAllVariants: true,
    },
    results,
  };
  await writeFile(progressPath, JSON.stringify(run, null, 2), 'utf8');
}

async function loadProgress(): Promise<VariantRun[]> {
  const resumePath = process.env.FORECAST_FNO_ABLATION_RESUME;
  if (!resumePath) return [];
  const saved = JSON.parse(await readFile(resolve(resumePath), 'utf8')) as RunFile;
  if (
    saved.evaluation.asOfDate !== asOfDate ||
    JSON.stringify(saved.evaluation.symbols) !== JSON.stringify(symbols) ||
    JSON.stringify(saved.evaluation.variants) !==
      JSON.stringify(variants.map((variant) => variant.id)) ||
    saved.evaluation.historyMonths !== historyMonths ||
    saved.evaluation.stepMonths !== stepMonths
  )
    throw new Error(
      'Resume file uses a different date, symbol list, variant list, or evaluation configuration.'
    );
  return saved.results;
}

async function exportResults(results: VariantRun[]) {
  const scoredRows = matchedScores(results);
  const summaryRows = scoredRows
    .filter((row) => row.symbol === 'ALL')
    .map((row) => ({
      variant: row.variant,
      model: row.label,
      paired_symbols: new Set(
        scoredRows.filter((item) => item.symbol !== 'ALL').map((item) => item.symbol)
      ).size,
      paired_samples: row.pairedSamples,
      directional_accuracy_pct: row.directionalAccuracyPct,
      direction_change_vs_technical_pp: row.directionChangePp,
      mape_pct: row.mapePct,
      mape_change_vs_technical_pp: row.mapeChangePp,
      common_start_origin: row.commonStartOrigin,
      common_end_target: row.commonEndTarget,
    }));
  const symbolRows = scoredRows
    .filter((row) => row.symbol !== 'ALL')
    .map((row) => ({
      symbol: row.symbol,
      variant: row.variant,
      model: row.label,
      paired_samples: row.pairedSamples,
      directional_accuracy_pct: row.directionalAccuracyPct,
      direction_change_vs_technical_pp: row.directionChangePp,
      mape_pct: row.mapePct,
      mape_change_vs_technical_pp: row.mapeChangePp,
    }));
  const errorRows = results
    .filter((result) => result.status === 'error')
    .map((result) => ({
      symbol: result.symbol,
      variant: result.variant,
      error: result.error,
    }));
  await mkdir(resultsDirectory, { recursive: true });
  await Promise.all([
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-comparison.csv'),
      csv(summaryRows, Object.keys(summaryRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-by-symbol.csv'),
      csv(symbolRows, Object.keys(symbolRows[0])),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-errors.csv'),
      csv(errorRows, ['symbol', 'variant', 'error']),
      'utf8'
    ),
    writeFile(
      join(resultsDirectory, 'forecast-fno-ablation-comparison.svg'),
      renderChart(scoredRows),
      'utf8'
    ),
  ]);
  console.log(
    `Exported ${summaryRows.length} matched model rows; ` +
      `${new Set(scoredRows.filter((row) => row.symbol !== 'ALL').map((row) => row.symbol)).size} symbols; ` +
      `${summaryRows[0]?.paired_samples ?? 0} common forecast pairs.`
  );
  console.log(`Progress: ${progressPath}`);
}

async function withRetry<T>(
  operation: () => Promise<T>,
  label: string
): Promise<T> {
  const maxRetries = Number(
    process.env.FORECAST_FNO_ABLATION_RETRIES ?? 2
  );
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries) break;
      const retryDelay = Math.max(delayMs, 1000) * 2 ** attempt;
      console.warn(
        `${label} failed (attempt ${attempt + 1}/${maxRetries + 1}); retrying in ${retryDelay}ms.`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function run() {
  const retries = Number(
    process.env.FORECAST_FNO_ABLATION_RETRIES ?? 2
  );
  if (
    !symbols.length ||
    new Set(symbols).size !== symbols.length ||
    !Number.isInteger(historyMonths) ||
    historyMonths < 36 ||
    historyMonths > 120 ||
    !Number.isInteger(stepMonths) ||
    stepMonths < 1 ||
    stepMonths > 24 ||
    !Number.isInteger(retries) ||
    retries < 0 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0
  )
    throw new Error('Invalid F&O feature-ablation configuration.');
  const results = await loadProgress();
  await mkdir(outputDirectory, { recursive: true });
  console.log(
    `F&O feature ablation: ${symbols.length} symbols, ${variants.length} variants, ` +
      `${historyMonths} months of history, 5-session horizon.`
  );
  console.log(`Incremental results: ${progressPath}`);
  for (const symbol of symbols) {
    const nse = new NSEClient('downloads/fno-feature-ablation', {
      server: false,
    });
    try {
      const api = new ForecastApi(
        nse.historical,
        undefined,
        undefined,
        { fnoArchiveDir: resolve(process.cwd(), 'downloads') },
        stepMonths,
        async (actionSymbol, from, to) =>
          nse.corporate.getActions({
            symbol: actionSymbol,
            from_date: new Date(`${from}T12:00:00`),
            to_date: new Date(`${to}T12:00:00`),
          })
      );
      for (const variant of variants) {
        if (
          variantRun(results, symbol, variant.id)?.status === 'ok'
        ) {
          console.log(`${symbol}/${variant.id}: already completed; skipping`);
          continue;
        }
        configureForecastFeatureSetForBenchmark(api, variant.featureSet);
        configureFnoFeatureSetForBenchmark(api, variant.includedFnoFeatures);
        configureFnoFeatureLookbacksForBenchmark(api, variant.fnoLookbacks);
        configureFnoArchiveOptionsForBenchmark(api, variant.fnoArchiveOptions);
        try {
          const forecast = await withRetry(
            () =>
              api.forecastStock({
                symbol,
                horizon: 'week',
                historyMonths,
                model: variant.model,
                context: 'off',
                sentiment: 'off',
              }),
            `${symbol}/${variant.id}`
          );
          const training = forecast.model.training;
          if (!training)
            throw new Error('Forecast did not return walk-forward predictions.');
          const predictions = training.outOfSampleForecasts.filter(
            (prediction) => prediction.horizon === 5
          );
          if (!predictions.length)
            throw new Error('No five-session out-of-sample predictions returned.');
          const run: VariantRun = {
            symbol,
            variant: variant.id,
            status: 'ok',
            predictions,
          };
          const existingIndex = results.findIndex(
            (item) => item.symbol === symbol && item.variant === variant.id
          );
          if (existingIndex < 0) results.push(run);
          else results[existingIndex] = run;
          console.log(
            `${symbol}/${variant.id}: ${predictions.length} five-session folds.`
          );
        } catch (error) {
          const run: VariantRun = {
            symbol,
            variant: variant.id,
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
            predictions: [],
          };
          const existingIndex = results.findIndex(
            (item) => item.symbol === symbol && item.variant === variant.id
          );
          if (existingIndex < 0) results.push(run);
          else results[existingIndex] = run;
          console.warn(`${symbol}/${variant.id}: ${run.error}`);
        }
        await saveProgress(results);
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    } finally {
      nse.exit();
    }
  }
  await exportResults(results);
  console.table(
    matchedScores(results)
      .filter((row) => row.symbol === 'ALL')
      .map((row) => ({
        model: row.label,
        samples: row.pairedSamples,
        direction: `${row.directionalAccuracyPct.toFixed(2)}%`,
        directionChangePp: row.directionChangePp.toFixed(2),
        mape: `${row.mapePct.toFixed(3)}%`,
        mapeChangePp: row.mapeChangePp.toFixed(3),
      }))
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  ForecastApi,
  type ForecastResult,
} from '../../src/forecast/forecast-api.js';
import { scoreForecastReturns } from '../../src/forecast/evaluation.js';

const symbols = (process.env.FORECAST_FUTURES_SYMBOLS ?? 'TCS,INFY,HDFCBANK,RELIANCE,WIPRO')
  .split(',')
  .map((symbol) => symbol.trim().toUpperCase())
  .filter(Boolean);
const historyMonths = Number(process.env.FORECAST_FUTURES_HISTORY_MONTHS ?? 60);
const stepMonths = Number(process.env.FORECAST_FUTURES_STEP_MONTHS ?? 3);
const delayMs = Number(process.env.FORECAST_FUTURES_DELAY_MS ?? 1500);

type ModelRun = {
  status: 'ok' | 'error';
  backtest?: ForecastResult['backtest'];
  outOfSampleForecasts?: NonNullable<
    ForecastResult['model']['training']
  >['outOfSampleForecasts'];
  error?: string;
};

function modelRun(forecast: ForecastResult): ModelRun {
  return {
    status: 'ok',
    backtest: forecast.backtest,
    outOfSampleForecasts: forecast.model.training?.outOfSampleForecasts,
  };
}

function comparePaired(
  technical: ModelRun,
  futures: ModelRun
): Record<string, number> | undefined {
  if (
    !technical.outOfSampleForecasts ||
    !futures.outOfSampleForecasts
  )
    return;

  const futuresByOrigin = new Map(
    futures.outOfSampleForecasts
      .filter((row) => row.horizon === 5)
      .map((row) => [`${row.originDate}:${row.targetDate}`, row])
  );
  const paired = technical.outOfSampleForecasts
    .filter((row) => row.horizon === 5)
    .flatMap((row) => {
      const candidate = futuresByOrigin.get(
        `${row.originDate}:${row.targetDate}`
      );
      return candidate
        ? [
            {
              baseline: row,
              futures: candidate,
            },
          ]
        : [];
    });
  if (!paired.length) return;

  const technicalScore = scoreForecastReturns(
    paired.map(({ baseline }) => ({
      predictedLogReturn: baseline.predictedLogReturn,
      actualLogReturn: baseline.actualLogReturn,
    }))
  );
  const futuresScore = scoreForecastReturns(
    paired.map(({ futures }) => ({
      predictedLogReturn: futures.predictedLogReturn,
      actualLogReturn: futures.actualLogReturn,
    }))
  );
  return {
    pairedSamples: paired.length,
    technicalDirectionalAccuracyPct: technicalScore.directionalAccuracyPct,
    futuresDirectionalAccuracyPct: futuresScore.directionalAccuracyPct,
    directionalAccuracyChangePp:
      futuresScore.directionalAccuracyPct -
      technicalScore.directionalAccuracyPct,
    technicalMapePct: technicalScore.meanAbsolutePercentageError,
    futuresMapePct: futuresScore.meanAbsolutePercentageError,
    mapeChangePct:
      futuresScore.meanAbsolutePercentageError -
      technicalScore.meanAbsolutePercentageError,
  };
}

async function run() {
  if (
    !symbols.length ||
    !Number.isInteger(historyMonths) ||
    historyMonths < 36 ||
    historyMonths > 120 ||
    !Number.isInteger(stepMonths) ||
    stepMonths < 1 ||
    stepMonths > 24 ||
    !Number.isFinite(delayMs) ||
    delayMs < 0
  )
    throw new Error('Invalid futures benchmark configuration.');

  const nse = new NSEClient('downloads/futures-feature-benchmark', {
    server: true,
  });
  try {
    const api = new ForecastApi(
      nse.historical,
      undefined,
      undefined,
      {},
      stepMonths,
      async (symbol, from, to) =>
        nse.corporate.getActions({
          symbol,
          from_date: new Date(`${from}T12:00:00`),
          to_date: new Date(`${to}T12:00:00`),
        })
    );
    const results = [];

    for (const symbol of symbols) {
      const runs: { technical: ModelRun; technical_futures: ModelRun } = {
        technical: { status: 'error' },
        technical_futures: { status: 'error' },
      };
      for (const model of ['technical', 'technical_futures'] as const) {
        try {
          runs[model] = modelRun(
            await api.forecastStock({
              symbol,
              horizon: 'week',
              historyMonths,
              model,
              context: 'off',
              sentiment: 'off',
            })
          );
        } catch (error) {
          runs[model] = {
            status: 'error',
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      const paired = comparePaired(runs.technical, runs.technical_futures);
      const summarize = ({ status, backtest, error }: ModelRun) => ({
        status,
        ...(backtest ? { backtest } : {}),
        ...(error ? { error } : {}),
      });
      results.push({
        symbol,
        technical: summarize(runs.technical),
        technical_futures: summarize(runs.technical_futures),
        pairedComparison: paired,
      });
      console.log(
        `${symbol}: ` +
          (paired
            ? `paired ${paired.pairedSamples}; direction ${paired.technicalDirectionalAccuracyPct.toFixed(2)}% -> ${paired.futuresDirectionalAccuracyPct.toFixed(2)}%`
            : `comparison unavailable (${runs.technical_futures.error ?? 'no paired forecasts'})`)
      );
    }

    console.log(
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          configuration: {
            symbols,
            historyMonths,
            stepMonths,
            horizonSessions: 5,
            pairedOriginsOnly: true,
          },
          results,
        },
        null,
        2
      )
    );
  } finally {
    nse.exit();
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exitCode = 1;
});

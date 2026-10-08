import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  configureForecastProbabilityEventsForBenchmark,
  ForecastApi,
} from '../../src/forecast/forecast-api.js';
import {
  forecastEvents,
  priorEventProbability,
} from '../../src/forecast/target-outcomes.js';
import {
  probabilityBenchmarkSymbols,
  probabilityProspectiveDirectory,
  probabilitySnapshotModelVersion,
  latestHistoricalOutcomes,
  readMaturedOutcomes,
  readProbabilitySnapshots,
  type ProbabilityOutcome,
  type ProbabilitySnapshot,
  type ProbabilitySnapshotPrediction,
} from './probability-prospective-common.js';

const historyMonths = Number(process.env.FORECAST_BENCHMARK_HISTORY_MONTHS ?? 60);

function indiaDateTime(date: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    hour: Number(part('hour')),
    minute: Number(part('minute')),
  };
}

async function captureSnapshot() {
  if (!Number.isInteger(historyMonths) || historyMonths < 36 || historyMonths > 120)
    throw new Error('Benchmark history must be a whole number from 36 to 120 months.');
  const now = new Date();
  const local = indiaDateTime(now);
  if (local.hour < 16)
    throw new Error(
      'Capture probability snapshots after the NSE daily close (16:00 IST or later).'
    );
  const snapshotsDirectory = join(probabilityProspectiveDirectory, 'snapshots');
  const outputPath = join(
    snapshotsDirectory,
    `snapshot-${local.date}.json`
  );
  if (existsSync(outputPath))
    throw new Error(
      `A probability snapshot for ${local.date} already exists; refusing to overwrite it.`
    );

  const existingSnapshots = await readProbabilitySnapshots();
  const existingOrigins = new Set(
    existingSnapshots.flatMap((snapshot) =>
      snapshot.predictions.map((prediction) =>
        `${prediction.symbol}:${prediction.originDate}`
      )
    )
  );
  const historical = await latestHistoricalOutcomes();
  const matured = await readMaturedOutcomes();
  const priorOutcomes: ProbabilityOutcome[] = [
    ...historical.outcomes,
    ...matured,
  ];
  const cacheDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ?? 'node_modules/.cache/forecast-benchmark'
  );
  const nse = new NSEClient(join(cacheDirectory, 'nse-downloads'), {
    server: true,
  });
  const forecastApi = new ForecastApi(
    nse.historical,
    () => now,
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
  const predictions: ProbabilitySnapshotPrediction[] = [];
  const originDates = new Set<string>();

  for (const symbol of probabilityBenchmarkSymbols) {
    const snapshot = await forecastApi.forecastProbabilitySnapshotForBenchmark({
      symbol,
      historyMonths,
    });
    if (snapshot.dataQuality.corporateActionAdjustment !== 'applied')
      throw new Error(
        `${symbol}: corporate-action adjustments were not applied; snapshot aborted.`
      );
    if (snapshot.predictions.length !== forecastEvents.length * 2)
      throw new Error(
        `${symbol}: expected probabilities for all three events at horizons 1 and 5.`
      );
    originDates.add(snapshot.originDate);
    if (existingOrigins.has(`${symbol}:${snapshot.originDate}`))
      throw new Error(
        `${symbol}: origin ${snapshot.originDate} was already captured; wait for a new trading session.`
      );
    for (const prediction of snapshot.predictions) {
      const prior = priorEventProbability(
        priorOutcomes,
        prediction.horizon,
        snapshot.originDate,
        prediction.event
      );
      predictions.push({
        symbol,
        originDate: snapshot.originDate,
        ...prediction,
        priorProbability: prior.probability,
        priorOutcomeSamples: prior.samples,
        usedNeutralPriorFallback: prior.fallback,
      });
    }
    console.log(`${symbol}: captured origin ${snapshot.originDate}`);
  }

  if (new Set(predictions.map(({ symbol }) => symbol)).size !== probabilityBenchmarkSymbols.length)
    throw new Error('Probability snapshot did not capture every benchmark symbol.');
  const capture: ProbabilitySnapshot & {
    model: {
      trainMonths: number;
      features: string;
      l2Penalty: number;
    };
    originDates: string[];
  } = {
    generatedAt: now.toISOString(),
    captureDate: local.date,
    modelVersion: probabilitySnapshotModelVersion,
    historyMonths,
    historicalBenchmarkRun: historical.run,
    historicalOutcomeCount: historical.outcomes.length,
    symbols: [...probabilityBenchmarkSymbols],
    predictions,
    model: {
      trainMonths: 14,
      features: 'close-only technical indicators; train-window standardization',
      l2Penalty: 0.01,
    },
    originDates: [...originDates].sort(),
  };
  await mkdir(snapshotsDirectory, { recursive: true });
  await writeFile(outputPath, JSON.stringify(capture, null, 2));
  console.log(`Saved ${predictions.length} probabilities to ${outputPath}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  captureSnapshot().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Probability snapshot capture failed.'
    );
    process.exitCode = 1;
  });

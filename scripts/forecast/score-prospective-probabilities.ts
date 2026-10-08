import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import { normalizeForecastHistoricalRows } from '../../src/forecast/forecast-api.js';
import {
  forecastEventOccurred,
  forecastEvents,
  scoreBinaryProbabilities,
  type ForecastEvent,
} from '../../src/forecast/target-outcomes.js';
import { addCalendarMonths } from '../../src/forecast/walk-forward.js';
import { bootstrapProbabilityDifferences } from './benchmark-probability-classifier.js';
import {
  csv,
  probabilityProspectiveDirectory,
  probabilitySnapshotModelVersion,
  readProbabilitySnapshots,
  type ProbabilityOutcome,
  type ProbabilitySnapshotPrediction,
} from './probability-prospective-common.js';

interface MaturedOutcome extends ProbabilityOutcome {
  originDate: string;
}

type OutcomeResolution =
  | { status: 'pending' }
  | { status: 'quality_excluded' }
  | { status: 'matured'; outcome: MaturedOutcome };

interface ScoredPrediction extends MaturedOutcome {
  event: ForecastEvent;
  probability: number;
  priorProbability: number;
  occurred: boolean;
  priorOutcomeSamples: number;
  usedNeutralPriorFallback: boolean;
}

const minimumBootstrapOrigins = 200;
const bootstrapBlockSessions = 20;
const bootstrapReplicates = 2000;

function localDateTime(date: Date) {
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
  };
}

function uniqueTargets(
  predictions: ProbabilitySnapshotPrediction[]
): ProbabilitySnapshotPrediction[] {
  const byKey = new Map<string, ProbabilitySnapshotPrediction>();
  for (const prediction of predictions) {
    const key = `${prediction.symbol}:${prediction.originDate}:${prediction.horizon}`;
    if (!byKey.has(key)) byKey.set(key, prediction);
  }
  return [...byKey.values()];
}

export function resolveProspectiveOutcome(
  prediction: ProbabilitySnapshotPrediction,
  observations: {
    date: string;
    close: number;
    qualityExcluded?: boolean;
  }[]
): OutcomeResolution {
  const originIndex = observations.findIndex(
    (observation) => observation.date === prediction.originDate
  );
  if (originIndex < 0)
    throw new Error(
      `Origin ${prediction.originDate} is missing from ${prediction.symbol} price history.`
    );
  const targetIndex = originIndex + prediction.horizon;
  if (targetIndex >= observations.length) return { status: 'pending' };
  const featureStart = Math.max(0, originIndex - 59);
  if (
    observations
      .slice(featureStart, targetIndex + 1)
      .some((observation) => observation.qualityExcluded)
  )
    return { status: 'quality_excluded' };
  return {
    status: 'matured',
    outcome: {
      symbol: prediction.symbol,
      originDate: prediction.originDate,
      horizon: prediction.horizon,
      targetDate: observations[targetIndex].date,
      actualLogReturn: Math.log(
        observations[targetIndex].close / observations[originIndex].close
      ),
    },
  };
}

function calibrationRows(
  predictions: ScoredPrediction[],
  horizon: 1 | 5,
  event: ForecastEvent
) {
  const selected = predictions.filter(
    (prediction) =>
      prediction.horizon === horizon && prediction.event === event
  );
  return Array.from({ length: 10 }, (_, probabilityBin) => {
    const bin = selected.filter(
      (prediction) =>
        Math.min(9, Math.floor(prediction.probability * 10)) === probabilityBin
    );
    return {
      horizon,
      event,
      probabilityBin,
      binStartInclusive: probabilityBin / 10,
      binEndExclusive: (probabilityBin + 1) / 10,
      samples: bin.length,
      meanPredictedProbability: bin.length
        ? bin.reduce((sum, row) => sum + row.probability, 0) / bin.length
        : undefined,
      observedRatePct: bin.length
        ? bin.filter((row) => row.occurred).length / bin.length * 100
        : undefined,
    };
  });
}

async function runScorecard() {
  const local = localDateTime(new Date());
  if (local.hour < 16)
    throw new Error(
      'Score prospective outcomes after the NSE daily close (16:00 IST or later).'
    );
  const snapshots = await readProbabilitySnapshots();
  if (!snapshots.length)
    throw new Error(
      `No prospective probability snapshots found under ${join(probabilityProspectiveDirectory, 'snapshots')}.`
    );
  if (snapshots.some((snapshot) => snapshot.modelVersion !== probabilitySnapshotModelVersion))
    throw new Error('Prospective snapshots contain multiple model versions.');
  const allPredictions = snapshots.flatMap((snapshot) => snapshot.predictions);
  const bySymbol = new Map<string, ProbabilitySnapshotPrediction[]>();
  for (const prediction of allPredictions) {
    const rows = bySymbol.get(prediction.symbol) ?? [];
    rows.push(prediction);
    bySymbol.set(prediction.symbol, rows);
  }

  const cacheDirectory = join(
    process.env.FORECAST_BENCHMARK_DIR ?? 'node_modules/.cache/forecast-benchmark',
    'nse-downloads'
  );
  const nse = new NSEClient(cacheDirectory, { server: true });
  const histories = new Map<
    string,
    Awaited<ReturnType<typeof normalizeForecastHistoricalRows>>['observations']
  >();
  for (const [symbol, predictions] of bySymbol) {
    const earliestOrigin = predictions
      .map((prediction) => prediction.originDate)
      .sort()[0];
    const from = addCalendarMonths(earliestOrigin, -6);
    const to = local.date;
    const rows = await nse.historical.fetchEquityHistoricalData({
      symbol,
      from_date: new Date(`${from}T12:00:00`),
      to_date: new Date(`${to}T12:00:00`),
      series: ['EQ'],
    });
    const actionRows = await nse.corporate.getActions({
      symbol,
      from_date: new Date(`${from}T12:00:00`),
      to_date: new Date(`${to}T12:00:00`),
    });
    const history = normalizeForecastHistoricalRows(
      rows,
      from,
      to,
      symbol,
      actionRows
    );
    if (history.dataQuality.corporateActionAdjustment !== 'applied')
      throw new Error(`${symbol}: corporate-action adjustments were not applied.`);
    histories.set(symbol, history.observations);
  }

  const outcomes = new Map<string, MaturedOutcome>();
  const pendingTargets: string[] = [];
  const qualityExcludedTargets: string[] = [];
  for (const prediction of uniqueTargets(allPredictions)) {
    const observations = histories.get(prediction.symbol);
    if (!observations)
      throw new Error(`Missing normalized price history for ${prediction.symbol}.`);
    const key = `${prediction.symbol}:${prediction.originDate}:${prediction.horizon}`;
    const resolution = resolveProspectiveOutcome(prediction, observations);
    if (resolution.status === 'pending') {
      pendingTargets.push(key);
      continue;
    }
    if (resolution.status === 'quality_excluded') {
      qualityExcludedTargets.push(key);
      continue;
    }
    outcomes.set(key, resolution.outcome);
  }

  const scored: ScoredPrediction[] = [];
  for (const prediction of allPredictions) {
    const outcome = outcomes.get(
      `${prediction.symbol}:${prediction.originDate}:${prediction.horizon}`
    );
    if (!outcome) continue;
    scored.push({
      ...outcome,
      event: prediction.event,
      probability: prediction.probability,
      priorProbability: prediction.priorProbability,
      occurred: forecastEventOccurred(outcome.actualLogReturn, prediction.event),
      priorOutcomeSamples: prediction.priorOutcomeSamples,
      usedNeutralPriorFallback: prediction.usedNeutralPriorFallback,
    });
  }

  const summary: Record<string, unknown>[] = [];
  const calibration: Record<string, unknown>[] = [];
  const uncertainty: Record<string, unknown>[] = [];
  for (const horizon of [1, 5] as const) {
    for (const event of forecastEvents) {
      const selected = scored.filter(
        (prediction) =>
          prediction.horizon === horizon && prediction.event === event
      );
      const base = {
        horizon,
        event,
        symbols: new Set(selected.map((row) => row.symbol)).size,
        samples: selected.length,
        distinctOrigins: new Set(selected.map((row) => row.originDate)).size,
        pendingTargets: pendingTargets.filter(
          (key) => key.endsWith(`:${horizon}`)
        ).length,
        qualityExcludedTargets: qualityExcludedTargets.filter(
          (key) => key.endsWith(`:${horizon}`)
        ).length,
      };
      if (!selected.length) {
        summary.push({
          ...base,
          status: 'awaiting_matured_outcomes',
          eventCount: 0,
          observedRatePct: undefined,
          classifierBrierScore: undefined,
          classifierLogLoss: undefined,
          priorBrierScore: undefined,
          priorLogLoss: undefined,
          neutralBrierScore: undefined,
          neutralLogLoss: undefined,
        });
        uncertainty.push({
          horizon,
          event,
          status: 'awaiting_matured_outcomes',
          samples: 0,
        });
        calibration.push(...calibrationRows([], horizon, event));
        continue;
      }
      const classifier = scoreBinaryProbabilities(selected.map((row) => ({
        probability: row.probability,
        occurred: row.occurred,
      })));
      const prior = scoreBinaryProbabilities(selected.map((row) => ({
        probability: row.priorProbability,
        occurred: row.occurred,
      })));
      const neutral = scoreBinaryProbabilities(selected.map((row) => ({
        probability: 0.5,
        occurred: row.occurred,
      })));
      summary.push({
        ...base,
        status: 'scored',
        eventCount: Math.round(
          classifier.observedRatePct * classifier.samples / 100
        ),
        observedRatePct: classifier.observedRatePct,
        classifierBrierScore: classifier.brierScore,
        classifierLogLoss: classifier.logLoss,
        priorBrierScore: prior.brierScore,
        priorLogLoss: prior.logLoss,
        neutralBrierScore: neutral.brierScore,
        neutralLogLoss: neutral.logLoss,
        classifierMinusPriorBrier:
          classifier.brierScore - prior.brierScore,
        classifierMinusPriorLogLoss:
          classifier.logLoss - prior.logLoss,
        classifierMinusNeutralBrier:
          classifier.brierScore - neutral.brierScore,
        classifierMinusNeutralLogLoss:
          classifier.logLoss - neutral.logLoss,
      });
      calibration.push(...calibrationRows(selected, horizon, event));
      const distinctOrigins = new Set(selected.map((row) => row.originDate)).size;
      if (distinctOrigins < minimumBootstrapOrigins) {
        uncertainty.push({
          horizon,
          event,
          status: `waiting_for_${minimumBootstrapOrigins}_distinct_origins`,
          samples: selected.length,
          distinctOrigins,
          blockSessions: bootstrapBlockSessions,
        });
        continue;
      }
      const bootstrapRows = selected.map((row) => ({
        ...row,
        fold: 0,
        testStart: 'prospective',
        testEndExclusive: 'prospective',
      }));
      uncertainty.push({
        horizon,
        event,
        status: 'scored',
        samples: selected.length,
        distinctOrigins,
        blockSessions: bootstrapBlockSessions,
        replicates: bootstrapReplicates,
        ...bootstrapProbabilityDifferences(
          bootstrapRows,
          `prospective:${horizon}:${event}`,
          bootstrapReplicates,
          bootstrapBlockSessions
        ),
      });
    }
  }

  const outputDirectory = probabilityProspectiveDirectory;
  await mkdir(outputDirectory, { recursive: true });
  const maturedOutcomes = [...outcomes.values()].sort(
    (left, right) =>
      left.targetDate.localeCompare(right.targetDate) ||
      left.symbol.localeCompare(right.symbol) ||
      left.horizon - right.horizon
  );
  await writeFile(
    join(outputDirectory, 'matured-outcomes.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        outcomes: maturedOutcomes,
        pendingTargetCount: pendingTargets.length,
        qualityExcludedTargetCount: qualityExcludedTargets.length,
      },
      null,
      2
    )
  );
  const scorecard = {
    generatedAt: new Date().toISOString(),
    modelVersion: probabilitySnapshotModelVersion,
    snapshotCount: snapshots.length,
    symbolCount: bySymbol.size,
    maturedTargetCount: maturedOutcomes.length,
    pendingTargetCount: pendingTargets.length,
    qualityExcludedTargetCount: qualityExcludedTargets.length,
    minimumBootstrapOrigins,
    summary,
    uncertainty,
    calibration,
    scoredPredictions: scored,
  };
  await writeFile(
    join(outputDirectory, 'scorecard.json'),
    JSON.stringify(scorecard, null, 2)
  );
  await writeFile(
    join(outputDirectory, 'scorecard.csv'),
    csv(summary, [
      'horizon', 'event', 'status', 'symbols', 'samples', 'distinctOrigins',
      'eventCount', 'observedRatePct', 'classifierBrierScore',
      'classifierLogLoss', 'priorBrierScore', 'priorLogLoss',
      'neutralBrierScore', 'neutralLogLoss',
      'classifierMinusPriorBrier', 'classifierMinusPriorLogLoss',
      'classifierMinusNeutralBrier', 'classifierMinusNeutralLogLoss',
      'pendingTargets', 'qualityExcludedTargets',
    ])
  );
  await writeFile(
    join(outputDirectory, 'calibration.csv'),
    csv(calibration, [
      'horizon', 'event', 'probabilityBin', 'binStartInclusive',
      'binEndExclusive', 'samples', 'meanPredictedProbability',
      'observedRatePct',
    ])
  );
  await writeFile(
    join(outputDirectory, 'uncertainty.csv'),
    csv(uncertainty, [
      'horizon', 'event', 'status', 'samples', 'distinctOrigins',
      'blockSessions', 'replicates',
      'classifierMinusPriorBrier', 'classifierMinusPriorBrierLower95',
      'classifierMinusPriorBrierUpper95',
      'classifierMinusPriorLogLoss',
      'classifierMinusPriorLogLossLower95',
      'classifierMinusPriorLogLossUpper95',
      'classifierMinusNeutralBrier',
      'classifierMinusNeutralBrierLower95',
      'classifierMinusNeutralBrierUpper95',
      'classifierMinusNeutralLogLoss',
      'classifierMinusNeutralLogLossLower95',
      'classifierMinusNeutralLogLossUpper95',
    ])
  );
  console.log(
    `Scored ${scored.length} matured probabilities from ${snapshots.length} snapshots.`
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  runScorecard().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Prospective scorecard failed.'
    );
    process.exitCode = 1;
  });

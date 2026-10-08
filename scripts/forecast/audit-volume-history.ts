import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import {
  adjustHistoricalRows,
  parseNseShareAdjustments,
} from '../../src/forecast/corporate-actions.js';
import { addCalendarMonths } from '../../src/forecast/walk-forward.js';

const symbols = [
  'RELIANCE', 'HDFCBANK', 'ICICIBANK', 'SBIN', 'AXISBANK', 'KOTAKBANK',
  'BHARTIARTL', 'TCS', 'INFY', 'HCLTECH', 'WIPRO', 'LT', 'M&M', 'MARUTI',
  'SUNPHARMA', 'CIPLA', 'ITC', 'HINDUNILVR', 'TITAN',
  'ASIANPAINT', 'TATASTEEL', 'JSWSTEEL', 'NTPC', 'POWERGRID', 'ADANIENT',
  'ADANIPORTS', 'BAJFINANCE', 'EICHERMOT', 'ULTRACEMCO',
] as const;

const asOfDate = '2026-04-05';
const requestedFrom = addCalendarMonths(asOfDate, -60);
const requestedTo = new Date(Date.parse(`${asOfDate}T00:00:00Z`) - 86400000)
  .toISOString()
  .slice(0, 10);

interface VolumeRow {
  date: string;
  volume?: number;
  rawClose?: number;
  close?: number;
}

interface SymbolAudit {
  symbol: string;
  status: 'ok' | 'error';
  error?: string;
  firstDate?: string;
  lastDate?: string;
  rows?: number;
  duplicateDates?: number;
  otherSymbolRows?: number;
  nonEquityRows?: number;
  volumeField?: string;
  missingVolume?: number;
  invalidVolume?: number;
  zeroVolume?: number;
  positiveVolume?: number;
  minimumPositiveVolume?: number;
  medianVolume?: number;
  maximumVolume?: number;
  missingClose?: number;
  corporateActionCount?: number;
}

interface EventAudit {
  symbol: string;
  exDate: string;
  subject: string;
  shareFactor: number;
  beforeSamples: number;
  afterSamples: number;
  medianVolumeBeforeRaw?: number;
  medianVolumeBeforeRestated?: number;
  medianVolumeAfterRaw?: number;
  medianVolumeAfterRestated?: number;
  rawAfterBeforeRatio?: number;
  restatedAfterBeforeRatio?: number;
  medianTradedValueBefore?: number;
  medianTradedValueAfter?: number;
  restatedTradedValueAfterBeforeRatio?: number;
  medianRawCloseBefore?: number;
  medianAdjustedCloseBefore?: number;
  medianAdjustedCloseAfter?: number;
  adjustedCloseAfterBeforeRatio?: number;
  interpretation: string;
}

function csvValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csv(rows: object[], columns: string[]): string {
  return [
    columns.join(','),
    ...rows.map((row) =>
      columns.map((column) => csvValue(Reflect.get(row, column))).join(',')
    ),
  ].join('\r\n') + '\r\n';
}

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(value);
  if (match) {
    const months = [
      'jan', 'feb', 'mar', 'apr', 'may', 'jun',
      'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
    ];
    const month = months.indexOf(match[2].toLowerCase()) + 1;
    if (!month) return undefined;
    return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

function numeric(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function median(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function shareFactorBefore(date: string, adjustments: { exDate: string; shareFactor: number }[]) {
  return adjustments.reduce(
    (factor, action) =>
      date < action.exDate ? factor * action.shareFactor : factor,
    1
  );
}

function eventAudit(
  symbol: string,
  adjustment: { exDate: string; subject: string; shareFactor: number },
  rows: VolumeRow[],
  adjustments: { exDate: string; shareFactor: number }[]
): EventAudit {
  const before = rows
    .filter((row) => row.date < adjustment.exDate)
    .sort((left, right) => right.date.localeCompare(left.date))
    .slice(0, 5)
    .reverse();
  const after = rows
    .filter((row) => row.date >= adjustment.exDate)
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(0, 5);
  const beforeVolume = before.flatMap((row) =>
    row.volume === undefined ? [] : [row.volume]
  );
  const afterVolume = after.flatMap((row) =>
    row.volume === undefined ? [] : [row.volume]
  );
  const medianBefore = median(beforeVolume);
  const medianAfter = median(afterVolume);
  const restatedQuantity = (row: VolumeRow) =>
    row.volume === undefined
      ? undefined
      : row.volume * shareFactorBefore(row.date, adjustments);
  const adjustedBefore = median(
    before.flatMap((row) =>
      restatedQuantity(row) === undefined ? [] : [restatedQuantity(row)!]
    )
  );
  const adjustedAfter = median(
    after.flatMap((row) =>
      restatedQuantity(row) === undefined ? [] : [restatedQuantity(row)!]
    )
  );
  const rawRatio =
    medianBefore && medianAfter ? medianAfter / medianBefore : undefined;
  const restatedRatio =
    adjustedBefore && adjustedAfter ? adjustedAfter / adjustedBefore : undefined;
  const valueBefore = median(
    before.flatMap((row) =>
      restatedQuantity(row) === undefined || row.close === undefined
        ? []
        : [restatedQuantity(row)! * row.close]
    )
  );
  const valueAfter = median(
    after.flatMap((row) =>
      restatedQuantity(row) === undefined || row.close === undefined
        ? []
        : [restatedQuantity(row)! * row.close]
    )
  );
  const rawCloseBefore = median(
    before.flatMap((row) =>
      row.rawClose === undefined ? [] : [row.rawClose]
    )
  );
  const adjustedCloseBefore = median(
    before.flatMap((row) => (row.close === undefined ? [] : [row.close]))
  );
  const adjustedCloseAfter = median(
    after.flatMap((row) => (row.close === undefined ? [] : [row.close]))
  );
  return {
    symbol,
    exDate: adjustment.exDate,
    subject: adjustment.subject,
    shareFactor: adjustment.shareFactor,
    beforeSamples: beforeVolume.length,
    afterSamples: afterVolume.length,
    medianVolumeBeforeRaw: medianBefore,
    medianVolumeBeforeRestated: adjustedBefore,
    medianVolumeAfterRaw: medianAfter,
    medianVolumeAfterRestated: adjustedAfter,
    rawAfterBeforeRatio: rawRatio,
    restatedAfterBeforeRatio: restatedRatio,
    medianTradedValueBefore: valueBefore,
    medianTradedValueAfter: valueAfter,
    restatedTradedValueAfterBeforeRatio:
      valueBefore && valueAfter ? valueAfter / valueBefore : undefined,
    medianRawCloseBefore: rawCloseBefore,
    medianAdjustedCloseBefore: adjustedCloseBefore,
    medianAdjustedCloseAfter: adjustedCloseAfter,
    adjustedCloseAfterBeforeRatio:
      adjustedCloseBefore && adjustedCloseAfter
        ? adjustedCloseAfter / adjustedCloseBefore
        : undefined,
    interpretation:
      beforeVolume.length < 3 || afterVolume.length < 3
        ? 'insufficient adjacent observations'
        : 'descriptive only: market activity can change; not proof of adjustment quality',
  };
}

async function runAudit() {
  const resultsDirectory = resolve('results');
  const cacheDirectory = resolve(
    'node_modules/.cache/forecast-benchmark/nse-downloads'
  );
  await mkdir(resultsDirectory, { recursive: true });
  const nse = new NSEClient(cacheDirectory, { server: true });
  const symbolAudits: SymbolAudit[] = [];
  const eventAudits: EventAudit[] = [];
  try {
    console.log(
      `Auditing raw NSE quantity history for ${symbols.length} equities from ${requestedFrom} through ${requestedTo}.`
    );
    for (const symbol of symbols) {
      try {
        const [rawRows, actionRows] = await Promise.all([
          nse.historical.fetchEquityHistoricalData({
            symbol,
            from_date: new Date(`${requestedFrom}T12:00:00`),
            to_date: new Date(`${requestedTo}T12:00:00`),
            series: ['EQ'],
          }),
          nse.corporate.getActions({
            symbol,
            from_date: new Date(`${requestedFrom}T12:00:00`),
            to_date: new Date(`${requestedTo}T12:00:00`),
          }),
        ]);
        if (!Array.isArray(rawRows) || !Array.isArray(actionRows))
          throw new Error('NSE historical data or corporate actions are not arrays.');
        const adjustments = parseNseShareAdjustments(actionRows, symbol);
        const adjustedPrices = adjustHistoricalRows(rawRows, adjustments);
        const dates = new Set<string>();
        let duplicateDates = 0;
        let otherSymbolRows = 0;
        let nonEquityRows = 0;
        let missingVolume = 0;
        let invalidVolume = 0;
        let zeroVolume = 0;
        let missingClose = 0;
        const volumes: number[] = [];
        const rows: VolumeRow[] = [];
        const volumeFields = [
          'chTotTradedQty',
          'CH_TOT_TRADED_QTY',
          'totalTradedVolume',
          'volume',
        ];
        const observedVolumeFields = new Map<string, number>();
        for (const raw of rawRows) {
          if (raw.chSymbol && raw.chSymbol !== symbol) otherSymbolRows++;
          if ((raw.chSeries ?? 'EQ') !== 'EQ') nonEquityRows++;
        }
        for (let index = 0; index < rawRows.length; index++) {
          const raw = rawRows[index];
          const date = parseDate(raw.mtimestamp ?? raw.CH_TIMESTAMP ?? raw.chTimestamp);
          if (!date || date < requestedFrom || date > requestedTo) continue;
          if (dates.has(date)) duplicateDates++;
          dates.add(date);
          const field = volumeFields.find((key) => key in raw);
          const quantity = field ? numeric(raw[field]) : undefined;
          if (field)
            observedVolumeFields.set(
              field,
              (observedVolumeFields.get(field) ?? 0) + 1
            );
          if (!field || raw[field] === null || raw[field] === undefined || raw[field] === '') {
            missingVolume++;
          } else if (quantity === undefined || quantity < 0 || !Number.isSafeInteger(quantity)) {
            invalidVolume++;
          } else if (quantity === 0) {
            zeroVolume++;
          } else {
            volumes.push(quantity);
          }
          const close = numeric(adjustedPrices[index]?.chClosingPrice);
          const rawClose = numeric(raw.chClosingPrice);
          if (close === undefined || close <= 0) missingClose++;
          rows.push({
            date,
            volume:
              quantity !== undefined &&
              quantity > 0 &&
              Number.isSafeInteger(quantity)
                ? quantity
                : undefined,
            rawClose:
              rawClose !== undefined && rawClose > 0 ? rawClose : undefined,
            close: close !== undefined && close > 0 ? close : undefined,
          });
        }
        const selectedVolumeField =
          [...observedVolumeFields.entries()].sort(
            (left, right) => right[1] - left[1]
          )[0]?.[0];
        const sortedRows = rows.sort((left, right) =>
          left.date.localeCompare(right.date)
        );
        symbolAudits.push({
          symbol,
          status: 'ok',
          firstDate: sortedRows[0]?.date,
          lastDate: sortedRows.at(-1)?.date,
          rows: sortedRows.length,
          duplicateDates,
          otherSymbolRows,
          nonEquityRows,
          volumeField: selectedVolumeField,
          missingVolume,
          invalidVolume,
          zeroVolume,
          positiveVolume: volumes.length,
          minimumPositiveVolume: volumes.length ? Math.min(...volumes) : undefined,
          medianVolume: median(volumes),
          maximumVolume: volumes.length ? Math.max(...volumes) : undefined,
          missingClose,
          corporateActionCount: adjustments.length,
        });
        const actionsByDate = new Map<
          string,
          { exDate: string; subjects: string[]; shareFactor: number }
        >();
        for (const adjustment of adjustments) {
          const group = actionsByDate.get(adjustment.exDate) ?? {
            exDate: adjustment.exDate,
            subjects: [],
            shareFactor: 1,
          };
          group.subjects.push(adjustment.subject);
          group.shareFactor *= adjustment.shareFactor;
          actionsByDate.set(adjustment.exDate, group);
        }
        eventAudits.push(
          ...[...actionsByDate.values()].map((action) =>
            eventAudit(
              symbol,
              {
                exDate: action.exDate,
                subject: action.subjects.join(' + '),
                shareFactor: action.shareFactor,
              },
              sortedRows,
              adjustments
            )
          )
        );
        console.log(
          `${symbol}: ${sortedRows.length} dates, ${missingVolume} missing, ${invalidVolume} invalid, ${zeroVolume} zero, ${adjustments.length} split/bonus actions`
        );
      } catch (error) {
        symbolAudits.push({
          symbol,
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Volume history audit failed.',
        });
        console.error(`${symbol}: audit failed`);
      }
    }
  } finally {
    nse.exit();
  }

  const successful = symbolAudits.filter((row) => row.status === 'ok');
  const writeCsv = async (
    filename: string,
    rows: object[],
    columns: string[]
  ) =>
    writeFile(
      join(resultsDirectory, filename),
      csv(rows, columns),
      'utf8'
    );
  await Promise.all([
    writeCsv(
      'forecast-volume-history-audit-by-symbol.csv',
      symbolAudits,
      [
        'symbol', 'status', 'error', 'firstDate', 'lastDate', 'rows',
        'duplicateDates', 'otherSymbolRows', 'nonEquityRows', 'volumeField',
        'missingVolume', 'invalidVolume', 'zeroVolume', 'positiveVolume',
        'minimumPositiveVolume', 'medianVolume', 'maximumVolume', 'missingClose',
        'corporateActionCount',
      ]
    ),
    writeCsv(
      'forecast-volume-corporate-action-audit.csv',
      eventAudits,
      [
        'symbol', 'exDate', 'subject', 'shareFactor', 'beforeSamples',
        'afterSamples', 'medianVolumeBeforeRaw', 'medianVolumeBeforeRestated',
        'medianVolumeAfterRaw', 'medianVolumeAfterRestated',
        'rawAfterBeforeRatio', 'restatedAfterBeforeRatio',
        'medianTradedValueBefore', 'medianTradedValueAfter',
        'restatedTradedValueAfterBeforeRatio', 'medianRawCloseBefore',
        'medianAdjustedCloseBefore', 'medianAdjustedCloseAfter',
        'adjustedCloseAfterBeforeRatio', 'interpretation',
      ]
    ),
  ]);
  const errors = symbolAudits.filter((row) => row.status === 'error');
  console.log(
    `Volume audit complete: ${successful.length}/${symbols.length} symbols, ${eventAudits.length} split/bonus events, ${errors.length} errors. Results: ${resultsDirectory}`
  );
  if (errors.length) process.exitCode = 1;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runAudit().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Volume history audit failed.'
    );
    process.exitCode = 1;
  });

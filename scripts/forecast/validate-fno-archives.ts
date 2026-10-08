import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import { inspectHistoricalFnoArchive } from '../../src/forecast/fno-archive.js';

function parseDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  const exchange = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  let date = iso?.[0];
  if (exchange) {
    const month =
      ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(exchange[2].toLowerCase()) + 1;
    if (month)
      date = `${exchange[3]}-${String(month).padStart(2, '0')}-${String(Number(exchange[1])).padStart(2, '0')}`;
  }
  if (!date) return;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return;
  return parsed.toISOString().slice(0, 10) === date ? date : undefined;
}

function spotDate(row: Record<string, unknown>): string | undefined {
  return parseDate(row.mtimestamp ?? row.CH_TIMESTAMP ?? row.chTimestamp);
}

function hasValidSpotClose(row: Record<string, unknown>): boolean {
  const value =
    row.chClosingPrice ?? row.CH_CLOSING_PRICE ?? row.close ?? row.closePrice;
  const close =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/,/g, ''))
        : NaN;
  return Number.isFinite(close) && close > 0;
}

function formatDateList(dates: string[], limit = 10): string {
  if (!dates.length) return 'none';
  const shown = dates.slice(0, limit).join(', ');
  return dates.length > limit ? `${shown}, ... (${dates.length} total)` : shown;
}

async function fetchSpotRows(
  nse: NSEClient,
  symbol: string,
  from: string,
  to: string
) {
  const end = new Date(`${to}T12:00:00Z`);
  let start = new Date(`${from}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 1);
  const rows = [];

  while (start <= end) {
    const chunkEnd = new Date(
      Math.min(start.getTime() + 89 * 86400000, end.getTime())
    );
    rows.push(
      ...(await nse.historical.fetchEquityHistoricalData({
        symbol,
        from_date: start,
        to_date: chunkEnd,
        series: ['EQ'],
      }))
    );
    if (chunkEnd.getTime() >= end.getTime()) break;
    start = chunkEnd;
  }

  return rows;
}

async function main() {
  const archiveDirectory = resolve(process.cwd(), 'downloads');
  const requestedSymbols = process.argv
    .slice(2)
    .flatMap((argument) => argument.split(','))
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const symbols = requestedSymbols.length
    ? [...new Set(requestedSymbols)]
    : (await readdir(archiveDirectory, { withFileTypes: true }))
        .filter(
          (entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.csv')
        )
        .map((entry) => entry.name.slice(0, -4).toUpperCase())
        .sort();

  if (!symbols.length)
    throw new Error(`No F&O CSV archives found in ${archiveDirectory}.`);
  for (const symbol of symbols) {
    if (!/^[A-Z0-9&._-]{1,30}$/.test(symbol))
      throw new Error(`Invalid archive symbol: ${symbol}`);
  }

  const nse = new NSEClient(join(archiveDirectory, 'validation-cache'), {
    server: false,
  });
  let failed = false;

  for (const symbol of symbols) {
    console.log(`\n${symbol}`);
    try {
      const inspection = await inspectHistoricalFnoArchive(
        archiveDirectory,
        symbol
      );
      const firstDate = inspection.dates[0];
      const lastDate = inspection.dates.at(-1);
      const issues: string[] = [];

      if (!inspection.schema.length) issues.push('unsupported or empty schema');
      if (inspection.symbols.some((source) => source !== symbol))
        issues.push(`file contains other symbols: ${inspection.symbols.join(', ')}`);
      if (inspection.malformedRows)
        issues.push(`${inspection.malformedRows} malformed target-symbol rows`);
      if (inspection.conflictingContracts.length)
        issues.push(
          `${inspection.conflictingContracts.length} conflicting contracts`
        );
      if (!inspection.futuresDates.length) issues.push('no valid futures rows');
      if (!inspection.callDates.length) issues.push('no valid CE rows');
      if (!inspection.putDates.length) issues.push('no valid PE rows');

      console.log(
        `  schema: ${inspection.schema.join(' + ') || 'not recognized'}; valid contracts: ${inspection.contractRows}`
      );
      console.log(
        `  archive coverage: ${firstDate ?? 'none'} to ${lastDate ?? 'none'} (${inspection.dates.length} dates)`
      );
      console.log(
        `  futures/call/put dates: ${inspection.futuresDates.length}/${inspection.callDates.length}/${inspection.putDates.length}`
      );

      if (firstDate && lastDate) {
        const rawRows = await fetchSpotRows(nse, symbol, firstDate, lastDate);
        if (!Array.isArray(rawRows))
          throw new Error('NSE spot history endpoint did not return rows.');
        const foreignSpotRow = rawRows.find((row) => {
          const rowSymbol = row.chSymbol ?? row.CH_SYMBOL;
          return (
            typeof rowSymbol === 'string' &&
            rowSymbol.toUpperCase() !== symbol
          );
        });
        if (foreignSpotRow)
          throw new Error('NSE spot history returned a different symbol.');
        const spotDates = [
          ...new Set(
            rawRows
              .filter(hasValidSpotClose)
              .map(spotDate)
              .filter((date): date is string => Boolean(date))
              .filter((date) => date >= firstDate && date <= lastDate)
          ),
        ].sort();
        const spotDateSet = new Set(spotDates);
        const archiveSpotOverlap = inspection.dates.filter((date) =>
          spotDateSet.has(date)
        );
        const missingFutures = spotDates.filter(
          (date) => !inspection.futuresDates.includes(date)
        );
        const missingCalls = spotDates.filter(
          (date) => !inspection.callDates.includes(date)
        );
        const missingPuts = spotDates.filter(
          (date) => !inspection.putDates.includes(date)
        );
        const archiveDatesWithoutSpot = inspection.dates.filter(
          (date) => !spotDateSet.has(date)
        );

        console.log(
          `  spot overlap: ${archiveSpotOverlap.length}/${inspection.dates.length} archive dates; ${spotDates.length} spot sessions`
        );
        console.log(
          `  missing spot sessions — futures: ${missingFutures.length}; CE: ${missingCalls.length}; PE: ${missingPuts.length}`
        );
        if (missingFutures.length)
          console.log(`    futures gaps: ${formatDateList(missingFutures)}`);
        if (missingCalls.length)
          console.log(`    CE gaps: ${formatDateList(missingCalls)}`);
        if (missingPuts.length)
          console.log(`    PE gaps: ${formatDateList(missingPuts)}`);
        if (archiveDatesWithoutSpot.length)
          console.log(
            `  archive dates without spot history: ${formatDateList(archiveDatesWithoutSpot)}`
          );

        if (!spotDates.length) issues.push('no matching NSE spot history');
        if (archiveSpotOverlap.length !== inspection.dates.length)
          issues.push('one or more archive dates have no spot-history match');
        if (missingFutures.length) issues.push('missing futures on spot sessions');
        if (missingCalls.length) issues.push('missing CE rows on spot sessions');
        if (missingPuts.length) issues.push('missing PE rows on spot sessions');
      } else {
        issues.push('no valid archive dates to compare with spot history');
      }

      if (issues.length) {
        failed = true;
        console.log(`  FAIL: ${issues.join('; ')}`);
      } else {
        console.log('  PASS');
      }
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`  ERROR: ${message}`);
    }
  }

  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`F&O archive validation failed: ${message}`);
  process.exitCode = 1;
});

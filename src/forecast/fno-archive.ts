import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import type { FnoData } from './fno-features.js';

interface ContractRow {
  date: string;
  expiry: string;
  strike: string;
  optionType: string;
  price: number;
  openInterest: number;
  volume: number;
}

export type FnoOptionsAggregation =
  | 'all-active'
  | 'front-expiry'
  | 'front-expiry-atm';

export interface FnoArchiveOptions {
  optionsAggregation?: FnoOptionsAggregation;
}

export interface FnoArchiveInspection {
  schema: Array<'legacy' | 'modern'>;
  dates: string[];
  futuresDates: string[];
  callDates: string[];
  putDates: string[];
  contractRows: number;
  malformedRows: number;
  symbols: string[];
  conflictingContracts: string[];
}

function splitCsvRow(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return;
  const text = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) {
    const parsed = new Date(`${text}T00:00:00Z`);
    return parsed.toISOString().slice(0, 10) === text ? text : undefined;
  }
  const date = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(text);
  if (!date) return;
  const month =
    ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(date[2].toLowerCase()) + 1;
  if (!month) return;
  const normalized = `${date[3]}-${String(month).padStart(2, '0')}-${String(Number(date[1])).padStart(2, '0')}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : undefined;
}

function number(value: string | undefined): number | undefined {
  if (!value?.trim()) return;
  const result = Number(value.replace(/,/g, '').trim());
  return Number.isFinite(result) ? result : undefined;
}

function readContractRow(
  columns: string[],
  symbol: string
): ContractRow | undefined {
  const date = parseDate(columns[0]) ?? parseDate(columns[18]);
  if (!date) return;

  const legacy = columns[3]?.toUpperCase() === symbol.toUpperCase();
  const modern =
    columns[20] === 'FO' && columns[25]?.toUpperCase() === symbol.toUpperCase();
  if (!legacy && !modern) return;

  const instrument = legacy ? columns[2] : columns[22];
  const optionType = legacy ? columns[6] : columns[30];
  const isFuture = instrument === 'FUTSTK' || instrument === 'STF';
  const isOption =
    instrument === 'OPTSTK' ||
    instrument === 'STO' ||
    optionType === 'CE' ||
    optionType === 'PE';
  if (!isFuture && !isOption) return;
  if (isOption && optionType !== 'CE' && optionType !== 'PE') return;

  const expiry = parseDate(legacy ? columns[4] : columns[27]);
  const price = number(
    legacy
      ? columns[10] || columns[11]
      : columns[35] || columns[39]
  );
  const openInterest = number(legacy ? columns[14] : columns[40]);
  const volume = number(legacy ? columns[12] : columns[42]);
  const strike = legacy ? columns[5] : columns[29];
  if (
    !expiry ||
    price === undefined ||
    price < 0 ||
    openInterest === undefined ||
    openInterest < 0 ||
    volume === undefined ||
    volume < 0
  )
    return;
  return {
    date,
    expiry,
    strike: strike ?? '0',
    optionType: isFuture ? 'XX' : optionType,
    price,
    openInterest,
    volume,
  };
}

function archiveRowIdentity(
  columns: string[]
): { schema: 'legacy' | 'modern'; symbol: string } | undefined {
  const legacyInstrument = columns[2]?.toUpperCase();
  if (
    (legacyInstrument === 'FUTSTK' || legacyInstrument === 'OPTSTK') &&
    columns[3]?.trim()
  )
    return { schema: 'legacy', symbol: columns[3].trim().toUpperCase() };

  const modernInstrument = columns[22]?.toUpperCase();
  if (
    columns[20] === 'FO' &&
    (modernInstrument === 'STF' || modernInstrument === 'STO') &&
    columns[25]?.trim()
  )
    return { schema: 'modern', symbol: columns[25].trim().toUpperCase() };
}

function contractKey(row: ContractRow): string {
  return `${row.date}|${row.expiry}|${row.strike}|${row.optionType}`;
}

export async function inspectHistoricalFnoArchive(
  directory: string,
  symbol: string
): Promise<FnoArchiveInspection> {
  if (!/^[A-Z0-9&._-]{1,30}$/i.test(symbol))
    throw new Error('Invalid symbol for historical F&O archive.');

  const path = join(directory, `${symbol.toUpperCase()}.csv`);
  const schemas = new Set<'legacy' | 'modern'>();
  const symbols = new Set<string>();
  const dates = new Set<string>();
  const futuresDates = new Set<string>();
  const callDates = new Set<string>();
  const putDates = new Set<string>();
  const contracts = new Map<string, ContractRow>();
  const conflictingContracts = new Set<string>();
  let contractRows = 0;
  let malformedRows = 0;
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let firstLine = true;
  try {
    for await (const line of reader) {
      if (firstLine) {
        firstLine = false;
        continue;
      }
      const columns = splitCsvRow(line);
      const identity = archiveRowIdentity(columns);
      if (!identity) continue;
      schemas.add(identity.schema);
      symbols.add(identity.symbol);
      if (identity.symbol !== symbol.toUpperCase()) continue;

      const row = readContractRow(columns, symbol);
      if (!row) {
        malformedRows++;
        continue;
      }
      contractRows++;
      dates.add(row.date);
      if (row.expiry >= row.date) {
        if (row.optionType === 'XX') futuresDates.add(row.date);
        if (row.optionType === 'CE') callDates.add(row.date);
        if (row.optionType === 'PE') putDates.add(row.date);
      }

      const key = contractKey(row);
      const previous = contracts.get(key);
      if (
        previous &&
        (previous.price !== row.price ||
          previous.openInterest !== row.openInterest ||
          previous.volume !== row.volume)
      )
        conflictingContracts.add(key);
      else if (!previous) contracts.set(key, row);
    }
  } finally {
    reader.close();
  }

  const sorted = (values: Set<string>) => [...values].sort();
  return {
    schema: [...schemas].sort(),
    dates: sorted(dates),
    futuresDates: sorted(futuresDates),
    callDates: sorted(callDates),
    putDates: sorted(putDates),
    contractRows,
    malformedRows,
    symbols: sorted(symbols),
    conflictingContracts: sorted(conflictingContracts),
  };
}

function addUnique(
  contracts: Map<string, ContractRow>,
  row: ContractRow,
  kind: string
) {
  const key = contractKey(row);
  const previous = contracts.get(key);
  if (!previous) {
    contracts.set(key, row);
    return;
  }
  if (
    previous.price !== row.price ||
    previous.openInterest !== row.openInterest ||
    previous.volume !== row.volume
  )
    throw new Error(`Conflicting ${kind} archive rows for contract ${key}.`);
}

export async function loadHistoricalFnoArchive(
  directory: string,
  symbol: string,
  spotObservations: Array<{ date: string; close: number; volume?: number }>,
  options: FnoArchiveOptions = {}
): Promise<FnoData[]> {
  if (!/^[A-Z0-9&._-]{1,30}$/i.test(symbol))
    throw new Error('Invalid symbol for historical F&O archive.');
  const path = join(directory, `${symbol.toUpperCase()}.csv`);
  const spots = new Map(
    spotObservations
      .filter((row) => Number.isFinite(row.close) && row.close > 0)
      .map((row) => [row.date, row])
  );
  const futuresByDate = new Map<string, Map<string, ContractRow>>();
  const optionsByDate = new Map<string, Map<string, ContractRow>>();
  const reader = createInterface({
    input: createReadStream(path, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  let firstLine = true;
  try {
    for await (const line of reader) {
      if (firstLine) {
        firstLine = false;
        continue;
      }
      const row = readContractRow(splitCsvRow(line), symbol);
      if (!row || !spots.has(row.date)) continue;
      const isFuture = row.optionType === 'XX';
      const byDate = isFuture ? futuresByDate : optionsByDate;
      const contracts = byDate.get(row.date) ?? new Map<string, ContractRow>();
      addUnique(contracts, row, isFuture ? 'futures' : 'options');
      byDate.set(row.date, contracts);
    }
  } finally {
    reader.close();
  }

  const result: FnoData[] = [];
  for (const [date, contracts] of [...futuresByDate].sort(([a], [b]) =>
    a.localeCompare(b)
  )) {
    const activeFutures = [...contracts.values()].filter(
      (contract) => contract.expiry >= date
    );
    const frontMonth = activeFutures
      .slice()
      .sort((a, b) => a.expiry.localeCompare(b.expiry))[0];
    if (!frontMonth) continue;

    const activeOptions = [
      ...(optionsByDate.get(date)?.values() ?? []),
    ].filter((contract) => contract.expiry >= date);
    const spot = spots.get(date)!;
    const aggregation = options.optionsAggregation ?? 'all-active';
    if (
      aggregation !== 'all-active' &&
      aggregation !== 'front-expiry' &&
      aggregation !== 'front-expiry-atm'
    )
      throw new Error(`Unsupported options aggregation: ${aggregation}`);
    let selectedOptions =
      aggregation === 'all-active'
        ? activeOptions
        : activeOptions.filter((contract) => contract.expiry === frontMonth.expiry);
    if (aggregation === 'front-expiry-atm') {
      selectedOptions = (['CE', 'PE'] as const).flatMap((optionType) => {
        const contracts = selectedOptions.filter(
          (contract) =>
            contract.optionType === optionType &&
            Number.isFinite(Number(contract.strike))
        );
        const nearestStrike = contracts
          .map((contract) => Number(contract.strike))
          .sort(
            (left, right) =>
              Math.abs(left - spot.close) - Math.abs(right - spot.close)
          )[0];
        return nearestStrike === undefined
          ? []
          : contracts.filter(
              (contract) => Number(contract.strike) === nearestStrike
            );
      });
    }
    const calls = selectedOptions.filter((contract) => contract.optionType === 'CE');
    const puts = selectedOptions.filter((contract) => contract.optionType === 'PE');
    result.push({
      date,
      spotsPrice: spot.close,
      futuresPrice: frontMonth.price,
      futuresOpenInterest: activeFutures.reduce(
        (sum, contract) => sum + contract.openInterest,
        0
      ),
      callOpenInterest: calls.reduce(
        (sum, contract) => sum + contract.openInterest,
        0
      ),
      putOpenInterest: puts.reduce(
        (sum, contract) => sum + contract.openInterest,
        0
      ),
      callVolume: calls.reduce((sum, contract) => sum + contract.volume, 0),
      putVolume: puts.reduce((sum, contract) => sum + contract.volume, 0),
      spotVolume: spot.volume ?? 0,
    });
  }

  if (!result.length)
    throw new Error(
      `No matching historical F&O rows for ${symbol} were found in ${path}.`
    );
  return result;
}

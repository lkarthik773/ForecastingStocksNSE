import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  inspectHistoricalFnoArchive,
  loadHistoricalFnoArchive,
} from './fno-archive.js';

const directories: string[] = [];

async function fixtureFile(symbol: string, rows: string[][]) {
  const directory = await mkdtemp(join(tmpdir(), 'nse-fno-archive-'));
  directories.push(directory);
  const header = Array.from({ length: 52 }, (_, index) =>
    index === 0 ? 'source_trade_date' : `field${index}`
  );
  await writeFile(
    join(directory, `${symbol}.csv`),
    [header, ...rows].map((row) => row.join(',')).join('\n'),
    'utf8'
  );
  return directory;
}

function legacyRow(
  instrument: 'FUTSTK' | 'OPTSTK',
  optionType: 'XX' | 'CE' | 'PE',
  expiry: string,
  strike: string,
  close: string,
  openInterest: string,
  volume: string
) {
  const row = Array.from({ length: 52 }, () => '');
  row[0] = '2021-10-01';
  row[2] = instrument;
  row[3] = 'TCS';
  row[4] = expiry;
  row[5] = strike;
  row[6] = optionType;
  row[10] = close;
  row[11] = close;
  row[12] = volume;
  row[14] = openInterest;
  return row;
}

function modernRow(
  instrument: 'STF' | 'STO',
  optionType: 'XX' | 'CE' | 'PE',
  expiry: string,
  strike: string,
  close: string,
  openInterest: string,
  volume: string
) {
  const row = Array.from({ length: 52 }, () => '');
  row[0] = '2024-07-08';
  row[18] = '2024-07-08';
  row[20] = 'FO';
  row[22] = instrument;
  row[25] = 'TCS';
  row[27] = expiry;
  row[29] = strike;
  row[30] = optionType;
  row[35] = close;
  row[39] = close;
  row[40] = openInterest;
  row[42] = volume;
  return row;
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe('historical F&O archive loader', () => {
  it('inspects archive schema, coverage and contract conflicts', async () => {
    const directory = await fixtureFile('TCS', [
      legacyRow('FUTSTK', 'XX', '28-Oct-2021', '0', '101', '1000', '10'),
      legacyRow('OPTSTK', 'CE', '28-Oct-2021', '100', '3', '200', '30'),
      legacyRow('OPTSTK', 'PE', '28-Oct-2021', '100', '4', '300', '40'),
      legacyRow('OPTSTK', 'PE', '28-Oct-2021', '100', '4', '301', '40'),
    ]);

    await expect(inspectHistoricalFnoArchive(directory, 'TCS')).resolves.toEqual({
      schema: ['legacy'],
      dates: ['2021-10-01'],
      futuresDates: ['2021-10-01'],
      callDates: ['2021-10-01'],
      putDates: ['2021-10-01'],
      contractRows: 4,
      malformedRows: 0,
      symbols: ['TCS'],
      conflictingContracts: [
        '2021-10-01|2021-10-28|100|PE',
      ],
    });
  });

  it('inspects the modern archive schema and counts active contract dates', async () => {
    const directory = await fixtureFile('TCS', [
      modernRow('STF', 'XX', '2024-07-25', '0', '110', '1000', '20'),
      modernRow('STO', 'CE', '2024-07-25', '100', '5', '400', '60'),
      modernRow('STO', 'PE', '2024-07-25', '100', '6', '600', '70'),
    ]);

    await expect(inspectHistoricalFnoArchive(directory, 'TCS')).resolves.toMatchObject({
      schema: ['modern'],
      dates: ['2024-07-08'],
      futuresDates: ['2024-07-08'],
      callDates: ['2024-07-08'],
      putDates: ['2024-07-08'],
      contractRows: 3,
      symbols: ['TCS'],
    });
  });

  it('loads the legacy NSE contract schema and aggregates option OI and volume', async () => {
    const directory = await fixtureFile('TCS', [
      legacyRow('FUTSTK', 'XX', '28-Oct-2021', '0', '101', '1000', '10'),
      legacyRow('FUTSTK', 'XX', '25-Nov-2021', '0', '102', '500', '5'),
      legacyRow('OPTSTK', 'CE', '28-Oct-2021', '100', '3', '200', '30'),
      legacyRow('OPTSTK', 'PE', '28-Oct-2021', '100', '4', '300', '40'),
      legacyRow('OPTSTK', 'CE', '25-Nov-2021', '110', '2', '50', '7'),
    ]);

    const result = await loadHistoricalFnoArchive(directory, 'TCS', [
      { date: '2021-10-01', close: 100, volume: 1000 },
    ]);

    expect(result).toEqual([
      {
        date: '2021-10-01',
        spotsPrice: 100,
        futuresPrice: 101,
        futuresOpenInterest: 1500,
        callOpenInterest: 250,
        putOpenInterest: 300,
        callVolume: 37,
        putVolume: 40,
        spotVolume: 1000,
      },
    ]);
  });

  it('loads the post-2024 NSE FO schema with contract-specific columns', async () => {
    const directory = await fixtureFile('TCS', [
      modernRow('STF', 'XX', '2024-07-25', '0', '110', '1000', '20'),
      modernRow('STF', 'XX', '2024-08-29', '0', '111', '500', '10'),
      modernRow('STO', 'CE', '2024-07-25', '100', '5', '400', '60'),
      modernRow('STO', 'PE', '2024-07-25', '100', '6', '600', '70'),
    ]);

    const result = await loadHistoricalFnoArchive(directory, 'TCS', [
      { date: '2024-07-08', close: 105 },
    ]);

    expect(result).toEqual([
      {
        date: '2024-07-08',
        spotsPrice: 105,
        futuresPrice: 110,
        futuresOpenInterest: 1500,
        callOpenInterest: 400,
        putOpenInterest: 600,
        callVolume: 60,
        putVolume: 70,
        spotVolume: 0,
      },
    ]);
  });

  it('limits options to the front expiry and nearest available ATM strikes', async () => {
    const directory = await fixtureFile('TCS', [
      modernRow('STF', 'XX', '2024-07-25', '0', '110', '1000', '20'),
      modernRow('STF', 'XX', '2024-08-29', '0', '111', '500', '10'),
      modernRow('STO', 'CE', '2024-07-25', '100', '5', '200', '30'),
      modernRow('STO', 'PE', '2024-07-25', '100', '6', '300', '40'),
      modernRow('STO', 'CE', '2024-07-25', '110', '4', '400', '50'),
      modernRow('STO', 'PE', '2024-07-25', '110', '7', '500', '60'),
      modernRow('STO', 'CE', '2024-08-29', '100', '8', '600', '70'),
      modernRow('STO', 'PE', '2024-08-29', '100', '9', '700', '80'),
    ]);

    const result = await loadHistoricalFnoArchive(
      directory,
      'TCS',
      [{ date: '2024-07-08', close: 105 }],
      { optionsAggregation: 'front-expiry-atm' }
    );

    expect(result[0]).toMatchObject({
      callOpenInterest: 200,
      putOpenInterest: 300,
      callVolume: 30,
      putVolume: 40,
    });
  });

  it('rejects conflicting duplicate contracts instead of double-counting them', async () => {
    const directory = await fixtureFile('TCS', [
      legacyRow('FUTSTK', 'XX', '28-Oct-2021', '0', '101', '1000', '10'),
      legacyRow('OPTSTK', 'CE', '28-Oct-2021', '100', '3', '200', '30'),
      legacyRow('OPTSTK', 'CE', '28-Oct-2021', '100', '3', '250', '30'),
    ]);

    await expect(
      loadHistoricalFnoArchive(directory, 'TCS', [
        { date: '2021-10-01', close: 100 },
      ])
    ).rejects.toThrow('Conflicting options archive rows');
  });
});

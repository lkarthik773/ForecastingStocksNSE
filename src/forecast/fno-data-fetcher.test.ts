import { describe, expect, it, vi } from 'vitest';
import {
  fetchFnoData,
  getSymbolFnoSector,
  isSymbolEligibleForFno,
} from './fno-data-fetcher.js';
import type { FnoData } from './fno-features.js';

const row = (date: string, i = 0): FnoData => ({
  date,
  spotsPrice: 100 + i,
  futuresPrice: 101 + i,
  futuresOpenInterest: 1000,
  callOpenInterest: 500,
  putOpenInterest: 600,
  callVolume: 100,
  putVolume: 120,
  spotVolume: 10_000,
});

describe('F&O data fetcher', () => {
  it('returns merged, sorted F&O observations with the documented structure', async () => {
    const historicalApi = {
      fetchEquityHistoricalData: vi.fn().mockResolvedValue([
        { date: '02/01/2026', close: '102', volume: '1200' },
        { date: '01-Jan-2026', close: '101', volume: '1100' },
      ]),
      fetchHistoricalFnoData: vi.fn().mockResolvedValue([
        { date: '2026-01-02', close: '103', openInterest: '2000' },
        { date: '01-Jan-2026', close: '102', openInterest: '1900' },
      ]),
    };
    const optionsApi = {
      getExpiryDatesV3: vi.fn().mockResolvedValue([]),
      getFilteredOptionChainV3: vi.fn(),
    };
    const result = await fetchFnoData('TCS', historicalApi as any, optionsApi as any, new Date('2026-01-01'), new Date('2026-01-02'));
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.date)).toEqual(['2026-01-01', '2026-01-02']);
    expect(Object.keys(result[0])).toEqual(expect.arrayContaining(Object.keys(row('2026-01-01'))));
    expect(result[0].futuresOpenInterest).toBe(1900);
  });

  it.each([
    ['01-Jan-2026', '2026-01-01'],
    ['01/01/2026', '2026-01-01'],
    ['2026-01-01', '2026-01-01'],
  ])('normalizes %s dates to %s while merging', async (spotDate, expected) => {
    const historicalApi = {
      fetchEquityHistoricalData: vi.fn().mockResolvedValue([{ date: spotDate, close: '100', volume: '1' }]),
      fetchHistoricalFnoData: vi.fn().mockResolvedValue([{ date: expected, close: '101', openInterest: '2' }]),
    };
    const optionsApi = { getExpiryDatesV3: vi.fn().mockResolvedValue([]) };
    const result = await fetchFnoData('TCS', historicalApi as any, optionsApi as any, new Date(), new Date());
    expect(result[0].date).toBe(expected);
  });

  it('returns an empty result and does not throw when spot or APIs fail', async () => {
    const optionsApi = { getExpiryDatesV3: vi.fn().mockRejectedValue(new Error('network')) };
    await expect(fetchFnoData('TCS', { fetchEquityHistoricalData: vi.fn().mockResolvedValue([]) } as any, optionsApi as any, new Date(), new Date())).resolves.toEqual([]);
    await expect(fetchFnoData('TCS', { fetchEquityHistoricalData: vi.fn().mockRejectedValue(new Error('network')) } as any, optionsApi as any, new Date(), new Date())).resolves.toEqual([]);
  });

  it('checks minimum days, OI coverage, options coverage, and premium', () => {
    const data = Array.from({ length: 100 }, (_, i) => row(`2026-01-${String(i + 1).padStart(2, '0')}`, i));
    expect(isSymbolEligibleForFno(data).isEligible).toBe(true);
    expect(isSymbolEligibleForFno(data.slice(0, 99)).reason).toContain('Insufficient');
    expect(isSymbolEligibleForFno(data.map((d, i) => i < 20 ? { ...d, futuresOpenInterest: 0 } : d)).reason).toContain('OI coverage');
    expect(isSymbolEligibleForFno(data.map((d, i) => i < 60 ? { ...d, callOpenInterest: 0 } : d)).reason).toContain('options coverage');
    expect(isSymbolEligibleForFno(data.map((d) => ({ ...d, futuresPrice: 130, spotsPrice: 100 }))).reason).toContain('premium');
  });

  it('maps known symbols case-insensitively and defaults unknown symbols', () => {
    expect(getSymbolFnoSector('hdfcbank')).toBe('BANKNIFTY');
    expect(getSymbolFnoSector('tcs')).toBe('NIFTY50');
    expect(getSymbolFnoSector('unknown')).toBe('NIFTY50');
  });
});

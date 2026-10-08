import { describe, expect, it, vi } from 'vitest';
import { fetchHistoricalFuturesObservations } from './futures-data-fetcher.js';

describe('historical futures data fetcher', () => {
  it('uses front-month price and aggregates open interest across active expiries', async () => {
    const historicalApi = {
      fetchHistoricalFnoData: vi.fn().mockResolvedValue([
        {
          FH_TIMESTAMP: '01-Jan-2026',
          FH_EXPIRY_DT: '29-Jan-2026',
          FH_CLOSING_PRICE: '102',
          FH_OPEN_INT: '1,000',
        },
        {
          FH_TIMESTAMP: '2026-01-01',
          FH_EXPIRY_DT: '26-Feb-2026',
          FH_CLOSING_PRICE: '103',
          FH_OPEN_INT: '500',
        },
        {
          FH_TIMESTAMP: '2026-01-01',
          FH_EXPIRY_DT: '25-Dec-2025',
          FH_CLOSING_PRICE: '101',
          FH_OPEN_INT: '900',
        },
      ]),
    };

    const result = await fetchHistoricalFuturesObservations(
      'TCS',
      historicalApi as never,
      [{ date: '2026-01-01', close: 100 }],
      new Date('2026-01-01'),
      new Date('2026-01-01')
    );

    expect(historicalApi.fetchHistoricalFnoData).toHaveBeenCalledWith(
      expect.objectContaining({ symbol: 'TCS', instrument: 'FUTSTK' })
    );
    expect(result).toEqual([
      {
        date: '2026-01-01',
        spotClose: 100,
        futuresClose: 102,
        futuresOpenInterest: 1500,
      },
    ]);
  });

  it('rejects ambiguous rows when no expiry is available to identify the front month', async () => {
    const historicalApi = {
      fetchHistoricalFnoData: vi.fn().mockResolvedValue([
        { date: '2026-01-01', close: '102', openInterest: '1,000' },
        { date: '2026-01-01', close: '103', openInterest: '500' },
      ]),
    };

    await expect(
      fetchHistoricalFuturesObservations(
        'TCS',
        historicalApi as never,
        [{ date: '2026-01-01', close: 100 }],
        new Date('2026-01-01'),
        new Date('2026-01-01')
      )
    ).rejects.toThrow('Cannot identify the front-month futures contract');
  });
});

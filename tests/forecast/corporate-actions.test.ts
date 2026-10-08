import { describe, expect, it } from 'vitest';
import {
  adjustHistoricalRows,
  parseNseShareAdjustments,
} from '../../src/forecast/corporate-actions.js';

describe('causal split and bonus adjustment', () => {
  it('parses NSE split and bonus terms and deduplicates identical records', () => {
    const actions = parseNseShareAdjustments(
      [
        {
          symbol: 'BAJFINANCE',
          exDate: '16-Jun-2025',
          subject: 'Bonus 4:1',
        },
        {
          symbol: 'BAJFINANCE',
          exDate: '16-Jun-2025',
          subject:
            'Face Value Split (Sub-Division) - From Rs 2/- Per Share To Re 1/- Per Share',
        },
        {
          symbol: 'BAJFINANCE',
          exDate: '16-Jun-2025',
          subject: 'Bonus 4:1',
        },
        {
          symbol: 'BAJFINANCE',
          exDate: '16-Jun-2025',
          subject: 'Dividend - Rs 12 Per Share',
        },
      ],
      'BAJFINANCE'
    );

    expect(actions.map(({ shareFactor }) => shareFactor)).toEqual([5, 2]);
    expect(actions.map(({ exDate }) => exDate)).toEqual([
      '2025-06-16',
      '2025-06-16',
    ]);
  });

  it('back-adjusts pre-ex-date OHLC rows and leaves ex-date onward unchanged', () => {
    const rows = [
      {
        mtimestamp: '2024-10-25',
        chOpeningPrice: '2600',
        chTradeHighPrice: '2700',
        chTradeLowPrice: '2500',
        chClosingPrice: '2655.7',
      },
      {
        mtimestamp: '2024-10-28',
        chOpeningPrice: '1300',
        chTradeHighPrice: '1350',
        chTradeLowPrice: '1290',
        chClosingPrice: '1334.35',
      },
    ];
    const adjusted = adjustHistoricalRows(rows, [
      {
        exDate: '2024-10-28',
        subject: 'Bonus 1:1',
        shareFactor: 2,
      },
    ]);

    expect(adjusted[0].chClosingPrice).toBeCloseTo(1327.85);
    expect(adjusted[0].chOpeningPrice).toBe(1300);
    expect(adjusted[0].chTradeHighPrice).toBe(1350);
    expect(adjusted[0].chTradeLowPrice).toBe(1250);
    expect(adjusted[1].chClosingPrice).toBe('1334.35');
    expect(rows[0].chClosingPrice).toBe('2655.7');
  });

  it('back-adjusts NSE DD-Mon-YYYY historical dates without truncating the year', () => {
    const adjusted = adjustHistoricalRows(
      [
        {
          mtimestamp: '25-Oct-2024',
          chOpeningPrice: 2600,
          chTradeHighPrice: 2700,
          chTradeLowPrice: 2500,
          chClosingPrice: 2655.7,
        },
        {
          mtimestamp: '28-Oct-2024',
          chOpeningPrice: 1300,
          chTradeHighPrice: 1350,
          chTradeLowPrice: 1290,
          chClosingPrice: 1334.35,
        },
      ],
      [
        {
          exDate: '2024-10-28',
          subject: 'Bonus 1:1',
          shareFactor: 2,
        },
      ]
    );

    expect(adjusted[0].chClosingPrice).toBeCloseTo(1327.85);
    expect(adjusted[0].chOpeningPrice).toBe(1300);
    expect(adjusted[0].chTradeHighPrice).toBe(1350);
    expect(adjusted[0].chTradeLowPrice).toBe(1250);
    expect(adjusted[1].chClosingPrice).toBe(1334.35);
  });

  it('fails explicitly for an unparseable split/bonus or a mismatched symbol', () => {
    expect(() =>
      parseNseShareAdjustments(
        [{ symbol: 'TCS', exDate: '01-Jan-2025', subject: 'Bonus shares' }],
        'TCS'
      )
    ).toThrow('Corporate bonus ratio cannot be interpreted');
    expect(() =>
      parseNseShareAdjustments(
        [{ symbol: 'INFY', exDate: '01-Jan-2025', subject: 'Bonus 1:1' }],
        'TCS'
      )
    ).toThrow('different symbol');
  });
});

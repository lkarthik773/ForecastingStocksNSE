import type { NSE, BSE, ForecastParams } from '../../src/index.js';
import { FORECAST_HISTORY_MONTH_LIMITS } from '../../src/forecast/forecast-api.js';

export interface Field {
  name: string;
  type: 'string' | 'date' | 'number';
  required?: boolean;
  example?: string;
  choices?: string[];
  min?: number;
  max?: number;
  description?: string;
}

export interface Endpoint {
  id: string;
  exchange: 'NSE' | 'BSE';
  group: string;
  title: string;
  method: string;
  fields: Field[];
  invoke: (params: Record<string, unknown>) => unknown;
}

export class InputError extends Error {}

function calendarDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function createEndpoints({
  nse,
  bse,
}: {
  nse: NSE;
  bse: BSE;
}): Endpoint[] {
  const symbol: Field = {
    name: 'symbol',
    type: 'string',
    required: true,
    example: 'RELIANCE',
  };
  const scripcode: Field = {
    name: 'scripcode',
    type: 'string',
    required: true,
    example: '500325',
  };
  const query: Field = {
    name: 'query',
    type: 'string',
    required: true,
    example: 'reliance',
  };
  const dates: Field[] = [
    { name: 'from_date', type: 'date' },
    { name: 'to_date', type: 'date' },
  ];
  const bseDates: Field[] = [
    { name: 'fromDate', type: 'date' },
    { name: 'toDate', type: 'date' },
    { ...scripcode, required: false },
  ];
  const movers: Field[] = [
    {
      name: 'by',
      type: 'string',
      choices: ['group', 'index'],
      example: 'group',
    },
    { name: 'name', type: 'string', example: 'A' },
  ];
  return [
    {
      id: 'nse-forecast',
      exchange: 'NSE',
      group: 'Forecast',
      title: 'Stock forecast',
      method: 'forecastStock',
      fields: [
        symbol,
        {
          name: 'horizon',
          type: 'string',
          choices: ['next_day', 'week', 'custom'],
          example: 'next_day',
        },
        { name: 'start_date', type: 'date' },
        { name: 'end_date', type: 'date' },
        {
          name: 'historyMonths',
          type: 'number',
          example: String(FORECAST_HISTORY_MONTH_LIMITS.defaultMonths),
          min: FORECAST_HISTORY_MONTH_LIMITS.minMonths,
          max: FORECAST_HISTORY_MONTH_LIMITS.maxMonths,
          description: 'Historical lookback in months (36–120); rolling folds remain fixed at 14/3/6 months.',
        },
        {
          name: 'context',
          type: 'string',
          choices: ['auto', 'off'],
          example: 'auto',
        },
        {
          name: 'model',
          type: 'string',
          choices: ['baseline', 'technical', 'technical_finbert'],
          example: 'technical',
        },
        {
          name: 'sentiment',
          type: 'string',
          choices: ['off', 'finbert'],
          example: 'off',
        },
      ],
      invoke: (params) =>
        nse.forecastStock({
          symbol: params.symbol as string,
          horizon: params.horizon as ForecastParams['horizon'],
          ...(params.model
            ? { model: params.model as ForecastParams['model'] }
            : {}),
          ...(params.sentiment
            ? { sentiment: params.sentiment as ForecastParams['sentiment'] }
            : {}),
          ...(params.context
            ? { context: params.context as ForecastParams['context'] }
            : {}),
          ...(params.start_date instanceof Date
            ? { start_date: calendarDate(params.start_date) }
            : {}),
          ...(params.end_date instanceof Date
            ? { end_date: calendarDate(params.end_date) }
            : {}),
          ...(typeof params.historyMonths === 'number'
            ? { historyMonths: params.historyMonths }
            : {}),
        }),
    },
    {
      id: 'nse-quote',
      exchange: 'NSE',
      group: 'Equity',
      title: 'Equity quote',
      method: 'equityQuote',
      fields: [symbol],
      invoke: (params) => nse.equityQuote(params.symbol as string),
    },
    {
      id: 'nse-meta',
      exchange: 'NSE',
      group: 'Equity',
      title: 'Equity metadata',
      method: 'equityMetaInfo',
      fields: [symbol],
      invoke: (params) => nse.equityMetaInfo(params.symbol as string),
    },
    {
      id: 'nse-stocks',
      exchange: 'NSE',
      group: 'Equity',
      title: 'Stocks by index',
      method: 'listEquityStocksByIndex',
      fields: [{ name: 'index', type: 'string', example: 'NIFTY 50' }],
      invoke: (params) =>
        nse.listEquityStocksByIndex(params.index as string | undefined),
    },
    {
      id: 'nse-indices',
      exchange: 'NSE',
      group: 'Equity',
      title: 'All indices',
      method: 'listIndices',
      fields: [],
      invoke: () => nse.listIndices(),
    },
    {
      id: 'nse-etf',
      exchange: 'NSE',
      group: 'Equity',
      title: 'Exchange traded funds',
      method: 'listEtf',
      fields: [],
      invoke: () => nse.listEtf(),
    },
    {
      id: 'nse-sme',
      exchange: 'NSE',
      group: 'Equity',
      title: 'SME securities',
      method: 'listSme',
      fields: [],
      invoke: () => nse.listSme(),
    },
    {
      id: 'nse-status',
      exchange: 'NSE',
      group: 'Market',
      title: 'Market status',
      method: 'market.getStatus',
      fields: [],
      invoke: () => nse.market.getStatus(),
    },
    {
      id: 'nse-search',
      exchange: 'NSE',
      group: 'Market',
      title: 'Symbol lookup',
      method: 'market.lookup',
      fields: [query],
      invoke: (params) => nse.market.lookup(params.query as string),
    },
    {
      id: 'nse-holidays',
      exchange: 'NSE',
      group: 'Market',
      title: 'Exchange holidays',
      method: 'holidays',
      fields: [
        {
          name: 'type',
          type: 'string',
          choices: ['trading', 'clearing'],
          example: 'trading',
        },
      ],
      invoke: (params) => nse.holidays(params.type),
    },
    {
      id: 'nse-block',
      exchange: 'NSE',
      group: 'Market',
      title: 'Block deals',
      method: 'blockDeals',
      fields: [],
      invoke: () => nse.blockDeals(),
    },
    {
      id: 'nse-options',
      exchange: 'NSE',
      group: 'Derivatives',
      title: 'Option chain',
      method: 'options.getOptionChain',
      fields: [{ ...symbol, example: 'NIFTY' }],
      invoke: (params) => nse.options.getOptionChain(params.symbol as string),
    },
    {
      id: 'nse-options-v3',
      exchange: 'NSE',
      group: 'Derivatives',
      title: 'Option chain V3',
      method: 'optionChainV3',
      fields: [
        { ...symbol, example: 'NIFTY' },
        {
          name: 'type',
          type: 'string',
          choices: ['Indices', 'Equity'],
          example: 'Indices',
        },
        { name: 'expiry', type: 'string' },
      ],
      invoke: (params) =>
        nse.optionChainV3(
          params as {
            symbol: string;
            type?: 'Indices' | 'Equity';
            expiry?: string;
          }
        ),
    },
    {
      id: 'nse-expiries',
      exchange: 'NSE',
      group: 'Derivatives',
      title: 'Expiry dates V3',
      method: 'getExpiryDatesV3',
      fields: [{ ...symbol, example: 'NIFTY' }],
      invoke: (params) => nse.getExpiryDatesV3(params.symbol as string),
    },
    {
      id: 'nse-lots',
      exchange: 'NSE',
      group: 'Derivatives',
      title: 'F&O lot sizes',
      method: 'fnoLots',
      fields: [],
      invoke: () => nse.fnoLots(),
    },
    {
      id: 'nse-history',
      exchange: 'NSE',
      group: 'Historical',
      title: 'Equity history',
      method: 'historical.fetchEquityHistoricalData',
      fields: [symbol, ...dates],
      invoke: (params) =>
        nse.historical.fetchEquityHistoricalData(
          params as { symbol: string; from_date?: Date; to_date?: Date }
        ),
    },
    {
      id: 'nse-vix',
      exchange: 'NSE',
      group: 'Historical',
      title: 'India VIX history',
      method: 'historical.fetchHistoricalVixData',
      fields: dates,
      invoke: (params) => nse.historical.fetchHistoricalVixData(params),
    },
    {
      id: 'nse-ipo-current',
      exchange: 'NSE',
      group: 'IPO',
      title: 'Current IPOs',
      method: 'ipo.listCurrentIPO',
      fields: [],
      invoke: () => nse.ipo.listCurrentIPO(),
    },
    {
      id: 'nse-ipo-upcoming',
      exchange: 'NSE',
      group: 'IPO',
      title: 'Upcoming IPOs',
      method: 'ipo.listUpcomingIPO',
      fields: [],
      invoke: () => nse.ipo.listUpcomingIPO(),
    },
    {
      id: 'nse-ipo-past',
      exchange: 'NSE',
      group: 'IPO',
      title: 'Past IPOs',
      method: 'listPastIPO',
      fields: dates,
      invoke: (params) =>
        nse.listPastIPO(
          params.from_date as Date | undefined,
          params.to_date as Date | undefined
        ),
    },
    {
      id: 'bse-quote',
      exchange: 'BSE',
      group: 'Equity',
      title: 'Stock quote',
      method: 'quote',
      fields: [scripcode],
      invoke: (params) => bse.quote(params.scripcode as string),
    },
    {
      id: 'bse-search',
      exchange: 'BSE',
      group: 'Market',
      title: 'Symbol lookup',
      method: 'lookupSymbol',
      fields: [query],
      invoke: (params) => bse.lookupSymbol(params.query as string),
    },
    {
      id: 'bse-gainers',
      exchange: 'BSE',
      group: 'Market',
      title: 'Top gainers',
      method: 'gainers',
      fields: movers,
      invoke: (params) => bse.gainers(params),
    },
    {
      id: 'bse-losers',
      exchange: 'BSE',
      group: 'Market',
      title: 'Top losers',
      method: 'losers',
      fields: movers,
      invoke: (params) => bse.losers(params),
    },
    {
      id: 'bse-breadth',
      exchange: 'BSE',
      group: 'Market',
      title: 'Advance / decline',
      method: 'advanceDecline',
      fields: [],
      invoke: () => bse.advanceDecline(),
    },
    {
      id: 'bse-high-low',
      exchange: 'BSE',
      group: 'Market',
      title: '52-week highs / lows',
      method: 'near52WeekHighLow',
      fields: movers,
      invoke: (params) => bse.near52WeekHighLow(params),
    },
    {
      id: 'bse-actions',
      exchange: 'BSE',
      group: 'Corporate',
      title: 'Corporate actions',
      method: 'actions',
      fields: bseDates,
      invoke: (params) => bse.actions(params),
    },
    {
      id: 'bse-announcements',
      exchange: 'BSE',
      group: 'Corporate',
      title: 'Announcements',
      method: 'announcements',
      fields: [...bseDates, { name: 'pageNo', type: 'number', example: '1' }],
      invoke: (params) => bse.announcements(params),
    },
    {
      id: 'bse-results',
      exchange: 'BSE',
      group: 'Corporate',
      title: 'Results calendar',
      method: 'resultCalendar',
      fields: bseDates,
      invoke: (params) => bse.resultCalendar(params),
    },
  ];
}

export function validateParams(
  endpoint: Endpoint,
  input: unknown
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InputError('Parameters must be a JSON object.');
  }
  const values = input as Record<string, unknown>;
  for (const name of Object.keys(values)) {
    if (!endpoint.fields.some((field) => field.name === name))
      throw new InputError(`Unknown parameter: ${name}`);
  }
  const params: Record<string, unknown> = {};
  for (const field of endpoint.fields) {
    const value = values[field.name];
    if (value === undefined || value === '') {
      if (field.required) throw new InputError(`${field.name} is required.`);
      continue;
    }
    if (typeof value !== 'string' && typeof value !== 'number')
      throw new InputError(`Invalid ${field.name}.`);
    const text = String(value).trim();
    if (!text || text.length > 200)
      throw new InputError(`Invalid ${field.name}.`);
    if (field.choices && !field.choices.includes(text))
      throw new InputError(`Invalid ${field.name}.`);
    if (field.type === 'date') {
      const date = new Date(`${text}T00:00:00`);
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(text) ||
        Number.isNaN(date.getTime()) ||
        date.getFullYear() !== Number(text.slice(0, 4)) ||
        date.getMonth() + 1 !== Number(text.slice(5, 7)) ||
        date.getDate() !== Number(text.slice(8, 10))
      ) {
        throw new InputError(`${field.name} must be a valid YYYY-MM-DD date.`);
      }
      params[field.name] = date;
    } else if (field.type === 'number') {
      const number = Number(text);
      if (!Number.isSafeInteger(number) ||
          number < (field.min ?? 1) ||
          (field.max !== undefined && number > field.max))
        throw new InputError(
          `${field.name} must be an integer from ${field.min ?? 1} to ${field.max ?? 'the maximum supported value'}.`
        );
      params[field.name] = number;
    } else {
      params[field.name] = text;
    }
  }
  for (const [from, to] of [
    ['from_date', 'to_date'],
    ['fromDate', 'toDate'],
  ]) {
    if (
      params[from] &&
      params[to] &&
      (params[from] as Date) > (params[to] as Date)
    )
      throw new InputError(`${from} must not be after ${to}.`);
  }
  if (
    endpoint.exchange === 'BSE' &&
    Boolean(params.fromDate) !== Boolean(params.toDate)
  )
    throw new InputError('Provide both fromDate and toDate.');
  return params;
}

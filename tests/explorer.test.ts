import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NSE, BSE } from '../src/index.js';
import { createEndpoints, validateParams } from '../scripts/explorer/api.js';
import { createExplorerServer } from '../scripts/explorer/server.js';
import {
  ForecastApi,
  ForecastInputError,
} from '../src/nse/api/forecast-api.js';

const quote = vi.fn().mockResolvedValue({ price: 123 });
const forecastStock = vi.fn().mockResolvedValue({
  symbol: 'TCS',
  summary: { estimatedDirection: 'up', signal: 'uncertain' },
});
const history = vi.fn().mockResolvedValue([]);
const endpoints = createEndpoints({
  nse: {
    equityQuote: quote,
    forecastStock,
    historical: { fetchEquityHistoricalData: history },
  } as unknown as NSE,
  bse: {} as BSE,
});
let server: Server | undefined;

afterEach(async () => {
  vi.clearAllMocks();
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = undefined;
  }
});

async function start() {
  server = createExplorerServer(endpoints);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('API explorer', () => {
  it('forwards custom dates as calendar strings and returns 400 for invalid ranges', async () => {
    const base = await start();
    const request = (body: unknown) =>
      fetch(`${base}/api/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const input = {
      symbol: 'TCS',
      horizon: 'custom',
      start_date: '2026-10-05',
      end_date: '2026-10-11',
    };
    expect((await request(input)).status).toBe(200);
    expect(forecastStock).toHaveBeenCalledWith(input);
    const api = new ForecastApi({ fetchEquityHistoricalData: history });
    for (const dates of [
      { start_date: '2026-10-05', end_date: '2026-10-12' },
      { start_date: '2026-10-05' },
      { start_date: '2026-10-10', end_date: '2026-10-11' },
    ]) {
      forecastStock.mockImplementationOnce((params) =>
        api.forecastStock(params)
      );
      expect(
        (await request({ symbol: 'TCS', horizon: 'custom', ...dates })).status
      ).toBe(400);
    }
    expect(history).not.toHaveBeenCalled();
  });

  it('exposes the forecast route and validates forecast parameters', async () => {
    const base = await start();
    const request = (body: unknown) =>
      fetch(`${base}/api/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const response = await request({ symbol: 'TCS', horizon: 'week' });
    expect(response.status).toBe(200);
    expect((await response.json()).data.summary.signal).toBe('uncertain');
    expect(forecastStock).toHaveBeenCalledWith({
      symbol: 'TCS',
      horizon: 'week',
    });
    expect((await request({ symbol: 'TCS', horizon: 'month' })).status).toBe(
      400
    );
    expect((await request({})).status).toBe(400);
    forecastStock.mockRejectedValueOnce(
      new ForecastInputError('Invalid stock symbol')
    );
    expect((await request({ symbol: 'invalid!' })).status).toBe(400);
  });

  it('forwards context controls but never accepts API keys from request bodies', async () => {
    const base = await start();
    const request = (body: unknown) =>
      fetch(`${base}/api/forecast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    const input = {
      symbol: 'TCS',
      horizon: 'week',
      context: 'auto',
      model: 'technical',
      sentiment: 'finbert',
    };
    expect((await request(input)).status).toBe(200);
    expect(forecastStock).toHaveBeenCalledWith(input);
    expect((await request({ symbol: 'TCS', context: 'unknown' })).status).toBe(
      400
    );
    expect(
      (await request({ symbol: 'TCS', provider_key: 'not-allowed' })).status
    ).toBe(400);
  });

  it('validates required, unknown and malformed parameters', () => {
    const endpoint = endpoints.find((item) => item.id === 'nse-quote')!;
    for (const input of [
      {},
      { symbol: ' ' },
      { symbol: null },
      { symbol: 'TCS', url: 'https://example.com' },
      [],
    ]) {
      expect(() => validateParams(endpoint, input)).toThrow();
    }
    expect(validateParams(endpoint, { symbol: ' TCS ' })).toEqual({
      symbol: 'TCS',
    });
  });

  it('converts dates and rejects impossible or reversed dates', () => {
    const endpoint = endpoints.find((item) => item.id === 'nse-history')!;
    const params = validateParams(endpoint, {
      symbol: 'TCS',
      from_date: '2026-01-01',
    });
    expect(params.from_date).toBeInstanceOf(Date);
    for (const from_date of ['2026-02-30', 'yesterday', '2026-13-01']) {
      expect(() =>
        validateParams(endpoint, { symbol: 'TCS', from_date })
      ).toThrow();
    }
    expect(() =>
      validateParams(endpoint, {
        symbol: 'TCS',
        from_date: '2026-02-01',
        to_date: '2026-01-01',
      })
    ).toThrow();
  });

  it('validates numeric, enum and paired BSE date parameters', () => {
    const endpoint = endpoints.find((item) => item.id === 'bse-announcements')!;
    expect(validateParams(endpoint, { pageNo: '2' })).toEqual({ pageNo: 2 });
    expect(() => validateParams(endpoint, { pageNo: '-1' })).toThrow();
    expect(() =>
      validateParams(endpoint, { fromDate: '2026-01-01' })
    ).toThrow();
    expect(() =>
      validateParams(
        endpoints.find((item) => item.id === 'nse-options-v3')!,
        { symbol: 'NIFTY', type: 'invalid' }
      )
    ).toThrow();
  });

  it('lists metadata and calls the selected library method', async () => {
    const base = await start();
    const catalog = await (await fetch(`${base}/api/endpoints`)).json();
    expect(catalog).toHaveLength(endpoints.length);
    expect(catalog[0]).not.toHaveProperty('invoke');
    const response = await fetch(`${base}/api/run/nse-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: 'RELIANCE' }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).data).toEqual({ price: 123 });
    expect(quote).toHaveBeenCalledWith('RELIANCE');
  });

  it('blocks foreign origins, arbitrary methods and bad JSON', async () => {
    const base = await start();
    expect(
      (
        await fetch(`${base}/api/endpoints`, {
          headers: { Origin: 'https://example.com' },
        })
      ).status
    ).toBe(403);
    expect(
      (await fetch(`${base}/api/run/exit`, { method: 'POST' })).status
    ).toBe(404);
    const response = await fetch(`${base}/api/run/nse-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });
    expect(response.status).toBe(400);
    expect(quote).not.toHaveBeenCalled();
  });

  it('reports exchange errors without crashing the server', async () => {
    quote.mockRejectedValueOnce(new Error('Exchange unavailable'));
    const base = await start();
    const response = await fetch(`${base}/api/run/nse-quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"symbol":"TCS"}',
    });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toBe('Exchange unavailable');
  });

  it('serves the page and browser assets with correct content types', async () => {
    const base = await start();
    for (const [path, type] of [
      ['/', 'text/html'],
      ['/app.js', 'text/javascript'],
      ['/styles.css', 'text/css'],
      ['/icons.js', 'text/javascript'],
    ]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(type);
      expect(response.headers.get('content-security-policy')).toContain(
        "default-src 'self'"
      );
      expect((await response.text()).length).toBeGreaterThan(100);
    }
    expect((await fetch(`${base}/server.ts`)).status).toBe(404);
  });

  it('serializes exchange calls and releases the lock after completion', async () => {
    let finish!: (data: unknown) => void;
    quote.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const base = await start();
    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"symbol":"TCS"}',
    };
    const first = fetch(`${base}/api/run/nse-quote`, options);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect((await fetch(`${base}/api/run/nse-quote`, options)).status).toBe(
      429
    );
    finish({ price: 123 });
    expect((await first).status).toBe(200);
    expect((await fetch(`${base}/api/run/nse-quote`, options)).status).toBe(
      200
    );
  });
});

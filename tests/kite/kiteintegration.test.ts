import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createHash } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { loadKiteConfig, type KiteConfig } from '../../src/kite/index.js';
import { createKiteServer, type AccountReader } from '../../apps/kite/server.js';
import { readKiteAccount, kiteReadPaths } from '../../src/kite/client.js';
import { KiteLoginFlow, exchangeKiteToken, type TokenExchanger } from '../../src/kite/auth.js';

vi.mock('axios', () => ({ default: { get: vi.fn(), post: vi.fn(), isAxiosError: vi.fn() } }));

const user = {
  username: 'alice',
  apiToken: 'a'.repeat(43),
  kiteApiKey: 'mock_key',
  kiteAccessToken: 'mock_access',
};
const environment = () => ({ KITE_USERS_JSON: JSON.stringify([user]) });

describe('Kite read-only configuration', () => {
  it('defaults to local binding and the official API', () => {
    const config = loadKiteConfig(environment());
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3102);
    expect(config.apiBaseUrl).toBe('https://api.kite.trade');
  });

  it('fails closed for missing or malformed credentials without exposing them', () => {
    expect(() => loadKiteConfig({})).toThrow('at least one user');
    expect(() => loadKiteConfig({ KITE_USERS_JSON: 'secret-invalid-json' }))
      .toThrow('values are not logged');
    expect(() => loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([{ ...user, apiToken: 'short' }]) }))
      .toThrow('API tokens');
  });

  it('rejects duplicate identities and untrusted credential destinations', () => {
    expect(() => loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([user, user]) }))
      .toThrow('unique');
    expect(() => loadKiteConfig({ ...environment(), KITE_API_BASE_URL: 'https://example.com' }))
      .toThrow('official HTTPS');
  });

  it('requires a secure public origin for remote binding', () => {
    expect(() => loadKiteConfig({ ...environment(), KITE_HOST: '0.0.0.0' }))
      .toThrow('HTTPS proxy');
    expect(() => loadKiteConfig({ ...environment(), KITE_PUBLIC_ORIGIN: 'http://example.com' }))
      .toThrow('HTTPS origin');
    expect(loadKiteConfig({ ...environment(), KITE_HOST: '0.0.0.0', KITE_PUBLIC_ORIGIN: 'https://example.com' }).host)
      .toBe('0.0.0.0');
  });
});

describe('Kite read-only HTTP service', () => {
  const servers: Server[] = [];
  const secondUser = { ...user, username: 'bob', apiToken: 'b'.repeat(43), kiteAccessToken: 'bob_access' };
  const config = () => loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([user, secondUser]) });
  async function start(reader: AccountReader, hosted = false, exchanger?: TokenExchanger, modify?: (settings: KiteConfig) => void) {
    const settings = config();
    if (hosted) {
      settings.publicOrigin = 'https://kite.example.com';
      settings.redirectUrl = 'https://kite.example.com/auth/kite/callback';
    }
    modify?.(settings);
    const server = createKiteServer(settings, reader, exchanger);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return base;
  }
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
      server.closeAllConnections();
      server.close((error) => error ? reject(error) : resolve());
    })));
  });

  it('keeps health credential-free and requires authentication for account details', async () => {
    const reader = vi.fn();
    const base = await start(reader);
    expect(await (await fetch(`${base}/health`)).json()).toEqual({ status: 'ok', mode: 'HOLD', tradingEnabled: false });
    expect((await fetch(`${base}/api/kite/profile`)).status).toBe(401);
    expect((await fetch(`${base}/api/kite/profile`, { headers: { Authorization: `Bearer ${'x'.repeat(43)}` } })).status).toBe(401);
    expect(reader).not.toHaveBeenCalled();
  });

  it('isolates callers and verifies connectivity by reading the authenticated profile', async () => {
    const reader = vi.fn(async (_config, account, resource) => ({ owner: account.username, resource }));
    const base = await start(reader);
    const results = await Promise.all([user, secondUser].map(async (account) =>
      (await fetch(`${base}/api/kite/connection`, { headers: { Authorization: `Bearer ${account.apiToken}` } })).json()));
    expect(results.map((result) => result.data.owner)).toEqual(['alice', 'bob']);
    expect(results.every((result) => result.tradingEnabled === false)).toBe(true);
    expect(reader.mock.calls[0][2]).toBe('profile');
  });

  it('serves Swagger locally without exposing credentials or write operations', async () => {
    const reader = vi.fn();
    const base = await start(reader);
    const page = await fetch(`${base}/docs`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(await page.text()).toContain('/docs/swagger-ui-bundle.js');
    const document = await (await fetch(`${base}/openapi.json`)).json();
    expect(document.openapi).toBe('3.0.3');
    expect(document.security).toEqual([{ serviceBearer: [] }]);
    expect(Object.keys(document.paths)).toContain('/api/kite/connection');
    expect(Object.values(document.paths).every((path) => Object.keys(path as object).join() === 'get')).toBe(true);
    const serialized = JSON.stringify(document);
    for (const secret of [user.apiToken, user.kiteApiKey, user.kiteAccessToken, secondUser.apiToken])
      expect(serialized).not.toContain(secret);
    const init = await (await fetch(`${base}/docs/init.js`)).text();
    expect(init).toContain('persistAuthorization: false');
    expect(init).toContain("supportedSubmitMethods: ['get']");
    expect((await fetch(`${base}/docs/swagger-ui.css`)).status).toBe(200);
    expect((await fetch(`${base}/docs/swagger-ui-bundle.js`)).status).toBe(200);
    expect((await fetch(`${base}/api/kite/connection`)).status).toBe(401);
    expect(reader).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejects %s orders without contacting Kite', async (method) => {
    const reader = vi.fn();
    const base = await start(reader);
    const response = await fetch(`${base}/api/kite/orders`, { method, headers: { Authorization: `Bearer ${user.apiToken}` } });
    expect(response.status).toBe(405);
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects identity overrides and unknown paths', async () => {
    const reader = vi.fn();
    const base = await start(reader);
    const headers = { Authorization: `Bearer ${user.apiToken}` };
    expect((await fetch(`${base}/api/kite/profile?username=bob`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/api/kite/session/token`, { headers })).status).toBe(404);
    expect(reader).not.toHaveBeenCalled();
  });

  it('rate limits each account independently and redacts unexpected failures', async () => {
    const reader = vi.fn(async () => { throw new Error(user.kiteAccessToken); });
    const base = await start(reader);
    const headers = { Authorization: `Bearer ${user.apiToken}` };
    const response = await fetch(`${base}/api/kite/profile`, { headers });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(user.kiteAccessToken);
    expect((await fetch(`${base}/api/kite/holdings`, { headers })).status).toBe(429);
    expect((await fetch(`${base}/api/kite/profile`, { headers: { Authorization: `Bearer ${secondUser.apiToken}` } })).status).toBe(502);
  });

  it('enforces the public host and browser origin', async () => {
    const reader = vi.fn();
    const base = await start(reader, true);
    const headers = { Authorization: `Bearer ${user.apiToken}`, Host: 'kite.example.com' };
    const hostedRequest = (extraHeaders: Record<string, string> = {}) => new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/kite/status`, { headers: { ...headers, ...extraHeaders } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      request.end();
    });
    expect((await fetch(`${base}/api/kite/status`)).status).toBe(403);
    expect(await hostedRequest({ Origin: 'https://evil.example.com' })).toBe(403);
    expect(await hostedRequest()).toBe(200);
    expect(reader).not.toHaveBeenCalled();
  });

  it('requires service authorization and configured app secrets to start login', async () => {
    const base = await start(vi.fn());
    expect((await fetch(`${base}/api/kite/login`)).status).toBe(401);
    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(`${base}/api/kite/login`, { headers: {
        Host: '127.0.0.1:3102', Authorization: `Bearer ${user.apiToken}`,
      } }, (response) => {
        response.resume();
        response.on('end', () => resolve(response.statusCode ?? 0));
      });
      request.on('error', reject);
      request.end();
    });
    expect(status).toBe(409);
  });

  it('uses host-only Secure cookies for hosted login and throttles login requests', async () => {
    const base = await start(vi.fn(), true, undefined, (settings) => {
      settings.users[0].kiteApiSecret = 'mock_secret';
      settings.users[0].kiteUserId = 'AB1234';
    });
    const login = () => new Promise<{ status: number; cookie?: string }>((resolve, reject) => {
      const request = httpRequest(`${base}/api/kite/login`, { headers: {
        Host: 'kite.example.com', Authorization: `Bearer ${user.apiToken}`,
      } }, (response) => {
        response.resume();
        response.on('end', () => resolve({ status: response.statusCode ?? 0, cookie: response.headers['set-cookie']?.[0] }));
      });
      request.on('error', reject);
      request.end();
    });
    const response = await login();
    expect(response.status).toBe(200);
    expect(response.cookie).toMatch(/^__Host-kite-login=/);
    expect(response.cookie).toContain('; Secure');
    expect(response.cookie).not.toContain('Domain=');
    expect((await login()).status).toBe(429);
  });

  it('rejects direct callbacks without a user-bound login', async () => {
    const exchange = vi.fn();
    const base = await start(vi.fn(), false, exchange);
    const response = await fetch(`${base}/auth/kite/callback?status=success&request_token=request`);
    expect(response.status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
  });

  it.each(['/auth/kite/callback', '/'])('completes a browser-bound callback at %s and keeps session secrets private', async (callbackPath) => {
    const reader = vi.fn(async (_settings, account) => ({ tokenWasUpdated: account.kiteAccessToken === 'new_access' }));
    const exchange = vi.fn(async () => ({ accessToken: 'new_access', userId: 'AB1234' }));
    const settings = loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([{ ...user, kiteApiSecret: 'mock_secret', kiteUserId: 'AB1234' }]) });
    settings.redirectUrl = `http://127.0.0.1:3102${callbackPath}`;
    const server = createKiteServer(settings, reader, exchange);
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const send = (path: string, headers: Record<string, string> = {}) => new Promise<{ status: number; headers: import('node:http').IncomingHttpHeaders; body: string }>((resolve, reject) => {
      const request = httpRequest(`${base}${path}`, { headers: { Host: '127.0.0.1:3102', ...headers } }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk.toString(); });
        response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
      });
      request.on('error', reject);
      request.end();
    });
    const headers = { Authorization: `Bearer ${user.apiToken}` };
    const login = await send('/api/kite/login', headers);
    expect(login.status).toBe(200);
    const cookie = login.headers['set-cookie']![0];
    expect(cookie).toContain('HttpOnly; SameSite=Lax; Max-Age=300');
    const data = JSON.parse(login.body);
    expect(login.body).not.toContain('mock_secret');
    const state = new URLSearchParams(new URL(data.loginUrl).searchParams.get('redirect_params')!).get('state');
    const callback = `${callbackPath}?status=success&request_token=request&state=${state}`;
    expect((await send(callback)).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect((await send(`${callback}&state=duplicate`, { Cookie: cookie.split(';')[0] })).status).toBe(400);
    const success = await send(callback, { Cookie: cookie.split(';')[0] });
    expect(success.status).toBe(303);
    expect(success.headers.location).toBe('/docs');
    expect(success.headers['referrer-policy']).toBe('no-referrer');
    expect(success.headers['set-cookie']![0]).toContain('Max-Age=0');
    expect(success.body).not.toContain('new_access');
    expect((await send(callback, { Cookie: cookie.split(';')[0] })).status).toBe(400);
    const account = await send('/api/kite/connection', headers);
    expect(account.status).toBe(200);
    expect(JSON.parse(account.body).data.tokenWasUpdated).toBe(true);
    expect(exchange).toHaveBeenCalledTimes(1);
  });
});

describe('Kite REST reads', () => {
  beforeEach(() => vi.resetAllMocks());

  it.each(Object.entries(kiteReadPaths))('uses only GET for %s', async (resource, path) => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'success', data: { ok: true } } });
    const config = loadKiteConfig(environment());
    await readKiteAccount(config, user, resource as keyof typeof kiteReadPaths);
    expect(axios.get).toHaveBeenCalledWith(`https://api.kite.trade${path}`, expect.objectContaining({
      headers: { 'X-Kite-Version': '3', Authorization: `token ${user.kiteApiKey}:${user.kiteAccessToken}` },
      maxRedirects: 0,
      proxy: false,
      timeout: 10000,
    }));
  });

  it('removes credential fields while preserving instrument tokens', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'success', data: {
      user_id: 'AB1234', access_token: 'secret', nested: [{ api_key: 'secret', instrument_token: 123 }],
    } } });
    expect(await readKiteAccount(loadKiteConfig(environment()), user, 'profile'))
      .toEqual({ user_id: 'AB1234', nested: [{ instrument_token: 123 }] });
  });

  it.each([401, 403, 429, 500])('sanitizes broker errors with status %s', async (status) => {
    vi.mocked(axios.get).mockRejectedValue({ response: { status, data: { message: user.kiteAccessToken } } });
    vi.mocked(axios.isAxiosError).mockReturnValue(true);
    try {
      await readKiteAccount(loadKiteConfig(environment()), user, 'profile');
      expect.fail('Expected a broker error');
    } catch (error) {
      expect(String(error)).not.toContain(user.kiteAccessToken);
      expect(error).toMatchObject({ statusCode: status === 429 ? 429 : status === 500 ? 502 : 424 });
    }
  });

  it('rejects malformed upstream success envelopes', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: { status: 'error', message: 'secret' } });
    await expect(readKiteAccount(loadKiteConfig(environment()), user, 'profile')).rejects.toThrow('invalid account response');
  });

  it('does not call Kite when no access token has been obtained', async () => {
    await expect(readKiteAccount(loadKiteConfig(environment()), { ...user, kiteAccessToken: '' }, 'profile'))
      .rejects.toThrow('not connected');
    expect(axios.get).not.toHaveBeenCalled();
  });
});

describe('Kite login flow', () => {
  const loginUser = { ...user, kiteAccessToken: '', kiteApiSecret: 'mock_secret', kiteUserId: 'AB1234' };
  const settings = () => loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([loginUser, { ...user, username: 'bob', apiToken: 'b'.repeat(43) }]) });
  function stateFrom(loginUrl: string) {
    return new URLSearchParams(new URL(loginUrl).searchParams.get('redirect_params')!).get('state')!;
  }
  beforeEach(() => vi.resetAllMocks());

  it('allows login without an existing token but requires the expected account ID', () => {
    expect(settings().users[0].kiteAccessToken).toBe('');
    expect(() => loadKiteConfig({ KITE_USERS_JSON: JSON.stringify([{ ...loginUser, kiteUserId: '' }]) }))
      .toThrow('verify account ownership');
    expect(() => loadKiteConfig({ ...environment(), KITE_REDIRECT_URL: 'https://evil.example/callback' }))
      .toThrow('service origin');
  });

  it('binds a single-use login to browser and user, keeps tokens on the backend', async () => {
    const config = settings();
    const exchange = vi.fn(async () => ({ accessToken: 'new_access', userId: 'AB1234' }));
    const flow = new KiteLoginFlow(config, exchange);
    const login = flow.begin(config.users[0]);
    expect(new URL(login.loginUrl).origin).toBe('https://kite.zerodha.com');
    const state = stateFrom(login.loginUrl);
    await expect(flow.complete(state, 'x'.repeat(43), 'request_token')).rejects.toThrow('browser verification');
    expect(exchange).not.toHaveBeenCalled();
    expect(await flow.complete(state, login.browserToken, 'request_token')).toBeUndefined();
    expect(config.users[0].kiteAccessToken).toBe('new_access');
    expect(config.users[1].kiteAccessToken).toBe(user.kiteAccessToken);
    await expect(flow.complete(state, login.browserToken, 'request_token')).rejects.toThrow('already used');
    expect(exchange).toHaveBeenCalledTimes(1);
  });

  it('rejects expired and superseded login attempts', async () => {
    const config = settings();
    let clock = 0;
    const exchange = vi.fn();
    const flow = new KiteLoginFlow(config, exchange, () => clock);
    const old = flow.begin(config.users[0]);
    const fresh = flow.begin(config.users[0]);
    await expect(flow.complete(stateFrom(old.loginUrl), old.browserToken, 'request')).rejects.toThrow('already used');
    clock = 300000;
    await expect(flow.complete(stateFrom(fresh.loginUrl), fresh.browserToken, 'request')).rejects.toThrow('expired');
    expect(exchange).not.toHaveBeenCalled();
  });

  it('does not install tokens for a different Kite account', async () => {
    const config = settings();
    const flow = new KiteLoginFlow(config, async () => ({ accessToken: 'wrong_access', userId: 'WRONG' }));
    const login = flow.begin(config.users[0]);
    await expect(flow.complete(stateFrom(login.loginUrl), login.browserToken, 'request')).rejects.toThrow('account verification');
    expect(config.users[0].kiteAccessToken).toBe('');
  });

  it('exchanges the official checksum without sending the raw API secret', async () => {
    vi.mocked(axios.post).mockResolvedValue({ data: { status: 'success', data: {
      api_key: loginUser.kiteApiKey, user_id: loginUser.kiteUserId, access_token: 'new_access',
    } } });
    expect(await exchangeKiteToken(settings(), loginUser, 'request')).toEqual({ accessToken: 'new_access', userId: 'AB1234' });
    const [url, body, options] = vi.mocked(axios.post).mock.calls[0];
    expect(url).toBe('https://api.kite.trade/session/token');
    expect(new URLSearchParams(body as string).get('checksum'))
      .toBe(createHash('sha256').update(loginUser.kiteApiKey + 'request' + loginUser.kiteApiSecret).digest('hex'));
    expect(body).not.toContain(loginUser.kiteApiSecret);
    expect(options).toMatchObject({ maxRedirects: 0, proxy: false, timeout: 10000 });
  });

  it('redacts token-exchange failures and rejects unexpected app responses', async () => {
    vi.mocked(axios.post).mockRejectedValue(new Error(loginUser.kiteApiSecret));
    await expect(exchangeKiteToken(settings(), loginUser, 'request')).rejects.toThrow('Kite token exchange failed');
    vi.mocked(axios.post).mockResolvedValue({ data: { status: 'success', data: {
      api_key: 'other_app', user_id: 'AB1234', access_token: 'new_access',
    } } });
    await expect(exchangeKiteToken(settings(), loginUser, 'request')).rejects.toThrow('expected account and app');
  });
});
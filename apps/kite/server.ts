import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnvironment } from 'dotenv';
import { loadKiteConfig, type KiteConfig, type KiteUser } from '../../src/kite/config.js';
import { KiteReadError, kiteReadPaths, readKiteAccount, type KiteResource } from '../../src/kite/client.js';
import { kiteOpenApi, swaggerHtml, swaggerInit } from './docs.js';
import { KiteLoginFlow, type TokenExchanger } from '../../src/kite/auth.js';

const swaggerDirectory = dirname(createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'));

export type AccountReader = (
  config: KiteConfig, user: KiteUser, resource: KiteResource
) => Promise<unknown>;

export function createKiteServer(config: KiteConfig, reader: AccountReader = readKiteAccount, exchanger?: TokenExchanger) {
  const identities = config.users.map((user) => ({
    user: { ...user },
    digest: createHash('sha256').update(user.apiToken).digest(),
  }));
  const publicUrl = config.publicOrigin ? new URL(config.publicOrigin) : undefined;
  const redirectUrl = new URL(config.redirectUrl);
  const loginFlow = new KiteLoginFlow(config, exchanger);
  const cookieName = redirectUrl.protocol === 'https:' ? '__Host-kite-login' : 'kite-login';
  const loginCookie = (value: string, maxAge: number) =>
    `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${redirectUrl.protocol === 'https:' ? '; Secure' : ''}`;
  const nextLogin = new Map<string, number>();
  const nextRead = new Map<string, number>();
  const busy = new Set<string>();
  const server = createServer(async (request, response) => {
    const json = (status: number, data: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        'Referrer-Policy': 'no-referrer',
      });
      response.end(JSON.stringify(data));
    };
    let url: URL;
    try {
      url = new URL(request.url ?? '/', 'http://localhost');
    } catch {
      json(400, { error: 'Invalid request URL.' });
      return;
    }
    if (request.method === 'GET' && url.pathname === '/health' && !url.search) {
      json(200, { status: 'ok', mode: 'HOLD', tradingEnabled: false });
      return;
    }
    const host = request.headers.host;
    const origin = request.headers.origin;
    if (!host || (publicUrl
      ? host !== publicUrl.host || (origin && origin !== publicUrl.origin)
      : !/^(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(host) ||
        (origin && origin !== `http://${host}`))) {
      json(403, { error: 'Host or origin is not allowed.' });
      return;
    }
    if (request.method === 'GET' && (
      url.pathname === '/auth/kite/callback' ||
      (url.pathname === '/' && url.search)
    )) {
      if (host !== redirectUrl.host || url.pathname !== redirectUrl.pathname) {
        json(400, { error: 'The callback URL does not match KITE_REDIRECT_URL. Update the Kite app redirect URL and start a new login.' });
        return;
      }
      const state = url.searchParams.getAll('state');
      const requestTokens = url.searchParams.getAll('request_token');
      const statuses = url.searchParams.getAll('status');
      if (state.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(state[0]) ||
          requestTokens.length !== 1 || statuses.length !== 1 || statuses[0] !== 'success') {
        json(400, { error: 'Invalid Kite callback. Start a fresh login using /api/kite/login in Swagger.' });
        return;
      }
      const cookies = (request.headers.cookie ?? '').split(';').map((part) => part.trim());
      const browserCookies = cookies.filter((part) => part.startsWith(`${cookieName}=`));
      const browserToken = browserCookies.length === 1 ? browserCookies[0].slice(cookieName.length + 1) : '';
      try {
        await loginFlow.complete(state[0], browserToken, requestTokens[0]);
        response.writeHead(303, {
          Location: '/docs',
          'Set-Cookie': loginCookie('', 0),
          'Cache-Control': 'no-store',
          'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        });
        response.end();
      } catch (error) {
        json(error instanceof KiteReadError ? error.statusCode : 502, {
          error: error instanceof KiteReadError ? error.message : 'Kite login could not be completed. Start a new login.',
        });
      }
      return;
    }
    if (request.method === 'GET' && !url.search) {
      if (url.pathname === '/openapi.json') {
        json(200, kiteOpenApi);
        return;
      }
      const docsAssets: Record<string, [string, string]> = {
        '/docs/swagger-ui.css': ['swagger-ui.css', 'text/css; charset=utf-8'],
        '/docs/swagger-ui-bundle.js': ['swagger-ui-bundle.js', 'text/javascript; charset=utf-8'],
      };
      const docsPage = ['/', '/docs', '/docs/'].includes(url.pathname);
      if (docsPage || url.pathname === '/docs/init.js' || Object.hasOwn(docsAssets, url.pathname)) {
        try {
          const asset = docsAssets[url.pathname];
          const content = docsPage ? swaggerHtml : url.pathname === '/docs/init.js'
            ? swaggerInit : await readFile(join(swaggerDirectory, asset[0]));
          response.writeHead(200, {
            'Content-Type': docsPage ? 'text/html; charset=utf-8'
              : url.pathname === '/docs/init.js' ? 'text/javascript; charset=utf-8' : asset[1],
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
            'Referrer-Policy': 'no-referrer',
            'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
          });
          response.end(content);
        } catch {
          json(500, { error: 'Could not load API documentation.' });
        }
        return;
      }
    }
    const authorization = request.headers.authorization;
    const token = /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(authorization ?? '')?.[1];
    const digest = createHash('sha256').update(token ?? '').digest();
    const identity = identities.find((item) => timingSafeEqual(item.digest, digest));
    if (!token || !identity) {
      json(401, { error: 'Valid API bearer authentication is required.' });
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      json(405, { error: 'HOLD mode: only read requests are permitted.' });
      return;
    }
    if (url.search) {
      json(400, { error: 'Query parameters are not supported; identity comes from authentication.' });
      return;
    }
    if (url.pathname === '/api/kite/status') {
      json(200, {
        username: identity.user.username,
        mode: 'HOLD',
        tradingEnabled: false,
        accessTokenConfigured: Boolean(identity.user.kiteAccessToken),
        loginEnabled: Boolean(identity.user.kiteApiSecret && identity.user.kiteUserId),
        forecastIntegration: 'planned; no forecast can trigger an order',
      });
      return;
    }
    if (url.pathname === '/api/kite/login') {
      if (host !== redirectUrl.host) {
        json(400, { error: 'Open Swagger on the KITE_REDIRECT_URL host before starting login.' });
        return;
      }
      const username = identity.user.username;
      if (Date.now() < (nextLogin.get(username) ?? 0)) {
        json(429, { error: 'Login requests are rate limited. Try again later.' });
        return;
      }
      nextLogin.set(username, Date.now() + config.minReadIntervalMs);
      try {
        const login = loginFlow.begin(identity.user);
        response.setHeader('Set-Cookie', loginCookie(login.browserToken, loginFlow.lifetimeSeconds));
        json(200, { loginUrl: login.loginUrl, redirectUrl: config.redirectUrl, expiresInSeconds: loginFlow.lifetimeSeconds });
      } catch (error) {
        json(error instanceof KiteReadError ? error.statusCode : 502, {
          error: error instanceof KiteReadError ? error.message : 'Could not start Kite login.',
        });
      }
      return;
    }
    const resource = url.pathname === '/api/kite/connection'
      ? 'profile'
      : url.pathname.startsWith('/api/kite/') ? url.pathname.slice('/api/kite/'.length) : '';
    if (!Object.hasOwn(kiteReadPaths, resource)) {
      json(404, { error: 'Read-only endpoint not found.' });
      return;
    }
    const username = identity.user.username;
    if (busy.has(username) || Date.now() < (nextRead.get(username) ?? 0)) {
      response.setHeader('Retry-After', String(Math.ceil(config.minReadIntervalMs / 1000)));
      json(429, { error: 'Account reads are rate limited. Try again later.' });
      return;
    }
    busy.add(username);
    nextRead.set(username, Date.now() + config.minReadIntervalMs);
    try {
      const data = await reader(config, identity.user, resource as KiteResource);
      json(200, { data, mode: 'HOLD', tradingEnabled: false });
    } catch (error) {
      json(error instanceof KiteReadError ? error.statusCode : 502, {
        error: error instanceof KiteReadError ? error.message : 'Account read failed.',
      });
    } finally {
      busy.delete(username);
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvironment({ path: process.env.KITE_ENV_FILE ?? '.env.kite', quiet: true });
  const config = loadKiteConfig();
  const server = createKiteServer(config);
  server.on('error', () => {
    console.error('Kite service could not listen. Check host and port configuration.');
    process.exitCode = 1;
  });
  server.listen(config.port, config.host, () => {
    console.log(`Kite read-only service listening on port ${config.port}. HOLD; trading disabled.`);
    console.log(`Swagger UI: ${config.publicOrigin ?? `http://${config.host === '::1' ? '[::1]' : config.host}:${config.port}`}/docs`);
  });
}
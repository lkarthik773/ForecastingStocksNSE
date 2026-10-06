import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { NSE, BSE } from '../../src/index.js';
import { ForecastInputError } from '../../src/forecast/forecast-api.js';
import {
  createEndpoints,
  InputError,
  validateParams,
  type Endpoint,
} from './api.js';

export function createExplorerServer(
  endpoints: Endpoint[],
  options: { publicOrigin?: string } = {}
) {
  const publicUrl = options.publicOrigin
    ? new URL(options.publicOrigin)
    : undefined;
  if (
    publicUrl &&
    (!['http:', 'https:'].includes(publicUrl.protocol) ||
      publicUrl.origin !== options.publicOrigin)
  ) {
    throw new Error('Public origin must be an HTTP(S) origin without a path.');
  }
  let busy = false;
  return createServer(async (request, response) => {
    const json = (status: number, data: unknown) => {
      response.writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(data));
    };
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      json(200, { status: 'ok' });
      return;
    }
    const host = request.headers.host;
    if (
      !host ||
      (publicUrl
        ? host !== publicUrl.host ||
          (request.headers.origin && request.headers.origin !== publicUrl.origin)
        : !/^(localhost|127\.0\.0\.1):\d+$/.test(host) ||
          (request.headers.origin && request.headers.origin !== `http://${host}`))
    ) {
      json(403, { error: 'Only requests to the configured host and origin are allowed.' });
      return;
    }
    if (request.method === 'GET' && pathname === '/api/endpoints') {
      json(
        200,
        endpoints.map(({ invoke, ...metadata }) => metadata)
      );
      return;
    }
    if (
      request.method === 'POST' &&
      (pathname.startsWith('/api/run/') || pathname === '/api/forecast')
    ) {
      const endpoint = endpoints.find(
        (item) =>
          item.id ===
          (pathname === '/api/forecast'
            ? 'nse-forecast'
            : pathname.slice('/api/run/'.length))
      );
      if (!endpoint) {
        json(404, { error: 'Endpoint not found.' });
        return;
      }
      if (!request.headers['content-type']?.startsWith('application/json')) {
        json(415, { error: 'Use application/json.' });
        return;
      }
      if (busy) {
        json(429, {
          error: 'Another request is running. Try again when it completes.',
        });
        return;
      }
      busy = true;
      const start = performance.now();
      try {
        let body = '';
        for await (const chunk of request) {
          body += chunk.toString();
          if (Buffer.byteLength(body) > 16384)
            throw new InputError('Request body exceeds 16 KB.');
        }
        let input: unknown;
        try {
          input = JSON.parse(body);
        } catch {
          throw new InputError('Invalid JSON body.');
        }
        const data = await endpoint.invoke(validateParams(endpoint, input));
        json(200, {
          data: data ?? null,
          durationMs: Math.round(performance.now() - start),
        });
      } catch (error) {
        json(
          error instanceof InputError || error instanceof ForecastInputError
            ? 400
            : 502,
          {
            error:
              error instanceof Error
                ? error.message
                : 'Exchange request failed.',
            durationMs: Math.round(performance.now() - start),
          }
        );
      } finally {
        busy = false;
      }
      return;
    }
    const assets: Record<string, [string, string]> = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
      '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
      '/icons.js': [
        '../../../node_modules/lucide/dist/umd/lucide.js',
        'text/javascript; charset=utf-8',
      ],
    };
    if (request.method === 'GET' && assets[pathname]) {
      try {
        const [filename, contentType] = assets[pathname];
        const content = await readFile(
          new URL(`./public/${filename}`, import.meta.url)
        );
        response.writeHead(200, {
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Content-Security-Policy':
            "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
        });
        response.end(content);
      } catch {
        json(500, { error: 'Could not load explorer assets.' });
      }
      return;
    }
    json(404, { error: 'Not found.' });
  });
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const port = Number(process.env.PORT ?? 3101);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be between 1 and 65535.');
  const downloadFolder = fileURLToPath(
    new URL('../../node_modules/.cache/api-explorer/', import.meta.url)
  );
  const nse = new NSE(downloadFolder, {
    timeout: 20000,
    forecastContext: {
      finbertCacheDir: fileURLToPath(
        new URL('../../node_modules/.cache/finbert/', import.meta.url)
      ),
    },
    forecastTraining: { newsArchivePath: process.env.FINBERT_NEWS_ARCHIVE },
  });
  const bse = new BSE({ downloadFolder, timeout: 20000 });
  const publicOrigin =
    process.env.EXPLORER_PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL;
  const host = process.env.HOST ?? (publicOrigin ? '0.0.0.0' : '127.0.0.1');
  const server = createExplorerServer(createEndpoints({ nse, bse }), {
    publicOrigin,
  });
  server.on('error', (error) => {
    console.error(
      `Explorer could not start: ${error.message}. Set PORT to use another port.`
    );
    process.exitCode = 1;
  });
  server.listen(port, host, () =>
    console.log(`API explorer: ${publicOrigin ?? `http://${host}:${port}`}`)
  );
  const shutdown = () =>
    server.close(() => {
      nse.exit();
      bse.close();
    });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

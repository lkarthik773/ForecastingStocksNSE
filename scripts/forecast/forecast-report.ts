import { resolve, join } from 'node:path';
import { NSEClient } from '../../src/nse/client/nse-client.js';
import { ForecastApi } from '../../src/forecast/forecast-api.js';
import { ForecastContextApi } from '../../src/forecast/forecast-context-api.js';
import { formatForecastReport } from './report-format.js';

async function main() {
  const symbol = process.argv[2]?.trim();
  if (!symbol) throw new Error('Usage: npm run forecast:report -- SYMBOL');

  const cacheDirectory = resolve(
    process.env.FORECAST_BENCHMARK_DIR ??
      'node_modules/.cache/forecast-report'
  );
  const nse = new NSEClient(join(cacheDirectory, 'nse-downloads'), {
    server: true,
  });
  const context = new ForecastContextApi(nse.historical);
  const api = new ForecastApi(
    nse.historical,
    undefined,
    context,
    {},
    6,
    async (requestedSymbol, from, to) =>
      nse.corporate.getActions({
        symbol: requestedSymbol,
        from_date: new Date(`${from}T12:00:00`),
        to_date: new Date(`${to}T12:00:00`),
      })
  );
  const forecast = await api.forecastStock({
    symbol,
    horizon: 'week',
    model: 'technical',
    context: 'auto',
    sentiment: 'off',
  });
  process.stdout.write(`${formatForecastReport(forecast)}\n`);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Forecast report generation failed.'
  );
  process.exitCode = 1;
});

# NSE-BSE API

A unified TypeScript API for both NSE (National Stock Exchange) and BSE (Bombay Stock Exchange) India. This package combines the functionality of both exchanges while keeping their APIs separate and isolated.

## Features

### NSE API Features
- 📈 **Real-time Stock Quotes** - Get live stock prices and market data
- 📊 **Historical Data** - Fetch historical stock prices and indices
- 🔍 **Symbol Lookup** - Search for stocks and securities
- 📋 **Option Chain Data** - Complete options data with Greeks
- 🏢 **Corporate Actions** - Dividends, splits, bonuses, and more
- 📰 **Corporate Announcements** - Latest company announcements
- 💹 **Market Status** - Live market status and trading hours
- 📁 **Data Downloads** - Bhavcopy and other reports
- 🎯 **IPO Information** - Current, past, and upcoming IPOs

### BSE API Features
- 📈 **Stock Quotes** - Real-time BSE stock prices
- 📊 **Historical Data** - Historical price data and indices
- 🔍 **Symbol Search** - Find BSE listed companies
- 🏆 **Gainers/Losers** - Top performing stocks
- 📋 **Corporate Actions** - Dividend, bonus, rights issues
- 📰 **Announcements** - Corporate announcements and news
- 📁 **Reports** - Bhavcopy and delivery reports
- 🎯 **Result Calendar** - Earnings announcement dates

## Installation

```bash
npm install nse-bse-api
```

## Quick Start

### Using Both APIs

```typescript
import { NSE, BSE } from 'nse-bse-api';

// Initialize clients
const nse = new NSE();
const bse = new BSE();

// Get NSE quote
const nseQuote = await nse.equityQuote('RELIANCE');
console.log('NSE RELIANCE:', nseQuote);

// Get BSE quote  
const bseQuote = await bse.quote('500325'); // RELIANCE BSE code
console.log('BSE RELIANCE:', bseQuote);

// Clean up
await nse.exit();
await bse.close();
```

### Using Individual APIs

```typescript
// Import only NSE
import { NSE } from 'nse-bse-api/nse';

const nse = new NSE();
const quote = await nse.equityQuote('TCS');

// Import only BSE
import { BSE } from 'nse-bse-api/bse';

const bse = new BSE();
const quote = await bse.quote('532540'); // TCS BSE code
```

## API Documentation

### Local API Explorer

Run the interactive explorer from this repository:

```bash
npm install
npm run setup:lightgbm
npm run explorer
```

Open http://127.0.0.1:3100. The page includes 29 read-only NSE and BSE
operations with parameter forms, JavaScript/cURL previews, JSON and table
responses, copy/download controls, and recent requests. It is a development
tool, not a Swagger/OpenAPI service or a hosted production API.

The local Node.js server calls the library on your behalf, handling exchange
cookies and avoiding browser CORS restrictions. Requests run one at a time.
Live results depend on exchange availability, rate limits, and network access;
exchange errors are displayed in the response pane. Dates use `YYYY-MM-DD`.
File downloads and arbitrary URL requests are intentionally not exposed.
Cookie/cache files stay in `node_modules/.cache/api-explorer`.

The server binds only to `127.0.0.1` and rejects foreign origins. Do not expose
it publicly. To use another port in PowerShell:

```powershell
$env:PORT = '3101'
npm run explorer
```

Run its offline routing and validation tests with `npm run test:explorer`.

### Stock Forecast (Experimental, NSE)

The forecast API fetches the previous three calendar years of NSE equity daily
closes, sorts and validates them, and estimates the next trading session
(`next_day`, the default) or the next five trading sessions (`week`). A week
is not seven calendar days or a prediction through a specific weekday.

Choose `custom` to forecast an inclusive start/end date range of at most seven
calendar days. In the explorer, selecting Custom reveals the required
`start_date` and `end_date` date pickers. For example:

```json
{
  "symbol": "TCS",
  "horizon": "custom",
  "start_date": "2026-10-05",
  "end_date": "2026-10-11"
}
```

For a custom range, the three-year history window starts three calendar years
before `start_date` and ends the day before `start_date`. Prices on or after
the start date are excluded, including for historical ranges. The response
includes `forecastRange` and a `date` for each forecast weekday within the
range. Weekends are skipped; exchange holidays are not modeled, so dates and
session offsets are weekday approximations. Weekend-only ranges are rejected.
Future starts still require sufficient available history near the start;
missing future data is never invented. Staleness is measured relative to the
requested training cutoff, not today's date, for historical custom forecasts.
`start_date` and `end_date` are only accepted for the `custom` horizon.

```typescript
import { NSE } from 'nse-bse-api';

const nse = new NSE('./downloads');
try {
  const result = await nse.forecastStock({ symbol: 'TCS', horizon: 'week', model: 'technical' });
  console.log(result.summary);
  console.log(result.forecast);
  console.log(result.backtest);
} finally {
  nse.exit();
}
```

In the explorer, choose **Forecast > Stock forecast**. Its local HTTP API is:

```http
POST http://127.0.0.1:3100/api/forecast
Content-Type: application/json

{"symbol":"TCS","horizon":"week","model":"technical"}
```

The response wraps the forecast in `data`, with `durationMs` alongside it:

- `summary.estimatedDirection`: `up`, `down`, or `flat`, based on the point estimate.
- `summary.signal`: `up`, `down`, or `uncertain`. The signal is withheld when
  the prediction range crosses the last close, a large price discontinuity
  is detected, or the model fails to beat a no-change baseline in backtesting.
- `forecast`: estimated INR closes, changes, and approximate 95% prediction
  ranges for each future trading-session number.
- `history`: requested dates, actual data coverage, and observation count.
- `backtest`: rolling test-block error versus the no-change baseline,
  historical directional accuracy, and historical interval coverage.
- `warnings`: model assumptions and limitations.
- `context`: market proxy status, market sensitivity, recent trend/volatility,
  news publication cutoff, coverage, provider sentiment, and reference headlines.

The explorer defaults to `model: 'technical'`, an official LightGBM regressor
with the rolling schedule below. The library's explicit `baseline` comparison
model remains available and is the default if `model` is omitted from a direct
library/API call. Technical features are computed causally from known closes.

At least 600 valid daily closes and coverage near the start of the three-year
window are required. History more than ten calendar days old is rejected.
Newly listed stocks, sparse histories, conflicting rows, or upstream failures
produce errors instead of invented forecasts. Invalid parameters return HTTP
400; exchange/data failures return 502. The existing explorer request lock
applies to forecasts too.

**This is an experimental baseline, not investment advice or a reliable
trading signal.** Historical directional accuracy is not the probability that
the next prediction is correct. Daily closes may be unadjusted for splits,
bonuses, and dividends; large discontinuities suppress the signal. Fundamentals,
intraday prices, and exchange holiday dates are not modeled. News sentiment is
used only as a risk overlay, not as a calibrated prediction of stock returns.
BSE forecasting is not currently supported.

#### LightGBM Rolling Train/Test

Run `npm run setup:lightgbm` once on Windows. It downloads the official Astral uv
tool, creates a project-local Python 3.12 environment, and installs LightGBM
4.6.0, NumPy and scikit-learn. Files are cached under
`node_modules/.cache/lightgbm`; no administrator privileges are needed. The
Node server invokes Python asynchronously. Alternatively set `LIGHTGBM_PYTHON`
to an existing Python executable with these dependencies installed. No API
token or hosted news service is required.

The schedule uses **calendar months**, not a random train/test split:

1. Fetch three years of actual historical closes from NSE.
2. Train on the first 14 months using 12 close-derived features: one-, five-,
  10-, and 20-session log returns; SMA20/50 and EMA12/26 ratios; RSI14; MACD
  histogram; Bollinger %B and bandwidth; and 20-session volatility. OHLCV-based
  indicators are not included. The added features have not yet been shown to
  improve out-of-sample accuracy.
3. Freeze that model and test daily short-horizon predictions in the following
   3 months. Each day's input uses only prices known at that prediction date.
4. Advance the window by 6 months: train on the next rolling 14-month window,
   which includes newly observed prices from the preceding period, and test
   its following 3 months. Repeat until no complete test block fits.
5. Refit on the latest 14 months of available actual data for the requested
   next-session/week/custom-range forecast.

For a history starting 2023-10-05, the four complete folds are:

| Fold | Train Start | Train End / Test Start | Test End |
| --- | --- | --- | --- |
| 1 | 2023-10-05 | 2024-12-05 | 2025-03-05 |
| 2 | 2024-04-05 | 2025-06-05 | 2025-09-05 |
| 3 | 2024-10-05 | 2025-12-05 | 2026-03-05 |
| 4 | 2025-04-05 | 2026-06-05 | 2026-09-05 |

End boundaries are exclusive. Advancing six months with a three-month test
window leaves three-month gaps between scored blocks. Those actual prices
can enter later training windows but aren't represented as test results.
This is a fixed 14-month **rolling** window, not an expanding window.

Earlier forecasts and their realized outcomes are retained in
`model.training.outOfSampleForecasts`. **Predicted prices are not treated as
actual training labels.** Once a prediction's actual target price is observed,
that real return may enter a later training fold. Prior completed fold errors
calibrate ranges for subsequent test folds. The first fold has no prior test
calibration and is excluded from interval coverage; `backtest.coverageSamples`
reports that denominator. Future forecast ranges use all past OOS errors.

Return labels that cross train/test boundaries are purged. The model is fixed
within each test block, not retrained on its test labels. Targets are direct
one-to-five-session returns, not a three-month future price path. For weekly
evaluation, targets overlap and are not independent trials. LightGBM uses
100 trees, 15 leaves, maximum depth 4, learning rate 0.05, two CPU threads, and
seed 42. Models are refitted per request, not persisted or incrementally appended.

The response includes fold dates, row counts, OOS forecasts versus observed
returns, error and direction metrics versus a no-change baseline, and actual
LightGBM version. The explorer defaults to LightGBM (`model: 'technical'`);
`model: 'baseline'` remains an explicit statistical comparison option.
No improvement or investment return is guaranteed.

#### Optional Local Context

`context: 'auto'` uses free NSE **NIFTYBEES** history as an Indian-market proxy
for risk flags. It is not a global market index. The baseline can use its beta
overlay; LightGBM predictions use trained technical features without that
heuristic price overlay. `context: 'off'` disables context entirely.

Sentiment defaults to `off`. Optional `sentiment: 'finbert'` scores only an
existing local archive; it makes no hosted news request. Configure
`FINBERT_NEWS_ARCHIVE` or constructor option `forecastTraining.newsArchivePath`:

```json
{
  "version": 1,
  "symbol": "TCS",
  "articles": [
    {"publishedAt":"2026-01-05T08:00:00Z","title":"Example financial headline"}
  ]
}
```

The schema example alone isn't enough for training. Archives are limited to
5 MB and 2000 timestamped headlines; `symbol` must match the requested stock
or be `GLOBAL`. Future articles are excluded before inference. Joint mode
`model: 'technical_finbert'` adds local sentiment features, requiring at least
120 covered training labels and 20 covered test labels in **each rolling fold**.
Missing history produces an error rather than a silently substituted model.

Local inference uses [ProsusAI FinBERT](https://github.com/ProsusAI/finBERT)
through its documented [ONNX conversion](https://huggingface.co/Xenova/finbert)
and optional Transformers.js runtime. Model weights download only on first
explicit FinBERT use, to `node_modules/.cache/finbert`. Scores classify English
financial sentiment, not stock-movement probabilities. Archived text revisions,
publication-time errors, unadjusted corporate actions and temporal dependence
remain risks. News-feature backtests do not include the extra latest-news risk
overlay. Technical-only training does not require any news archive.

Run the offline model and HTTP tests with `npm run test:forecast`.

### NSE API

#### Basic Usage

```typescript
import { NSE } from 'nse-bse-api';

const nse = new NSE('./downloads');

// Get stock quote
const quote = await nse.equityQuote('RELIANCE');

// Get historical data
const historical = await nse.historical.fetchEquityHistoricalData({
  symbol: 'RELIANCE',
  from_date: new Date('2024-01-01'),
  to_date: new Date('2024-01-31')
});

// Get option chain
const optionChain = await nse.options.getOptionChain('NIFTY');

// Search symbols
const results = await nse.market.lookup('reliance');
```

#### Available Methods

- `equityQuote(symbol)` - Get equity quote
- `market.lookup(query)` - Search symbols
- `market.getStatus()` - Market status
- `historical.fetchEquityHistoricalData(params)` - Historical data
- `options.getOptionChain(symbol)` - Option chain
- `corporate.getActions(params)` - Corporate actions
- `ipo.listCurrentIPO()` - Current IPOs

### BSE API

#### Basic Usage

```typescript
import { BSE } from 'nse-bse-api';

const bse = new BSE();

// Get stock quote
const quote = await bse.quote('500325'); // RELIANCE

// Get gainers
const gainers = await bse.gainers();

// Get corporate actions
const actions = await bse.actions({
  fromDate: new Date('2024-01-01'),
  toDate: new Date('2024-01-31')
});

// Search symbol
const results = await bse.lookupSymbol('reliance');
```

#### Available Methods

- `quote(scripcode)` - Get stock quote
- `gainers(options)` - Top gainers
- `losers(options)` - Top losers
- `actions(options)` - Corporate actions
- `announcements(options)` - Corporate announcements
- `lookupSymbol(text)` - Search symbols

## Configuration

### NSE Configuration

```typescript
const nse = new NSE('./downloads', {
  server: false,    // Use server mode
  timeout: 10000   // Request timeout in ms
});
```

### BSE Configuration

```typescript
const bse = new BSE({
  downloadFolder: './downloads',
  timeout: 10000
});
```

## Error Handling

```typescript
import { NSE, BSE } from 'nse-bse-api';

try {
  const nse = new NSE();
  const quote = await nse.equityQuote('INVALID');
} catch (error) {
  console.error('NSE Error:', error.message);
}

try {
  const bse = new BSE();
  const quote = await bse.quote('INVALID');
} catch (error) {
  console.error('BSE Error:', error.message);
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


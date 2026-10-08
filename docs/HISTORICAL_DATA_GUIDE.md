# Historical Data Guide

This guide covers the historical-data APIs already included in
`nse-bse-api`. The package calls the NSE and BSE public exchange endpoints; it
is a TypeScript library, not a hosted HTTP API.

## Install and import

```bash
npm install nse-bse-api
```

```typescript
import { BSE, NSE } from "nse-bse-api";
```

Create clients with a local download directory. NSE uses it for its cookies and
cache; BSE uses it for downloaded report files.

```typescript
const nse = new NSE("./downloads");
const bse = new BSE({ downloadFolder: "./downloads" });
```

Use `Date` objects for all date parameters. Construct them from an ISO date
such as `new Date("2024-01-01T00:00:00")` to make the intended calendar date
explicit.

## NSE historical data

The NSE client returns arrays of exchange records for price and derivatives
history. All date parameters are optional unless noted otherwise. If omitted,
the client requests the 30 days ending today.

### Equity price history

Use `nse.historical.fetchEquityHistoricalData` for a listed NSE equity.

```typescript
const relianceHistory = await nse.historical.fetchEquityHistoricalData({
  symbol: "RELIANCE",
  from_date: new Date("2024-01-01T00:00:00"),
  to_date: new Date("2024-01-31T00:00:00"),
  series: ["EQ"],
});

console.log(relianceHistory);
```

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `symbol` | `string` | Yes | — | NSE trading symbol, for example `RELIANCE` or `TCS`. |
| `from_date` | `Date` | No | 30 days before `to_date` | Inclusive start date. |
| `to_date` | `Date` | No | Today | Inclusive end date. |
| `series` | `string[]` | No | `["EQ"]` | NSE series to retrieve. Every specified series is requested. |

The client automatically splits an equity request into 100-day exchange
requests and joins the results. Each response chunk is reversed before it is
added, so inspect the returned exchange records and sort by their date field if
your application requires a guaranteed order across multiple series or chunks.

The compatibility alias `nse.fetch_equity_historical_data(params)` calls the
same method.

### India VIX history

Use `nse.historical.fetchHistoricalVixData` to retrieve India VIX history.

```typescript
const vixHistory = await nse.historical.fetchHistoricalVixData({
  from_date: new Date("2024-01-01T00:00:00"),
  to_date: new Date("2024-12-31T00:00:00"),
});

console.log(vixHistory);
```

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `from_date` | `Date` | No | 30 days before `to_date` | Inclusive start date. |
| `to_date` | `Date` | No | Today | Inclusive end date. |

VIX ranges are automatically split into 365-day requests. The compatibility
alias is `nse.fetch_historical_vix_data(params)`.

### Futures and options history

Use `nse.historical.fetchHistoricalFnoData` for index or stock futures and
options.

```typescript
const futuresHistory = await nse.historical.fetchHistoricalFnoData({
  symbol: "NIFTY",
  instrument: "FUTIDX",
  expiry: new Date("2024-01-25T00:00:00"),
  from_date: new Date("2024-01-01T00:00:00"),
  to_date: new Date("2024-01-25T00:00:00"),
});

const optionHistory = await nse.historical.fetchHistoricalFnoData({
  symbol: "NIFTY",
  instrument: "OPTIDX",
  expiry: new Date("2024-01-25T00:00:00"),
  option_type: "CE",
  strike_price: 21_500,
  from_date: new Date("2024-01-01T00:00:00"),
  to_date: new Date("2024-01-25T00:00:00"),
});
```

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `symbol` | `string` | Yes | — | Underlying NSE symbol. The client uppercases it. |
| `instrument` | `"FUTIDX" \| "FUTSTK" \| "OPTIDX" \| "OPTSTK" \| "FUTIVX"` | No | `"FUTIDX"` | Derivative instrument type. |
| `from_date` | `Date` | No | 30 days before `to_date` | Inclusive start date. |
| `to_date` | `Date` | No | Today | Inclusive end date. |
| `expiry` | `Date` | No | — | Contract expiry. |
| `option_type` | `"CE" \| "PE"` | For `OPTIDX` and `OPTSTK` | — | Call (`CE`) or put (`PE`). |
| `strike_price` | `number` | No | — | Option strike price. |

For option instruments, `option_type` is enforced and missing it throws an
error. F&O date ranges are automatically split into 365-day requests. The
compatibility alias is `nse.fetch_historical_fno_data(params)`.

To discover available derivative underlyings and NSE index names:

```typescript
const underlyings = await nse.historical.fetchFnoUnderlying();
const indexNames = await nse.historical.fetchIndexNames();
```

The equivalent aliases are `nse.fetch_fno_underlying()` and
`nse.fetch_index_names()`.

## BSE historical data

### Daily equity bhavcopy

Use `bse.bhavcopyReport` to download the BSE equity bhavcopy for one trading
date. It returns the downloaded CSV path, not parsed records.

```typescript
const bhavcopyPath = await bse.bhavcopyReport(
  new Date("2024-01-31T00:00:00"),
);

console.log(`Saved to ${bhavcopyPath}`);
```

Pass a second `folder` argument to write this report outside the configured
download folder:

```typescript
const bhavcopyPath = await bse.bhavcopyReport(
  new Date("2024-01-31T00:00:00"),
  "./downloads/bse",
);
```

### BSE index history

Use `bse.fetchHistoricalIndexData` to download a CSV for a BSE index range.
The returned value is the CSV path, or `null` when BSE produces an empty file.

```typescript
const sensexHistoryPath = await bse.fetchHistoricalIndexData({
  index: "S&P BSE SENSEX",
  fromDate: new Date("2024-01-01T00:00:00"),
  toDate: new Date("2024-01-31T00:00:00"),
  period: "D",
});

if (sensexHistoryPath) {
  console.log(`Saved to ${sensexHistoryPath}`);
}
```

| Parameter | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `index` | `string` | Yes | — | BSE index name. Retrieve the accepted values with `fetchIndexNames()`. |
| `fromDate` | `Date` | Yes | — | Inclusive start date. |
| `toDate` | `Date` | Yes | — | Inclusive end date. |
| `period` | `"D" \| "W" \| "M"` | No | `"D"` | Daily, weekly, or monthly report interval. |
| `folder` | `string` | No | Configured BSE download folder | Directory for the generated CSV. |

List BSE indices before requesting historical data:

```typescript
const indexNames = await bse.fetchIndexNames();
console.log(indexNames);
```

For data for every BSE index on one date, use
`bse.fetchAllIndicesDataByDate(date)`. Unlike the history download method, it
returns parsed API data:

```typescript
const dailyIndices = await bse.fetchAllIndicesDataByDate(
  new Date("2024-01-31T00:00:00"),
);
```

## Errors and cleanup

The clients reject requests when an exchange is unavailable, rate-limits a
request, a requested report is unavailable, or the date range is invalid. In
particular, NSE rejects a `from_date` after `to_date`, and BSE index history
rejects a `toDate` before `fromDate`.

Wrap calls in `try`/`catch` and always persist only the fields you need from
the exchange response, as exchange record shapes can change.

```typescript
try {
  const data = await nse.historical.fetchEquityHistoricalData({
    symbol: "RELIANCE",
    from_date: new Date("2024-01-01T00:00:00"),
    to_date: new Date("2024-01-31T00:00:00"),
  });
  console.log(data.length);
} catch (error) {
  console.error("Could not fetch NSE history:", error);
} finally {
  nse.exit();
  bse.close();
}
```

Exchange endpoints and historical availability are controlled by NSE and BSE.
Use sensible request rates and handle missing dates such as holidays or reports
that have not been published yet.

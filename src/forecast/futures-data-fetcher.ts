import type { HistoricalApi } from '../nse/api/historical-api.js';
import type { FuturesObservation } from './futures-features.js';

function normalizedDate(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const date = value.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (iso) {
    const parsed = new Date(`${date}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === date
      ? date
      : undefined;
  }
  const dmy = /^(\d{1,2})[-/]([A-Za-z]{3}|\d{1,2})[-/](\d{4})$/.exec(date);
  if (!dmy) return;
  const month = /^\d+$/.test(dmy[2])
    ? Number(dmy[2])
    : ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
        .indexOf(dmy[2].toLowerCase()) + 1;
  const normalized = `${dmy[3]}-${String(month).padStart(2, '0')}-${String(dmy[1]).padStart(2, '0')}`;
  const parsed = new Date(`${normalized}T00:00:00Z`);
  return month >= 1 && month <= 12 &&
    Number.isFinite(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === normalized
    ? normalized
    : undefined;
}

function positiveNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed =
      typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim()
          ? Number(value.replace(/,/g, ''))
          : NaN;
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function expiryDate(row: Record<string, unknown>): string | undefined {
  return normalizedDate(
    row.expiryDate ??
      row.expiry ??
      row.CH_EXPIRY_DATE ??
      row.FH_EXPIRY_DT
  );
}

export async function fetchHistoricalFuturesObservations(
  symbol: string,
  historicalApi: Partial<Pick<HistoricalApi, 'fetchHistoricalFnoData'>>,
  spotObservations: Array<{ date: string; close: number }>,
  fromDate: Date,
  toDate: Date
): Promise<FuturesObservation[]> {
  if (!historicalApi.fetchHistoricalFnoData)
    throw new Error('Historical futures data API is unavailable.');
  const isIndex = ['NIFTY50', 'NIFTYNXT50', 'BANKNIFTY', 'FINNIFTY'].includes(
    symbol.toUpperCase()
  );
  const rows = await historicalApi.fetchHistoricalFnoData({
    symbol,
    instrument: isIndex ? 'FUTIDX' : 'FUTSTK',
    from_date: fromDate,
    to_date: toDate,
  });
  if (!Array.isArray(rows))
    throw new Error(`Historical futures data for ${symbol} was not a list.`);

  const spots = new Map(spotObservations.map((row) => [row.date, row.close]));
  const grouped = new Map<string, {
    row: Record<string, unknown>;
    date: string;
    expiry?: string;
  }[]>();
  for (const row of rows) {
    const date = normalizedDate(
      row.date ??
        row.mtimestamp ??
        row.CH_TIMESTAMP ??
        row.chTimestamp ??
        row.FH_TIMESTAMP
    );
    if (!date || !spots.has(date)) continue;
    const values = grouped.get(date) ?? [];
    values.push({ row, date, expiry: expiryDate(row) });
    grouped.set(date, values);
  }

  const futures: FuturesObservation[] = [];
  for (const [date, candidates] of [...grouped].sort(([a], [b]) => a.localeCompare(b))) {
    const valid = candidates.flatMap((candidate) => {
      const futuresClose = positiveNumber(
        candidate.row.close,
        candidate.row.lastPrice,
        candidate.row.settlementPrice,
        candidate.row.chClosingPrice,
        candidate.row.CH_CLOSING_PRICE,
        candidate.row.FH_CLOSING_PRICE,
        candidate.row.FH_SETTLE_PRICE
      );
      const futuresOpenInterest = positiveNumber(
        candidate.row.openInterest,
        candidate.row.open_interest,
        candidate.row.CH_OPEN_INT,
        candidate.row.chOpenInterest,
        candidate.row.FH_OPEN_INT
      );
      return futuresClose && futuresOpenInterest
        ? [{ ...candidate, futuresClose, futuresOpenInterest }]
        : [];
    });
    if (!valid.length) continue;
    const dated = valid.filter(
      (candidate) => candidate.expiry && candidate.expiry >= date
    );
    const active = dated.length ? dated : valid;
    let frontContract: typeof valid[number];
    if (dated.length) {
      active.sort((a, b) => a.expiry!.localeCompare(b.expiry!));
      frontContract = active[0];
      if (active.length > 1 && active[0].expiry === active[1].expiry)
        throw new Error(`Ambiguous front-month futures data for ${symbol} on ${date}.`);
    } else if (valid.length === 1) {
      frontContract = valid[0];
    } else {
      throw new Error(`Cannot identify the front-month futures contract for ${symbol} on ${date}.`);
    }

    const totalOpenInterest = active.reduce(
      (sum, candidate) => sum + candidate.futuresOpenInterest,
      0
    );
    futures.push({
      date,
      spotClose: spots.get(date)!,
      futuresClose: frontContract.futuresClose,
      futuresOpenInterest: totalOpenInterest,
    });
  }

  return futures;
}

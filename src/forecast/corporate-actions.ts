export interface ShareAdjustment {
  exDate: string;
  subject: string;
  shareFactor: number;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
];

function optionalActionDate(value: string): string | undefined {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
  if (iso) {
    const parsed = new Date(`${iso}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso
      ? iso
      : undefined;
  }
  const nse = /^(\d{1,2})-([a-z]{3})-(\d{4})$/i.exec(value);
  if (!nse) return undefined;
  const month = MONTHS.indexOf(nse[2].toLowerCase()) + 1;
  if (!month) return undefined;
  const date = `${nse[3]}-${String(month).padStart(2, '0')}-${nse[1].padStart(2, '0')}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined;
}

function parseActionDate(value: unknown): string {
  if (typeof value !== 'string')
    throw new Error('Corporate action is missing a valid ex-date.');
  const date = optionalActionDate(value);
  if (date) return date;
  throw new Error(`Corporate action has an invalid ex-date: ${value}.`);
}

function parseShareFactor(subject: string): number | undefined {
  const bonus = /bonus\s+(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/i.exec(subject);
  if (bonus) {
    const bonusShares = Number(bonus[1]);
    const existingShares = Number(bonus[2]);
    const factor = 1 + bonusShares / existingShares;
    if (
      Number.isFinite(factor) &&
      factor > 1 &&
      Number.isFinite(existingShares) &&
      existingShares > 0
    )
      return factor;
    throw new Error(`Corporate bonus ratio cannot be interpreted: ${subject}.`);
  }

  if (/bonus/i.test(subject))
    throw new Error(`Corporate bonus ratio cannot be interpreted: ${subject}.`);

  if (!/(split|sub-division)/i.test(subject)) return undefined;
  const split =
    /from\s+(?:rs\.?\s*)?(\d+(?:\.\d+)?)\s*(?:\/-\s*)?(?:per\s+share\s*)?to\s+(?:rs\.?\s*)?(?:re\s*)?(\d+(?:\.\d+)?)/i.exec(
      subject
    );
  if (!split)
    throw new Error(`Corporate split terms cannot be interpreted: ${subject}.`);
  const oldFaceValue = Number(split[1]);
  const newFaceValue = Number(split[2]);
  const factor = oldFaceValue / newFaceValue;
  if (
    !Number.isFinite(factor) ||
    factor <= 1 ||
    newFaceValue <= 0 ||
    oldFaceValue <= 0
  )
    throw new Error(`Corporate split terms cannot be interpreted: ${subject}.`);
  return factor;
}

export function parseNseShareAdjustments(
  rows: Record<string, unknown>[],
  expectedSymbol: string
): ShareAdjustment[] {
  const unique = new Map<string, ShareAdjustment>();
  for (const row of rows) {
    if (!row || typeof row !== 'object')
      throw new Error('Corporate action response contains an invalid row.');
    const rowSymbol = row.symbol ?? row.SYMBOL;
    if (rowSymbol && rowSymbol !== expectedSymbol)
      throw new Error('Corporate action response contains a different symbol.');
    const subjectValue = row.subject ?? row.SUBJECT;
    if (typeof subjectValue !== 'string') continue;
    const shareFactor = parseShareFactor(subjectValue);
    if (shareFactor === undefined) continue;
    const exDate = parseActionDate(row.exDate ?? row.EX_DATE ?? row.ex_date);
    const key = `${exDate}\u0000${subjectValue}`;
    if (!unique.has(key))
      unique.set(key, { exDate, subject: subjectValue, shareFactor });
  }
  return [...unique.values()].sort(
    (left, right) =>
      left.exDate.localeCompare(right.exDate) ||
      left.subject.localeCompare(right.subject)
  );
}

function adjustedPrice(row: Record<string, unknown>, keys: string[], factor: number) {
  if (factor === 1) return;
  const key = keys.find((candidate) => candidate in row);
  if (!key) return;
  const value = row[key];
  const price =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim()
        ? Number(value.replace(/,/g, ''))
        : NaN;
  if (Number.isFinite(price) && price > 0) row[key] = price / factor;
}

export function adjustHistoricalRows(
  rows: Record<string, unknown>[],
  actions: ShareAdjustment[]
): Record<string, unknown>[] {
  if (!actions.length) return rows;
  return rows.map((source) => {
    const row = { ...source };
    const rawDate = row.mtimestamp ?? row.CH_TIMESTAMP ?? row.chTimestamp;
    if (typeof rawDate !== 'string') return row;
    const date = optionalActionDate(
      /^\d{4}-\d{2}-\d{2}/.test(rawDate)
        ? rawDate.slice(0, 10)
        : rawDate
    );
    if (!date) return row;
    const factor = actions.reduce(
      (total, action) => (date < action.exDate ? total * action.shareFactor : total),
      1
    );
    if (!Number.isFinite(factor) || factor <= 0)
      throw new Error(`Invalid cumulative corporate-action factor for ${date}.`);
    for (const keys of [
      ['chOpeningPrice', 'CH_OPENING_PRICE'],
      ['chTradeHighPrice', 'CH_TRADE_HIGH_PRICE'],
      ['chTradeLowPrice', 'CH_TRADE_LOW_PRICE'],
      ['chClosingPrice', 'CH_CLOSING_PRICE'],
    ])
      adjustedPrice(row, keys, factor);
    return row;
  });
}

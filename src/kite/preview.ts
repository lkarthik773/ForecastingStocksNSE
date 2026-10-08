import type { ForecastResult } from '../forecast/forecast-api.js';

export const KITE_PREVIEW_LIMITS = {
  maxNotionalInr: 10000,
  maxForecastAgeMs: 15 * 60 * 1000,
  minBacktestSamples: 30,
  minDirectionalAccuracyPct: 55,
  maxCloseAgeDays: 10,
} as const;

export interface KitePreviewRequest {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  limitPrice: number;
  horizon: 'next_day' | 'week';
}

export interface KiteForecastDiagnostics {
  generatedAt: string;
  ageMs: number | null;
  lastClose: ForecastResult['lastClose'];
  closeAgeDays: number | null;
  model: string;
  horizon: ForecastResult['horizon'];
  signal: ForecastResult['summary']['signal'];
  estimatedDirection: ForecastResult['summary']['estimatedDirection'];
  expectedChangePct: number;
  summaryReason: string;
  projected: ForecastResult['forecast'][number] | null;
  backtest: ForecastResult['backtest'];
  elevatedRisk: boolean | null;
  warnings: string[];
}

export interface KitePreviewResult {
  eligible: boolean;
  blockedReasons: string[];
  forecast?: KiteForecastDiagnostics;
  preview?: {
    previewOnly: true;
    mode: 'HOLD';
    tradingEnabled: false;
    order: {
      symbol: string;
      exchange: 'NSE';
      transactionType: 'BUY' | 'SELL';
      product: 'CNC';
      orderType: 'LIMIT';
      quantity: number;
      limitPrice: number;
      estimatedNotionalInr: number;
    };
    forecast: {
      generatedAt: string;
      lastClose: ForecastResult['lastClose'];
      model: string;
      horizon: ForecastResult['horizon'];
      signal: ForecastResult['summary']['signal'];
      estimatedDirection: ForecastResult['summary']['estimatedDirection'];
      expectedChangePct: number;
      backtest: ForecastResult['backtest'];
      elevatedRisk: boolean;
      warnings: string[];
    };
  };
}

export class KitePreviewError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

export function parseKitePreviewRequest(value: unknown): KitePreviewRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new KitePreviewError(400, 'Request body must be a JSON object.');

  const body = value as Record<string, unknown>;
  const allowedKeys = new Set(['symbol', 'side', 'quantity', 'limitPrice', 'horizon']);
  if (Object.keys(body).some((key) => !allowedKeys.has(key)))
    throw new KitePreviewError(400, 'Request contains unsupported fields.');

  if (typeof body.symbol !== 'string' || !/^[A-Z0-9&._-]{1,30}$/i.test(body.symbol.trim()))
    throw new KitePreviewError(400, 'Provide a valid NSE stock symbol.');
  if (body.side !== 'BUY' && body.side !== 'SELL')
    throw new KitePreviewError(400, 'side must be BUY or SELL.');
  if (typeof body.quantity !== 'number' || !Number.isSafeInteger(body.quantity) || body.quantity <= 0)
    throw new KitePreviewError(400, 'quantity must be a positive whole number.');
  if (typeof body.limitPrice !== 'number' || !Number.isFinite(body.limitPrice) || body.limitPrice <= 0)
    throw new KitePreviewError(400, 'limitPrice must be a positive finite number.');
  if (body.horizon !== undefined && body.horizon !== 'next_day' && body.horizon !== 'week')
    throw new KitePreviewError(400, 'horizon must be next_day or week.');

  return {
    symbol: body.symbol.trim().toUpperCase(),
    side: body.side,
    quantity: body.quantity,
    limitPrice: body.limitPrice,
    horizon: body.horizon ?? 'next_day',
  };
}

function calendarDateAge(date: string, now: Date): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return;
  const indiaToday = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  return Math.floor((Date.parse(`${indiaToday}T00:00:00Z`) - parsed.getTime()) / 86400000);
}

export function assessKitePreview(
  request: KitePreviewRequest,
  forecast: ForecastResult,
  now = new Date()
): KitePreviewResult {
  const blockedReasons: string[] = [];
  const notional = request.quantity * request.limitPrice;
  if (!Number.isFinite(notional) || notional > KITE_PREVIEW_LIMITS.maxNotionalInr)
    blockedReasons.push(`Estimated notional must not exceed INR ${KITE_PREVIEW_LIMITS.maxNotionalInr}.`);

  if (forecast.symbol !== request.symbol || forecast.exchange !== 'NSE' || forecast.currency !== 'INR')
    blockedReasons.push('Forecast symbol or market does not match the requested NSE order.');
  if (forecast.model.name !== 'LightGBM rolling technical-indicator model')
    blockedReasons.push('Only the explicit technical-indicator forecast model is accepted.');

  const generatedAt = Date.parse(forecast.generatedAt);
  const forecastAge = now.getTime() - generatedAt;
  if (!Number.isFinite(generatedAt) || forecastAge < 0 || forecastAge >= KITE_PREVIEW_LIMITS.maxForecastAgeMs)
    blockedReasons.push('Forecast must be less than 15 minutes old and must not be future-dated.');

  const closeAge = calendarDateAge(forecast.lastClose.date, now);
  if (closeAge === undefined || closeAge < 0 || closeAge > KITE_PREVIEW_LIMITS.maxCloseAgeDays)
    blockedReasons.push('Latest close data must be no more than 10 calendar days old.');

  const expectedSignal = request.side === 'BUY' ? 'up' : 'down';
  if (forecast.summary.signal !== expectedSignal || forecast.summary.estimatedDirection !== expectedSignal)
    blockedReasons.push('Forecast signal and estimated direction must both match the requested side.');
  if (!forecast.backtest.beatsNaive)
    blockedReasons.push('Forecast must beat the no-change backtest baseline.');
  if (!Number.isSafeInteger(forecast.backtest.samples) ||
      forecast.backtest.samples < KITE_PREVIEW_LIMITS.minBacktestSamples)
    blockedReasons.push(`Backtest must contain at least ${KITE_PREVIEW_LIMITS.minBacktestSamples} samples.`);
  if (!Number.isFinite(forecast.backtest.directionalAccuracyPct) ||
      forecast.backtest.directionalAccuracyPct < KITE_PREVIEW_LIMITS.minDirectionalAccuracyPct ||
      forecast.backtest.directionalAccuracyPct > 100)
    blockedReasons.push(`Backtest directional accuracy must be at least ${KITE_PREVIEW_LIMITS.minDirectionalAccuracyPct}%.`);
  if (!Number.isFinite(forecast.lastClose.price) || forecast.lastClose.price <= 0 ||
      !Number.isFinite(forecast.summary.expectedChangePct))
    blockedReasons.push('Forecast prices and expected change must be finite and positive where applicable.');
  if (!forecast.context || forecast.context.elevatedRisk !== false)
    blockedReasons.push('A clear forecast risk assessment is required; elevated or unavailable risk blocks previews.');

  const diagnostics: KiteForecastDiagnostics = {
    generatedAt: forecast.generatedAt,
    ageMs: Number.isFinite(forecastAge) && forecastAge >= 0 ? forecastAge : null,
    lastClose: forecast.lastClose,
    closeAgeDays: closeAge ?? null,
    model: forecast.model.name,
    horizon: forecast.horizon,
    signal: forecast.summary.signal,
    estimatedDirection: forecast.summary.estimatedDirection,
    expectedChangePct: forecast.summary.expectedChangePct,
    summaryReason: forecast.summary.reason,
    projected: forecast.forecast.at(-1) ?? null,
    backtest: forecast.backtest,
    elevatedRisk: forecast.context?.elevatedRisk ?? null,
    warnings: forecast.warnings,
  };

  if (blockedReasons.length > 0)
    return { eligible: false, blockedReasons, forecast: diagnostics };

  return {
    eligible: true,
    blockedReasons: [],
    preview: {
      previewOnly: true,
      mode: 'HOLD',
      tradingEnabled: false,
      order: {
        symbol: request.symbol,
        exchange: 'NSE',
        transactionType: request.side,
        product: 'CNC',
        orderType: 'LIMIT',
        quantity: request.quantity,
        limitPrice: request.limitPrice,
        estimatedNotionalInr: Number(notional.toFixed(2)),
      },
      forecast: {
        generatedAt: diagnostics.generatedAt,
        lastClose: diagnostics.lastClose,
        model: diagnostics.model,
        horizon: diagnostics.horizon,
        signal: diagnostics.signal,
        estimatedDirection: diagnostics.estimatedDirection,
        expectedChangePct: diagnostics.expectedChangePct,
        backtest: diagnostics.backtest,
        elevatedRisk: diagnostics.elevatedRisk ?? false,
        warnings: diagnostics.warnings,
      },
    },
  };
}

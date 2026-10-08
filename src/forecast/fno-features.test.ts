import { describe, expect, it } from 'vitest';
import {
  calculateFnoFeatures,
  validateFnoData,
  type FnoData,
} from './fno-features.js';

const makeData = (count = 25): { spot: Array<{ date: string; close: number; volume: number }>; fno: FnoData[] } => {
  const spot = [];
  const fno: FnoData[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10);
    const price = 100 + i;
    spot.push({ date, close: price, volume: 10_000 + i * 100 });
    fno.push({
      date,
      spotsPrice: price,
      futuresPrice: price * 1.01,
      futuresOpenInterest: 1_000 + i * 50,
      callOpenInterest: 500 + i * 10,
      putOpenInterest: 400 + i * 20,
      callVolume: 200 + i * 5,
      putVolume: 180 + i * 4,
      spotVolume: 10_000 + i * 100,
    });
  }
  return { spot, fno };
};

describe('calculateFnoFeatures', () => {
  it('calculates all 28 finite features for a valid history', () => {
    const { spot, fno } = makeData();
    const features = calculateFnoFeatures(spot, fno);
    expect(features).not.toBeNull();
    expect(Object.keys(features!)).toHaveLength(28);
    expect(Object.values(features!).every(Number.isFinite)).toBe(true);
    expect(features!.futuresPremiumPct).toBeCloseTo(1, 8);
    expect(features!.putCallRatio).toBeCloseTo(880 / 740, 8);
  });

  it('supports shorter premium and open-interest lookbacks', () => {
    const { spot, fno } = makeData();
    const changedPremium = fno.map((row, index) =>
      index === 21 ? { ...row, futuresPrice: row.spotsPrice * 1.05 } : row
    );
    const standard = calculateFnoFeatures(spot, changedPremium)!;
    const shorter = calculateFnoFeatures(spot, changedPremium, {
      premium: 3,
      oiShort: 3,
      oiLong: 10,
    })!;
    expect(shorter.premiumTrendCh5Day).not.toBeCloseTo(
      standard.premiumTrendCh5Day,
      8
    );
    expect(shorter.totalOISma5).not.toBeCloseTo(standard.totalOISma5, 8);
    expect(shorter.totalOISma20).not.toBeCloseTo(standard.totalOISma20, 8);
    expect(Object.values(shorter).every(Number.isFinite)).toBe(true);
  });

  it('rejects invalid feature lookbacks', () => {
    const { spot, fno } = makeData();
    expect(
      calculateFnoFeatures(spot, fno, {
        premium: 0,
        oiShort: 3,
        oiLong: 10,
      })
    ).toBeNull();
    expect(
      calculateFnoFeatures(spot, fno, {
        premium: 3,
        oiShort: 10,
        oiLong: 5,
      })
    ).toBeNull();
  });

  it('returns null when there is insufficient history or an invalid latest future', () => {
    const { spot, fno } = makeData();
    expect(calculateFnoFeatures(spot.slice(0, 19), fno)).toBeNull();
    expect(calculateFnoFeatures(spot, fno.slice(0, 1))).toBeNull();
    expect(calculateFnoFeatures(spot, [...fno.slice(0, -1), { ...fno.at(-1)!, futuresPrice: 0 }])).toBeNull();
  });

  it('handles zero OI and volume denominators without infinities', () => {
    const { spot, fno } = makeData();
    const latest = { ...fno.at(-1)!, futuresOpenInterest: 0, callOpenInterest: 0, putOpenInterest: 0, callVolume: 0, putVolume: 0 };
    const features = calculateFnoFeatures(spot, [...fno.slice(0, -1), latest])!;
    expect(Object.values(features).every(Number.isFinite)).toBe(true);
    expect(features.putCallRatio).toBe(0);
    expect(features.putCallVolumeRatio).toBe(0);
    expect(features.callPutStrength).toBe(0);
  });

  it('emits the correct price/OI conviction combination', () => {
    const { spot, fno } = makeData();
    const features = calculateFnoFeatures(spot, fno)!;
    expect(features.priceUpOIUp).toBe(1);
    expect(features.priceUpOIDown).toBe(0);
    expect(features.priceDownOIUp).toBe(0);
    expect(features.priceDownOIDown).toBe(0);
  });

  it('keeps normalized and clipped indicators within documented bounds', () => {
    const { spot, fno } = makeData();
    const features = calculateFnoFeatures(spot, fno)!;
    expect(features.callPutStrength).toBeGreaterThanOrEqual(-1);
    expect(features.callPutStrength).toBeLessThanOrEqual(1);
    expect(features.oiBias).toBeGreaterThanOrEqual(-1);
    expect(features.oiBias).toBeLessThanOrEqual(1);
    expect(features.oiSkewFavorsCall).toBeGreaterThanOrEqual(0);
    expect(features.oiSkewFavorsCall).toBeLessThanOrEqual(1);
    expect(features.oiSkewFavorsPut).toBeGreaterThanOrEqual(0);
    expect(features.oiSkewFavorsPut).toBeLessThanOrEqual(1);
  });

  it('rejects malformed, negative, and non-finite F&O rows', () => {
    const { fno } = makeData(2);
    expect(validateFnoData([]).isValid).toBe(false);
    expect(validateFnoData([{ ...fno[0], futuresOpenInterest: -1 }]).isValid).toBe(false);
    expect(validateFnoData([{ ...fno[0], callVolume: Number.NaN }]).isValid).toBe(false);
    expect(validateFnoData([{ ...fno[0], spotsPrice: Number.NaN }]).isValid).toBe(false);
  });

  it('does not return NaN features for non-finite source values', () => {
    const { spot, fno } = makeData();
    const result = calculateFnoFeatures(spot, [...fno.slice(0, -1), { ...fno.at(-1)!, putOpenInterest: Number.NaN }]);
    expect(result === null || Object.values(result).every(Number.isFinite)).toBe(true);
  });
});

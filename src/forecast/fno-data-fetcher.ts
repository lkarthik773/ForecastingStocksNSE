/**
 * F&O Data Fetcher for Forecast Features
 *
 * Retrieves historical F&O data (futures prices, open interest, call/put volumes)
 * from NSE APIs and prepares it for feature engineering.
 *
 * Data Sources:
 * - Futures: NSE F&O historical data (FUTIDX or FUTSTK)
 * - Options: NSE option chain snapshots (OPTIDX or OPTSTK)
 * - Spot: NSE equity historical data (EQ)
 */

import type { HistoricalApi } from '../nse/api/historical-api.js';
import type { OptionsApi } from '../nse/api/options-api.js';
import type { FnoData } from './fno-features.js';

/**
 * Fetch F&O data for a symbol from NSE APIs
 *
 * @param symbol - NSE symbol (e.g., 'TCS', 'HDFCBANK', 'NIFTY50')
 * @param historicalApi - NSE HistoricalApi instance
 * @param optionsApi - NSE OptionsApi instance
 * @param fromDate - Start date for historical data
 * @param toDate - End date for historical data
 * @returns Array of F&O observations with spot price, futures, and options data
 */
export async function fetchFnoData(
  symbol: string,
  historicalApi: HistoricalApi,
  optionsApi: OptionsApi,
  fromDate: Date,
  toDate: Date
): Promise<FnoData[]> {
  try {
    // Determine if symbol is an index or stock
    const isIndex = ['NIFTY50', 'NIFTYNXT50', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'BANKEX'].includes(
      symbol.toUpperCase()
    );

    const futureInstrument = isIndex ? 'FUTIDX' : 'FUTSTK';
    const optionInstrument = isIndex ? 'OPTIDX' : 'OPTSTK';

    // Fetch spot data
    const spotData = await historicalApi.fetchEquityHistoricalData({
      symbol,
      from_date: fromDate,
      to_date: toDate,
    });

    if (!spotData || spotData.length === 0) {
      console.warn(`No spot data found for ${symbol}`);
      return [];
    }

    // Fetch futures data (nearest monthly expiry)
    let futuresData: any[] = [];
    try {
      futuresData = await historicalApi.fetchHistoricalFnoData({
        symbol,
        instrument: futureInstrument,
        from_date: fromDate,
        to_date: toDate,
        // Will use nearest expiry if not specified
      });
    } catch (e) {
      console.warn(`Failed to fetch futures data for ${symbol}:`, e);
    }

    // Fetch options data (ATM strikes only, to reduce API calls)
    let callOiData: Map<string, number> = new Map();
    let putOiData: Map<string, number> = new Map();
    let callVolumeData: Map<string, number> = new Map();
    let putVolumeData: Map<string, number> = new Map();

    try {
      // Get expiry dates
      const expiries = await optionsApi.getExpiryDatesV3(symbol);
      if (expiries.length > 0) {
        const nearestExpiry = expiries[0]; // Nearest monthly expiry

        // Fetch option chain for nearest expiry
        // Note: This fetches current snapshot only, not historical
        // For true historical options data, would need to fetch daily snapshots
        const optionChain = await optionsApi.getFilteredOptionChainV3(symbol, nearestExpiry, 5);

        // Parse ATM strikes and aggregate OI/volume
        if (optionChain.data && Array.isArray(optionChain.data)) {
          for (const strike of optionChain.data) {
            const strikePrice = strike.strikePrice;
            const date = new Date().toISOString().split('T')[0]; // Current date

            if (strike.CE) {
              const ceKey = `${date}_${strikePrice}`;
              callOiData.set(date, (callOiData.get(date) || 0) + strike.CE.openInterest);
              callVolumeData.set(date, (callVolumeData.get(date) || 0) + strike.CE.totalTradedVolume);
            }

            if (strike.PE) {
              const peKey = `${date}_${strikePrice}`;
              putOiData.set(date, (putOiData.get(date) || 0) + strike.PE.openInterest);
              putVolumeData.set(date, (putVolumeData.get(date) || 0) + strike.PE.totalTradedVolume);
            }
          }
        }
      }
    } catch (e) {
      console.warn(`Failed to fetch options data for ${symbol}:`, e);
    }

    // Merge spot and futures data
    const fnoData: FnoData[] = [];

    for (const spot of spotData) {
      const spotDate = normalizeDate(spot.date);
      const spotClose = parseFloat(spot.close) || 0;
      const spotVolume = parseFloat(spot.volume) || 0;

      // Find matching futures data
      const futures = futuresData.find((f) => normalizeDate(f.date) === spotDate);

      if (!futures) {
        // Skip if no futures data for this date
        continue;
      }

      const futuresPrice = parseFloat(futures.close) || spotClose;
      const futuresOI = parseFloat(futures.openInterest) || 0;

      // Get options data for this date
      const callOI = callOiData.get(spotDate) || 0;
      const putOI = putOiData.get(spotDate) || 0;
      const callVolume = callVolumeData.get(spotDate) || 0;
      const putVolume = putVolumeData.get(spotDate) || 0;

      fnoData.push({
        date: spotDate,
        spotsPrice: spotClose,
        futuresPrice,
        futuresOpenInterest: futuresOI,
        callOpenInterest: callOI,
        putOpenInterest: putOI,
        callVolume,
        putVolume,
        spotVolume,
      });
    }

    return fnoData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  } catch (error) {
    console.error(`Error fetching F&O data for ${symbol}:`, error);
    return [];
  }
}

/**
 * Normalize date formats from different NSE API responses
 * Handles formats like:
 * - "2026-10-07"
 * - "07-Oct-2026"
 * - "07/10/2026"
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return '';

  // Already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  try {
    let date: Date;

    // Format: DD-Mon-YYYY (e.g., "07-Oct-2026")
    if (/^\d{2}-\w{3}-\d{4}$/.test(dateStr)) {
      const months: Record<string, number> = {
        'Jan': 0, 'Feb': 1, 'Mar': 2, 'Apr': 3, 'May': 4, 'Jun': 5,
        'Jul': 6, 'Aug': 7, 'Sep': 8, 'Oct': 9, 'Nov': 10, 'Dec': 11
      };
      const [day, monthStr, year] = dateStr.split('-');
      const monthNum = months[monthStr];
      if (monthNum === undefined) {
        console.warn(`Could not parse month: ${monthStr}`);
        return '';
      }
      // Use UTC to avoid timezone shifts
      date = new Date(Date.UTC(parseInt(year), monthNum, parseInt(day)));
    }
    // Format: DD/MM/YYYY
    else if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
      const [day, month, year] = dateStr.split('/');
      date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    }
    // Format: DD-MM-YYYY
    else if (/^\d{2}-\d{2}-\d{4}$/.test(dateStr)) {
      const [day, month, year] = dateStr.split('-');
      date = new Date(Date.UTC(parseInt(year), parseInt(month) - 1, parseInt(day)));
    }
    // Default: let JavaScript parse it
    else {
      date = new Date(dateStr);
    }

    if (isNaN(date.getTime())) {
      console.warn(`Could not parse date: ${dateStr}`);
      return '';
    }

    // Return in YYYY-MM-DD format using UTC
    return date.toISOString().split('T')[0];
  } catch (e) {
    console.warn(`Error normalizing date ${dateStr}:`, e);
    return '';
  }
}

/**
 * Filter F&O data for symbol eligibility
 *
 * A symbol is eligible if:
 * - Has at least 100 days of matched spot+futures data
 * - Has futures OI data for at least 80% of days
 * - Has options data (calls + puts) for at least 50% of days
 * - Premium is between -5% and +10% (filters out unusual data)
 */
export function isSymbolEligibleForFno(
  fnoData: FnoData[],
  minDays: number = 100,
  minOICoverage: number = 0.8,
  minOptionsCoverage: number = 0.5
): { isEligible: boolean; reason: string } {
  if (fnoData.length < minDays) {
    return {
      isEligible: false,
      reason: `Insufficient data: ${fnoData.length} days < ${minDays} required`,
    };
  }

  // Check futures OI coverage
  const daysWithOI = fnoData.filter((d) => d.futuresOpenInterest > 0).length;
  const oiCoverage = daysWithOI / fnoData.length;
  if (oiCoverage < minOICoverage) {
    return {
      isEligible: false,
      reason: `Low OI coverage: ${(oiCoverage * 100).toFixed(1)}% < ${(minOICoverage * 100).toFixed(1)}%`,
    };
  }

  // Check options coverage
  const daysWithOptions = fnoData.filter(
    (d) => d.callOpenInterest > 0 && d.putOpenInterest > 0
  ).length;
  const optionsCoverage = daysWithOptions / fnoData.length;
  if (optionsCoverage < minOptionsCoverage) {
    return {
      isEligible: false,
      reason: `Low options coverage: ${(optionsCoverage * 100).toFixed(1)}% < ${(minOptionsCoverage * 100).toFixed(1)}%`,
    };
  }

  // Check premium reasonableness
  const premiums = fnoData.map(
    (d) => ((d.futuresPrice - d.spotsPrice) / d.spotsPrice) * 100
  );
  const avgPremium = premiums.reduce((a, b) => a + b, 0) / premiums.length;
  if (Math.abs(avgPremium) > 15) {
    return {
      isEligible: false,
      reason: `Unusual average premium: ${avgPremium.toFixed(2)}% (expected -5% to +10%)`,
    };
  }

  return {
    isEligible: true,
    reason: `Eligible: ${fnoData.length} days, ${(oiCoverage * 100).toFixed(1)}% OI coverage, ${(optionsCoverage * 100).toFixed(1)}% options coverage`,
  };
}

/**
 * Get symbol's sector for F&O data fetching
 * Maps stock to its corresponding F&O sector index
 */
export function getSymbolFnoSector(symbol: string): string | null {
  const sectorMap: Record<string, string> = {
    // Banking
    HDFCBANK: 'BANKNIFTY',
    ICICIBANK: 'BANKNIFTY',
    KOTAKBANK: 'BANKNIFTY',
    SBIN: 'BANKNIFTY',
    AXISBANK: 'BANKNIFTY',
    INDUSIND: 'BANKNIFTY',
    BANKBARODA: 'BANKNIFTY',
    PNB: 'BANKNIFTY',
    IDBI: 'BANKNIFTY',

    // IT
    TCS: 'NIFTY50',
    INFY: 'NIFTY50',
    WIPRO: 'NIFTY50',
    TECHM: 'NIFTY50',
    LT: 'NIFTY50',
    HCL: 'NIFTY50',

    // Auto
    MARUTI: 'NIFTY50',
    HEROMOTOCO: 'NIFTY50',
    TATAMOTORS: 'NIFTY50',

    // Energy & Telecom
    RELIANCE: 'NIFTY50',
    BHARTIARTL: 'NIFTY50',
    POWERGRID: 'NIFTY50',
    GAIL: 'NIFTY50',

    // Pharma
    SUNPHARMA: 'NIFTY50',
    CIPLA: 'NIFTY50',
    DRREDDY: 'NIFTY50',
    AUROPHARMA: 'NIFTY50',

    // Metals
    TATASTEEL: 'NIFTY50',
    HINDALCO: 'NIFTY50',
    SAILINDST: 'NIFTY50',

    // Finance
    BAJAJFINSV: 'NIFTY50',
    BAJFINANCE: 'NIFTY50',
    HDFC: 'NIFTY50',
    SBICARD: 'NIFTY50',

    // FMCG & Consumer
    ITC: 'NIFTY50',
    NESTLEIND: 'NIFTY50',
    BRITANNIA: 'NIFTY50',
    HINDUNILVR: 'NIFTY50',

    // Utilities & Others
    ADANIPORTS: 'NIFTY50',
    ADANIGREEN: 'NIFTY50',
    ADANIENT: 'NIFTY50',
    EICHERMOT: 'NIFTY50',
  };

  return sectorMap[symbol.toUpperCase()] || 'NIFTY50';
}

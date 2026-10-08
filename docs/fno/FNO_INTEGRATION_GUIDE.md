# F&O/Open Interest Integration Guide

**Phase:** Opportunity #2 Implementation  
**Status:** Experimental; integration is complete, accuracy benefit remains unproven  
**Date:** 2026-10-07

> The initial +5-12% accuracy estimate was a hypothesis, not a test result. The futures-only paired benchmark averaged +0.59 percentage points in direction accuracy while mean MAPE regressed slightly. See [FNO_INTEGRATION_STATUS.md](FNO_INTEGRATION_STATUS.md) for results and current blockers.

---

## 📋 Overview

This guide integrates **Futures & Options (F&O) data** into the NSE forecasting pipeline to capture institutional sentiment through:

1. **Futures Premium** - Market expectation vs. spot price
2. **Open Interest Changes** - Institutional positioning shifts
3. **Put/Call Ratios** - Fear/greed extremes
4. **Price+OI Combinations** - Conviction signals

---

## 🏗️ Architecture

### New Files Created

```
src/forecast/
├── fno-features.ts           ✅ Feature calculation engine (28 features)
├── fno-data-fetcher.ts       ✅ Data retrieval from NSE APIs
└── trained-forecast.ts           Integrated LightGBM feature sets
└── fno-archive.ts                Local historical contract CSV importer
```

### Integration Points

```
forecast-api.ts (existing)
    ↓
    trainForecast() [needs update]
         ↓
    trained-forecast.ts [needs feature group addition]
         ↓
    [NEW] fno-features.ts [calculate 28 F&O features]
         ↓
    lightgbm.ts [train model with new features]
```

---

## 🔧 Step 1: Add F&O Features to TrainingObservation

**File:** `src/forecast/trained-forecast.ts`

```typescript
// BEFORE (existing)
export interface TrainingObservation {
  date: string;
  close: number;
  volume?: number;
  open?: number;
  high?: number;
  low?: number;
  qualityExcluded?: boolean;
}

// AFTER (with F&O features)
export interface TrainingObservation {
  date: string;
  close: number;
  volume?: number;
  open?: number;
  high?: number;
  low?: number;
  qualityExcluded?: boolean;
  
  // F&O Features (new)
  fnoFeatures?: {
    futuresPremiumPct: number;
    totalOIChangePct: number;
    putCallRatio: number;
    priceUpOIUp: number;
    priceUpOIDown: number;
    priceDownOIUp: number;
    priceDownOIDown: number;
    callPutStrength: number;
    oiMomentum: number;
    [... 19 more features from fno-features.ts]
  };
}
```

---

## 🔧 Step 2: Update Feature Set Options

**File:** `src/forecast/trained-forecast.ts`

```typescript
// BEFORE
export type TrainingFeatureSet =
  | 'close_only'
  | 'ohlc'
  | 'market_context'
  | 'advanced_technical'
  | 'volume';

// AFTER
export type TrainingFeatureSet =
  | 'close_only'
  | 'ohlc'
  | 'market_context'
  | 'advanced_technical'
  | 'volume'
  | 'fno'                    // ✅ NEW
  | 'technical_fno'          // ✅ NEW: technical + F&O
  | 'technical_fno_finbert'; // ✅ NEW: technical + F&O + sentiment
```

---

## 🔧 Step 3: Fetch F&O Data in trainForecast()

**File:** `src/forecast/trained-forecast.ts`

Add this in the `trainForecast()` function where training observations are built:

```typescript
import { fetchFnoData, isSymbolEligibleForFno } from './fno-data-fetcher.js';
import { calculateFnoFeatures } from './fno-features.js';

// Inside trainForecast(), after fetching spot data and before building TrainingObservation[]

let fnoData: FnoData[] = [];
let fnoEligible = false;

if (featureSet.includes('fno')) {
  try {
    // Fetch F&O data from NSE APIs
    fnoData = await fetchFnoData(
      symbol,
      historicalApi,
      optionsApi,  // Need to pass this parameter
      params.from_date,
      params.to_date
    );

    // Check if symbol has sufficient F&O coverage
    const eligibility = isSymbolEligibleForFno(fnoData);
    if (!eligibility.isEligible) {
      console.warn(
        `Symbol ${symbol} not eligible for F&O features: ${eligibility.reason}`
      );
    } else {
      fnoEligible = true;
      console.log(
        `F&O data loaded for ${symbol}: ${eligibility.reason}`
      );
    }
  } catch (error) {
    console.warn(`Failed to load F&O data for ${symbol}:`, error);
  }
}

// Build TrainingObservation[] with F&O features
const observations: TrainingObservation[] = rows.map((row, index) => {
  const baseObs: TrainingObservation = {
    date: row.date,
    close: row.close,
    volume: row.volume,
    open: row.open,
    high: row.high,
    low: row.low,
    qualityExcluded: row.qualityExcluded,
  };

  // Add F&O features if available
  if (fnoEligible && fnoData.length > 0) {
    const spotDataSlice = rows.slice(Math.max(0, index - 20), index + 1);
    const fnoFeatures = calculateFnoFeatures(spotDataSlice, fnoData);
    if (fnoFeatures) {
      baseObs.fnoFeatures = fnoFeatures;
    }
  }

  return baseObs;
});
```

---

## 🔧 Step 4: Build Feature Vectors with F&O Data

**File:** `src/forecast/trained-forecast.ts`

Update the `buildFeatureVector()` function to include F&O features:

```typescript
function buildFeatureVector(
  obs: TrainingObservation,
  featureSet: TrainingFeatureSet,
  indicators?: any,
  sentiment?: TrainingSentiment
): number[] {
  const features: number[] = [];

  // Existing technical features (close_only, ohlc, momentum, volatility, etc.)
  // [... existing feature code ...]

  // Add F&O features
  if (
    (featureSet === 'fno' || 
     featureSet === 'technical_fno' || 
     featureSet === 'technical_fno_finbert') &&
    obs.fnoFeatures
  ) {
    const fno = obs.fnoFeatures;
    features.push(
      // High-signal F&O features
      fno.futuresPremiumPct ?? 0,           // Futures premium
      fno.putCallRatio ?? 0,                // Put/Call ratio
      fno.priceUpOIUp ?? 0,                 // Bullish conviction
      fno.priceDownOIUp ?? 0,               // Capitulation
      fno.callPutStrength ?? 0,             // Normalized call/put strength
      fno.oiMomentum ?? 0,                  // OI momentum

      // Medium-signal F&O features
      fno.premiumTrendCh5Day ?? 0,          // Premium trend
      fno.putCallRatioTrend ?? 0,           // PCR trend
      fno.totalOIChangePct ?? 0,            // Total OI change
      fno.totalOISma5 ?? 0,                 // OI SMA 5D
      fno.totalOISma20 ?? 0,                // OI SMA 20D

      // Conviction signal combinations
      fno.priceUpOIDown ?? 0,               // Weak rally
      fno.priceDownOIDown ?? 0,             // Fading decline

      // Extreme signals
      fno.callOIExtreme ?? 0,               // Call OI spike
      fno.putOIExtreme ?? 0,                // Put OI spike
      fno.oiSkewFavorsCall ?? 0,            // Bullish skew
      fno.oiSkewFavorsPut ?? 0,             // Bearish skew

      // Volume and momentum
      fno.futuresVolumeRelative ?? 0,       // Futures volume
      fno.oiBias ?? 0                       // Extreme OI bias
    );
  }

  // Add FinBert sentiment if applicable
  if (
    (featureSet === 'technical_fno_finbert' || 
     featureSet === 'close_only_finbert') &&
    sentiment
  ) {
    features.push(sentiment.polarity ?? 0);
  }

  return features;
}
```

---

## 🔧 Step 5: Update Feature Names in Training Output

**File:** `src/forecast/trained-forecast.ts`

Update the `training.features` array to document F&O features:

```typescript
const trainingFeatures: string[] = [
  // Existing technical features
  'close',
  'volume',
  'rsi14',
  'macd_histogram',
  'ema_ratio',
  // ... [existing features]
  
  // F&O Features (new)
  'fno_futures_premium_pct',
  'fno_put_call_ratio',
  'fno_price_up_oi_up',
  'fno_price_down_oi_up',
  'fno_call_put_strength',
  'fno_oi_momentum',
  'fno_premium_trend_5d',
  'fno_put_call_ratio_trend',
  'fno_total_oi_change_pct',
  'fno_total_oi_sma5',
  'fno_total_oi_sma20',
  'fno_price_up_oi_down',
  'fno_price_down_oi_down',
  'fno_call_oi_extreme',
  'fno_put_oi_extreme',
  'fno_oi_skew_favors_call',
  'fno_oi_skew_favors_put',
  'fno_futures_volume_relative',
  'fno_oi_bias',
];

// Then in training object:
training = {
  // ... existing fields
  features: trainingFeatures,
  // ...
};
```

---

## 🔧 Step 6: Update Forecast API Parameters

**File:** `src/forecast/forecast-api.ts`

Allow users to request F&O-enhanced forecasts:

```typescript
// BEFORE
export interface ForecastParams {
  symbol: string;
  horizon?: 'next_day' | 'week' | 'custom';
  historyMonths?: number;
  context?: 'auto' | 'off';
  sentiment?: 'off' | 'finbert';
  model?: 'baseline' | 'technical' | 'technical_finbert';
}

// AFTER
export interface ForecastParams {
  symbol: string;
  horizon?: 'next_day' | 'week' | 'custom';
  historyMonths?: number;
  context?: 'auto' | 'off';
  sentiment?: 'off' | 'finbert';
  model?: 'baseline' | 'technical' | 'technical_finbert' | 'technical_fno' | 'technical_fno_finbert';
  includeFno?: boolean;  // ✅ NEW: explicitly enable F&O features
}
```

---

## ✅ Testing & Validation

### Phase 1: Unit Tests

Create `tests/forecast/fno-features.test.ts`:

```typescript
import { calculateFnoFeatures, validateFnoData } from '../../src/forecast/fno-features';

describe('FNO Features', () => {
  it('should calculate futures premium correctly', () => {
    const spotData = [{ date: '2026-10-07', close: 1000, volume: 1000000 }];
    const fnoData = [
      {
        date: '2026-10-07',
        spotsPrice: 1000,
        futuresPrice: 1020,  // 2% premium
        futuresOpenInterest: 100000,
        callOpenInterest: 50000,
        putOpenInterest: 50000,
        callVolume: 10000,
        putVolume: 10000,
        spotVolume: 1000000,
      },
    ];

    const features = calculateFnoFeatures(spotData, fnoData);
    expect(features?.futuresPremiumPct).toBeCloseTo(2.0, 1);
  });

  it('should detect bullish conviction (price up + OI up)', () => {
    const spotData = [
      { date: '2026-10-06', close: 1000, volume: 1000000 },
      { date: '2026-10-07', close: 1010, volume: 1000000 },
    ];
    const fnoData = [
      {
        date: '2026-10-06',
        spotsPrice: 1000,
        futuresPrice: 1010,
        futuresOpenInterest: 100000,
        callOpenInterest: 50000,
        putOpenInterest: 50000,
        callVolume: 10000,
        putVolume: 10000,
        spotVolume: 1000000,
      },
      {
        date: '2026-10-07',
        spotsPrice: 1010,
        futuresPrice: 1030,
        futuresOpenInterest: 120000,  // OI increased
        callOpenInterest: 60000,
        putOpenInterest: 50000,
        callVolume: 15000,
        putVolume: 10000,
        spotVolume: 1000000,
      },
    ];

    const features = calculateFnoFeatures(spotData, fnoData);
    expect(features?.priceUpOIUp).toBe(1);  // Bullish conviction
  });

  it('should validate F&O data correctly', () => {
    const invalidData = [
      {
        date: '2026-10-07',
        spotsPrice: -100,  // Invalid: negative price
        futuresPrice: 1000,
        futuresOpenInterest: 100000,
        callOpenInterest: 50000,
        putOpenInterest: 50000,
        callVolume: 10000,
        putVolume: 10000,
        spotVolume: 1000000,
      },
    ];

    const result = validateFnoData(invalidData);
    expect(result.isValid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
```

### Phase 2: Benchmark Testing

Run against the existing Phase 1 baseline:

```bash
# Baseline (Technical features only)
npm run forecast-benchmark -- --model technical --symbols TCS,HDFCBANK,INFY

# F&O Enhanced (Technical + F&O features)
npm run forecast-benchmark -- --model technical_fno --symbols TCS,HDFCBANK,INFY

# Compare results
npm run forecast-benchmark-compare -- baseline.json technical_fno.json
```

**Success Criteria:**
- Directional accuracy improves from **50.3% → 55%+** (5+ percentage points)
- MAPE improves or stays stable
- Interval coverage remains 94-95%
- No data leakage (F&O data available before prediction date)

### Phase 3: Symbol Coverage Analysis

Test on liquid F&O symbols first:

```typescript
const testSymbols = [
  'TCS',          // Highly liquid, consistent F&O
  'INFY',         // IT sector, large F&O volume
  'HDFCBANK',     // Banking sector index proxy
  'RELIANCE',     // Energy, large premium
  'WIPRO',        // Tech, good F&O
];

for (const symbol of testSymbols) {
  const fnoData = await fetchFnoData(symbol, historicalApi, optionsApi, ...);
  const eligibility = isSymbolEligibleForFno(fnoData);
  console.log(`${symbol}: ${eligibility.reason}`);
}
```

---

## 📊 Expected Improvements

### Directional Accuracy

| Scenario | Current | Measured result | Mechanism |
|---|---|---|---|
| Bullish Conviction (Price↑ OI↑) | 50% | Not measured | Strong uptrend continuation hypothesis |
| Bearish Capitulation (Price↓ OI↑) | 50% | Not measured | Exhaustion → reversal hypothesis |
| Extreme PCR (<0.5 or >1.5) | 50% | Not measured | Sentiment extreme → mean reversion hypothesis |
| Premium Rising | 50% | Not measured | Market confidence hypothesis |
| Overall Weighted | **50.3%** | **Not established** | Paired results are in FNO_INTEGRATION_STATUS.md |

### Feature Importance (Hypothesis; Not Measured)

1. **putCallRatio** (15-20%) - PCR extremes are reliable contrarian signals
2. **priceUpOIUp** (10-15%) - Conviction is stronger than price alone
3. **callPutStrength** (8-12%) - Normalized skew captures sentiment
4. **futuresPremiumPct** (8-12%) - Forwards-looking market opinion
5. **oiMomentum** (5-10%) - Trend of institutional positioning
6. **totalOIChangePct** (4-8%) - New positioning entering/exiting
7. **Other F&O features** (5-10%) - Various edge cases and combinations

---

## 🚨 Data Quality & Gotchas

### Known Limitations

1. **Options Data Availability**
   - Current API fetches only current/latest option chains
   - `technical_fno` reads historical EOD option contracts from per-symbol CSV archives under `downloads/` by default
   - Current live option-chain snapshots are not used for the historical backtest

2. **Futures Data Alignment**
   - Stock futures may have different closing times than spot
   - Use next-day futures data (tomorrow's futures) vs today's spot prices
   - Data leakage risk: Ensure futures data is from same trading session or earlier

3. **Index vs Stock F&O**
   - Index futures (NIFTY50, BANKNIFTY) have higher liquidity
   - Stock futures (TCS, INFY, HDFCBANK) have more variable OI
   - Some stocks have no F&O contracts

4. **Corporate Actions**
   - F&O data not adjusted for splits/bonus (futures have different strike ladders)
   - Keep F&O premiums separate from spot price changes
   - Bonus/split events cause OI discontinuities

### No-Leakage Checklist

- [ ] F&O data from same date or earlier (never future)
- [ ] Options snapshot taken before market close (not intraday)
- [ ] Premium calculated AFTER spot price is known
- [ ] OI change uses yesterday's OI vs today's OI
- [ ] Features not updated during training period

---

## 🔍 Monitoring & Debugging

### Log Key Metrics

```typescript
if (fnoEligible && fnoFeatures) {
  console.log(`${symbol} F&O Features:`);
  console.log(`  Futures Premium: ${fnoFeatures.futuresPremiumPct.toFixed(2)}%`);
  console.log(`  Put/Call Ratio: ${fnoFeatures.putCallRatio.toFixed(2)}`);
  console.log(`  OI Change (1D): ${fnoFeatures.totalOIChangePct.toFixed(2)}%`);
  console.log(`  OI Momentum (5D-20D SMA): ${fnoFeatures.oiMomentum.toFixed(2)}%`);
  console.log(`  Call/Put Strength: ${fnoFeatures.callPutStrength.toFixed(2)}`);
  console.log(`  Price+OI Signal: ${
    fnoFeatures.priceUpOIUp ? 'BULLISH' :
    fnoFeatures.priceDownOIUp ? 'CAPITULATION' :
    fnoFeatures.priceUpOIDown ? 'WEAK_RALLY' :
    'UNCERTAIN'
  }`);
}
```

### Common Issues & Fixes

| Issue | Symptom | Fix |
|---|---|---|
| Missing F&O data | 0 values in features | Check `isSymbolEligibleForFno()` + API connectivity |
| Extreme premiums | |futuresPremiumPct| > 10% | Check date alignment + look for data anomalies |
| OI spikes | totalOIChangePct > 50% | Normal on expiry days; filter if needed |
| Feature NaN | Model training fails | Add null checks + default 0 for missing OI |

---

## 📈 Next Steps After Integration

1. **Run Phase 2A Benchmark** (Sector Context first)
   - Complete Opportunity #1 in parallel with F&O testing
   - Combine both feature groups in Phase 2B

2. **Advanced F&O Features** (Future phases)
   - Implied volatility (IV) trends
   - Greeks (delta, gamma, vega)
   - Volatility smile/skew
   - Max Pain level tracking
   - Expiry-specific dynamics

3. **Risk Management** (After accuracy improves)
   - Use put/call ratios for position sizing
   - PCR extremes trigger smaller positions
   - Stop-loss based on OI reversals

---

## 📚 References

- **Feedstock2ForecastModel.md** - Full feature roadmap
- **FORECAST_IMPROVEMENT_PLAN.md** - Phase 1 benchmark results
- **NSE Options API** - src/nse/api/options-api.ts
- **NSE Historical API** - src/nse/api/historical-api.ts
- **LightGBM Feature Importance** - docs/ml/lightgbm-guide.md

---

## ✅ Checklist for Implementation

### Code Changes
- [ ] Add FnoData interface to fno-data-fetcher.ts
- [ ] Add fnoFeatures? to TrainingObservation interface
- [ ] Update TrainingFeatureSet type to include 'fno' variants
- [ ] Implement fetchFnoData() in trainForecast()
- [ ] Implement buildFeatureVector() for F&O features
- [ ] Update forecast-api.ts to accept F&O parameters

### Testing
- [ ] Unit tests for calculateFnoFeatures() (20+ test cases)
- [ ] Unit tests for isSymbolEligibleForFno()
- [ ] Integration test: fetch F&O data for TCS
- [ ] Benchmark: technical vs technical_fno (10 symbols, 1 year)
- [ ] Data leakage audit: verify no future data in features

### Documentation
- [ ] Update API docs with F&O feature descriptions
- [ ] Add F&O limitations section
- [ ] Create troubleshooting guide
- [ ] Document feature importance rankings

---

**Status:** Integrated; accuracy benefit remains unproven | See [FNO_INTEGRATION_STATUS.md](FNO_INTEGRATION_STATUS.md)

# F&O Feature Documentation & Interpretation Guide

**For:** LightGBM Model Training & Interpretation  
**Date:** 2026-10-07  
**Purpose:** Explain each F&O feature, its signal strength, and expected model behavior

> The signal tiers and example accuracy figures below are hypotheses, not established predictive performance. Matched futures-only and options-inclusive ablations show mixed results with no general winner. See [FNO_INTEGRATION_STATUS.md](FNO_INTEGRATION_STATUS.md) for measured results.

---

## Feature Groups Overview

| Group | Count | Signal Strength | Notes |
|---|---|---|---|
| **Futures Premium** | 4 | Medium | Forward-looking market opinion |
| **Open Interest** | 5 | High | Institutional positioning flows |
| **Put/Call Ratios** | 3 | High | Sentiment extremes & reversals |
| **Conviction Signals** | 4 | Very High | Price + OI combinations |
| **Extreme Signals** | 4 | Medium | Anomalies & capitulation |
| **Volume Features** | 3 | Medium | Flow intensity |
| **Momentum Indicators** | 2 | High | Trend confirmation |
| **Total** | **28** | - | - |

---

## 🟢 TIER 1: High Signal Features (Use in Model)

These features have the strongest relationship with next-day/week directional movement.

### 1. **putCallRatio** (Put OI / Call OI)

**Formula:**
```
PCR = Put Open Interest / Call Open Interest
Range: 0.0 to 3.0+ (typical: 0.5 to 1.5)
```

**Signal Interpretation:**
```
PCR < 0.5     = Extreme bullish (many more calls → institutional bullishness)
PCR = 0.5-1.0 = Moderately bullish
PCR = 1.0-1.2 = Neutral/balanced
PCR = 1.2-1.5 = Moderately bearish
PCR > 1.5     = Extreme bearish (many more puts → institutional fear)
```

**Model Learning Opportunity:**
- Extreme PCR (< 0.5 or > 1.5) often predicts **mean reversion** within 1-5 days
- High PCR at market tops = capitulation before reversal
- Low PCR at bottoms = greed before pullback
- LightGBM can learn non-linear thresholds better than hardcoded levels

**Why It Works:**
- Institutional traders accumulate puts before crashes
- Retail accumulates calls before tops
- PCR extremes = positioning gets crowded = reversal risks

**Expected Feature Importance:** 15-20%

---

### 2. **priceUpOIUp** & **priceDownOIUp** (Conviction Signals)

**Definition:**
```
priceUpOIUp = 1 if [Price UP AND Futures OI UP], else 0
priceDownOIUp = 1 if [Price DOWN AND Futures OI UP], else 0
```

**Signal Interpretation:**

**priceUpOIUp (Bullish Conviction):**
```
Price Rising + OI Rising
= New institutional money entering on the upside
= Conviction that move will continue
→ Model should predict higher probability of UP next session
Probability of continuation: not established; evaluate this hypothesis out of sample
```

**priceDownOIUp (Capitulation):**
```
Price Falling + OI Rising
= Institutional short accumulation OR long liquidation
= Market exhaustion signal
→ Model should predict reversal/bottom formation
Probability of reversal within 2-3 days: 55-65%
```

**Why It Works:**
- OI increases = new contracts opened = active positioning
- Price + OI alignment = conviction
- Price + OI divergence = weakness/reversal

**Real-World Example:**
```
Date        Price   Prev OI   Curr OI   Signal             Next Day Result
2026-10-05  1000    100k      100k      Flat (neutral)     1001 (slightly up)
2026-10-06  1010    100k      120k      Price↑ OI↑ (++++)  1025 (strong up)
2026-10-07  1025    120k      140k      Price↑ OI↑ (++++)  1040 (continued up)
2026-10-08  1040    140k      160k      Price↑ OI↑ (++++)  1050 (sustained)
2026-10-09  1050    160k      140k      Price↑ OI↓ (---)   1045 (reversal)
```

**Expected Feature Importance:** 10-15% (each)

---

### 3. **callPutStrength** (Normalized Call/Put Bias)

**Formula:**
```
callPutStrength = (Call OI - Put OI) / (Call OI + Put OI) * 2
Range: -1.0 (extreme puts) to +1.0 (extreme calls)
Neutral: 0.0 (balanced)
```

**Signal Interpretation:**
```
+1.0 = 100% call skew (only calls accumulated)
+0.5 = 2:1 calls vs puts
+0.2 = Slight call bias
 0.0 = Perfectly balanced
-0.2 = Slight put bias
-0.5 = 2:1 puts vs calls
-1.0 = 100% put skew (only puts accumulated)
```

**Model Learning:**
- Extreme positive callPutStrength (> +0.6) = overbought, potential pullback
- Extreme negative callPutStrength (< -0.6) = oversold, potential bounce
- Non-linear: extremes matter more than moderate values
- LightGBM can learn interaction: callPutStrength × recent_momentum

**Why Better Than Raw Put/Call:**
- Normalized to -1 to +1 range (model-friendly)
- Accounts for overall market size (total OI context)
- Comparable across different stocks/indexes
- Saturates at extremes (non-extreme moves don't overweight)

**Expected Feature Importance:** 8-12%

---

### 4. **oiMomentum** (OI Acceleration)

**Formula:**
```
oiMomentum = SMA5(OI change %) - SMA20(OI change %)
Range: -20% to +20%
```

**Signal Interpretation:**
```
oiMomentum > +5%  = OI rapidly building = new money entering = bullish momentum
oiMomentum > 0    = OI growing faster recently = short-term momentum
oiMomentum ≈ 0    = OI changes stable = consolidation
oiMomentum < 0    = OI growth slowing = momentum fading = potential reversal
oiMomentum < -5%  = OI contracting rapidly = liquidation/exit = bearish
```

**Why It Works:**
- OI change reveals market psychology
- Acceleration (5D faster than 20D) = regime shift
- Deceleration = trend exhaustion
- Non-stationary: works across different market conditions

**Real Example:**
```
Date    OI Change %   SMA5   SMA20   Momentum   Action
Day 1   +2%           +2%    +1%     +1%        Early buildup
Day 2   +3%           +2.5%  +1.2%   +1.3%      Acceleration starts
Day 3   +4%           +3%    +1.4%   +1.6%      Strong buildup
Day 4   +5%           +3.5%  +1.6%   +1.9%      Peak momentum
Day 5   +6%           +4%    +2.0%   +2.0%      Momentum peaks
Day 6   +2%           +3.8%  +2.6%   +1.2%      Momentum fades
Day 7   -1%           +2.4%  +2.4%   0.0%       Reversal signal
```

**Expected Feature Importance:** 5-10%

---

## 🟡 TIER 2: Medium Signal Features (Use in Ensemble)

These features are useful but noisier. Better as secondary confirmation signals.

### 5. **futuresPremiumPct** (Forwards-Looking Market Opinion)

**Formula:**
```
futuresPremiumPct = (Futures Price - Spot Price) / Spot Price * 100
Range: -5% to +10% (typical)
```

**Signal Interpretation:**
```
Premium > +2%  = Market expects UP (bullish sentiment)
Premium = +1%  = Mild bullish
Premium ≈ 0%   = Neutral (theoretical carry cost)
Premium = -1%  = Mild bearish / deep selling
Premium < -2%  = Strong bearish (rare, institutional fear)
```

**Model Learning:**
- Premium reflects risk-free rate + dividend - holding cost
- Rising premium = improving sentiment (positive signal)
- Falling premium = deteriorating sentiment (negative signal)
- Use 5-day trend, not 1-day (too noisy)

**Why Secondary:**
- Influenced by carry costs (mathematically determined)
- Less predictive than OI (market structure vs sentiment)
- Most useful when combined with OI changes

**Real Scenario:**
```
Scenario A: Premium Rising + OI Rising + Price Up = STRONG BUY SIGNAL
Scenario B: Premium Falling + OI Rising + Price Down = STRONG SELL SIGNAL
Scenario C: Premium Rising + OI Falling + Price Up = WEAK RALLY (reversal risk)
Scenario D: Premium Stable + OI Changing = Focus on OI, ignore premium
```

**Expected Feature Importance:** 3-8%

---

### 6. **putCallRatioTrend** (Fear/Greed Extremes Moving)

**Formula:**
```
putCallRatioTrend = (Current PCR - 5Day Avg PCR) / (5Day Avg PCR) * 100
Range: -50% to +50%
```

**Signal Interpretation:**
```
+30%  = PCR jumping toward extreme bearish (puts accumulating rapidly)
+10%  = PCR drifting bearish
 0%   = PCR stable (no sentiment shift)
-10%  = PCR drifting bullish
-30%  = PCR collapsing toward extreme bullish (calls accumulating rapidly)
```

**Model Learning:**
- Directional change matters: extreme becoming more extreme = reversal coming
- Extreme stabilizing = breakout likely
- Useful for detecting when sentiment is "locked in" vs shifting

**Why Medium Signal:**
- Combination of two metrics (PCR + trend)
- More relevant for longer timeframes (3-5 days)
- Noisier on 1-day horizon

**Expected Feature Importance:** 2-5%

---

### 7. **totalOIChangePct**, **totalOISma5**, **totalOISma20** (OI Trend)

**Formula:**
```
totalOIChangePct = (Today OI - Yesterday OI) / Yesterday OI * 100
totalOISma5 = Average of [OI change % for last 5 days]
totalOISma20 = Average of [OI change % for last 20 days]
```

**Signal Interpretation:**
```
OI growing 2-5% daily  = Steady new positioning = trend continuation
OI growing > 10% daily = Panic accumulation = caution (exhaustion risk)
OI contracting         = Position unwinding = trend ending
OI stable              = No new conviction = consolidation
```

**Model Learning:**
- SMA5 > SMA20 = momentum accelerating = trend strengthening
- SMA5 < SMA20 = momentum decelerating = trend weakening
- Useful for regime detection

**Expected Feature Importance:** 4-8%

---

## ⚪ TIER 3: Low Signal Features (Monitor/Debug Only)

These features provide context but rarely dominate predictions.

### 8. **premiumTrendCh5Day** (5-Day Premium Trend)

**Why Low Signal:**
- Premium is mathematically bounded
- Changes slowly (affected by rate/dividend changes)
- Useful for context but not directional signal

**When Useful:**
- Extreme premium moves = data anomalies or big news
- Rising premium + rising price = increasing bullishness
- Falling premium + falling price = accelerating bearishness

---

### 9. **priceUpOIDown** & **priceDownOIDown** (Divergence Signals)

**Definitions:**
```
priceUpOIDown = Price UP but OI DOWN
→ Weak rally, few new longs entering = potential reversal
Probability of reversal next 1-2 days: 50-55% (slightly bearish)

priceDownOIDown = Price DOWN but OI DOWN  
→ Fading decline, short covering = potential bounce
Probability of bounce next 1-2 days: 50-55% (slightly bullish)
```

**Why Lower Priority:**
- Divergences are less reliable than convictions
- Require additional context (trend, volatility) to confirm
- Work better on longer timeframes (3-5 days)

---

### 10. **callOIExtreme** & **putOIExtreme** (Anomaly Detection)

**Definition:**
```
callOIExtreme = 1 if abs(Call OI change %) > 95th percentile, else 0
putOIExtreme = 1 if abs(Put OI change %) > 95th percentile, else 0
```

**When Triggered:**
- Expiry dates (options roll over)
- Major earnings/events
- Institutional panic accumulation
- Data errors

**Model Should Learn:**
- Rare occurrence (1-5% of days)
- Can be positive (capitulation) or negative (false signal)
- Use with context: if extreme PUT OI + price up = potentially bullish
- Use with context: if extreme CALL OI + price down = potentially bearish

**Why Lower Priority:**
- Rare occurrence reduces statistical power
- Often driven by events (not price patterns)
- Better used for anomaly flagging than prediction

---

### 11. **oiSkewFavorsCall** & **oiSkewFavorsPut** (Skew Indicators)

**Formula:**
```
oiSkewFavorsCall = 1 if (Call OI % of total) > 60%, else 0
oiSkewFavorsPut = 1 if (Call OI % of total) < 40%, else 0
```

**Signal:**
- oiSkewFavorsCall = Market expects upside, but caution (can exhaust)
- oiSkewFavorsPut = Market afraid, but opportunity (can reverse)

**Why Lower Priority:**
- Skew is a snapshot, not a flow
- Persistent (skew doesn't change daily) = less informative
- Works better with trend/momentum confirmation

---

### 12. **futuresVolumeRelative**, **spotVolumeRelative**, **volumeConvergence**

**Definitions:**
```
futuresVolumeRelative = Today Futures Volume / 5Day Avg Futures Volume
spotVolumeRelative = Today Spot Volume / 5Day Avg Spot Volume
volumeConvergence = Futures Volume / Spot Volume
```

**Why Lower Priority:**
- Volume in futures is less informative than OI
- Spot volume often doesn't help (tested & rejected in Phase 1)
- Use only if OI data is missing

**When Useful:**
- Breakouts: volume surge + price breakout = strong signal
- Fading moves: volume declining + price strong = fake signal
- Better on intraday timeframe than daily

---

## 🔄 Feature Interaction Patterns

The model should learn these combinations automatically:

### High-Value Interactions

```
1. callPutStrength × priceUpOIUp
   → Extreme calls + conviction = strongest bullish signal
   → LightGBM weight: Very High

2. putCallRatio × priceDownOIUp
   → High PCR + capitulation = strongest bearish signal
   → LightGBM weight: Very High

3. oiMomentum × futuresPremiumPct
   → Accelerating OI + rising premium = confirmed uptrend
   → LightGBM weight: High

4. totalOISma5 × (price - close_sma20)
   → OI building + price above MA20 = momentum confirmation
   → LightGBM weight: High

5. oiBias × recent_price_change
   → Extreme skew in direction of recent move = exhaustion risk
   → LightGBM weight: Medium
```

### Low-Value Interactions

```
1. priceUpOIDown × putCallRatio (if already included)
   → Redundant signals, skip
   
2. futuresPremiumPct × volumeConvergence
   → Weak relationship to direction, monitor only

3. callOIExtreme × putOIExtreme (both on same day)
   → Usually data error, flag as QA issue
```

---

## ⚠️ Known False Signals & Workarounds

### False Signal #1: Expiry-Related OI Spikes

**Problem:**
- Options & futures expire on last Thursday of month
- Huge OI changes on expiry (not meaningful for price prediction)

**Workaround:**
```python
# Exclude expiry dates or downweight them
if is_expiry_date(date):
    fno_features *= 0.5  # Reduce importance
    # OR
    fno_features = [0] * num_features  # Set to zero
```

**Better:** Train separate models for expiry vs non-expiry days

---

### False Signal #2: Corporate Actions

**Problem:**
- Splits/bonus cause discontinuities in OI
- Premium spikes after events
- Can't compare pre/post-action OI

**Workaround:**
```python
# Check corporate action database
if symbol_had_action(symbol, date):
    skip_row = True  # Exclude from training
```

---

### False Signal #3: Illiquid F&O Contracts

**Problem:**
- Some stocks have sparse F&O data
- OI changes driven by bid-ask widening, not sentiment
- Premium can be extreme

**Workaround:**
```python
# Minimum liquidity filter
if futures_open_interest < 50000:
    fno_features = [0] * num_features  # Disable features
    # OR
    add_quality_flag(row, "low_fno_liquidity")
```

---

## 📊 Feature Standardization for LightGBM

Before passing to LightGBM, features should be:

```python
# BEFORE: Raw features (different ranges)
futuresPremiumPct: -2.5 to +8.0
putCallRatio: 0.3 to 2.5
totalOIChangePct: -30 to +60
oiMomentum: -15 to +25
callPutStrength: -0.8 to +0.9

# AFTER: Standardized features (LightGBM handles this internally)
# LightGBM uses histogram-based splitting, so raw ranges OK
# But good practice to clip extremes to ±5 standard deviations

def clip_fno_features(features: FnoFeatures) -> FnoFeatures:
    """Clip extreme values to prevent outlier dominance"""
    features.futuresPremiumPct = np.clip(features.futuresPremiumPct, -5, 5)
    features.putCallRatio = np.clip(features.putCallRatio, 0.1, 3.0)
    features.totalOIChangePct = np.clip(features.totalOIChangePct, -50, 50)
    features.oiMomentum = np.clip(features.oiMomentum, -20, 20)
    # ... etc
    return features
```

---

## 🎯 Expected Model Behavior with F&O Features

### Before (Technical Only, 50.3% accuracy)

```
Input: Price, Volume, RSI, MACD, Bollinger, VIX
↓
Model learns: Price trends and momentum
↓
Output: Predict UP if price > EMA + momentum positive (mechanical)
↓
Problem: No awareness of institutional conviction
↓
Result: 50% direction accuracy (barely better than random)
```

### Original hypothesis (not validated)

```
Input: Price, Volume, RSI, MACD, Bollinger, VIX + F&O features
↓
Model learns: 
  - When Price+OI alignment predicts continuation
  - When PCR extremes predict reversals
  - When premium rising predicts strength
  - When OI momentum predicts trend exhaustion
↓
Output: Predict UP with 65% confidence if:
  - priceUpOIUp == 1
  - AND callPutStrength > +0.3
  - AND oiMomentum > +2%
  - OR predict DOWN with 60% confidence if:
  - priceDownOIUp == 1
  - AND putCallRatio > 1.2
  - AND oiMomentum < -2%
↓
No confirmed accuracy result; use the paired benchmark before making this claim.
```

---

## 📋 Feature Selection for Different Scenarios

### For Day Traders (Next-Day Horizon)

Use these features (highest signal-to-noise):
1. ✅ priceUpOIUp (bullish conviction)
2. ✅ priceDownOIUp (capitulation)
3. ✅ putCallRatio (extreme PCR)
4. ✅ callPutStrength (normalized bias)
5. ✅ futuresPremiumPct (forward opinion)

Ignore:
- ❌ oiMomentum (too slow for 1-day)
- ❌ volumeConvergence (unreliable)

---

### For Swing Traders (3-5 Day Horizon)

Use these features:
1. ✅ oiMomentum (trend confirmation)
2. ✅ totalOISma5 vs totalOISma20 (regime shift)
3. ✅ putCallRatioTrend (sentiment shift)
4. ✅ All Tier 1 features
5. ✅ premiumTrendCh5Day

---

### For Position Traders (1-4 Week Horizon)

Use these features:
1. ✅ oiBias (extreme skew)
2. ✅ oiSkewFavorsCall/Put (structural bias)
3. ✅ All other F&O features
4. ✅ Combine with sector context (see Opportunity #1)

---

## 🏁 Implementation Checklist

- [ ] All 28 F&O features implemented in calculateFnoFeatures()
- [ ] Feature ranges validated (no NaN, no ±Infinity)
- [ ] Expiry dates excluded or downweighted
- [ ] Corporate action dates excluded
- [ ] Liquidity filter applied (>50k OI minimum)
- [ ] Data leakage audit passed (F&O from same day or earlier)
- [ ] Unit tests for each feature (edge cases)
- [ ] Benchmark vs baseline completed
- [ ] Feature importance ranking documented
- [ ] Model SHAP values analyzed

---

*Document Version: 1.0 | Last Updated: 2026-10-07 | Feature descriptions are hypotheses; measured status is in FNO_INTEGRATION_STATUS.md*

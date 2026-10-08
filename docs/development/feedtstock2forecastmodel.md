# Feed Stock 2 Forecast Model

## 1. Purpose

Build a stock forecasting model that uses price action, candle data,
volume, trend, volatility, market context, sector behaviour, VWAP,
momentum, and---where available---F&O data.

The goal is **not** to predict an exact future stock price. The
preferred targets are:

-   Direction: Will the stock move UP or DOWN?
-   Expected return: Expected return over the next 1, 3, or 5 trading
    days.
-   Probability: Probability that the stock will gain more than a chosen
    threshold, such as +1%.
-   Risk: Probability of a meaningful decline, such as -1%.

------------------------------------------------------------------------

## Current Workspace Status (2026-10-08)

The numbered, feature-by-feature implementation state, broker-readiness
assessment, report-field status, and prioritized next steps are maintained in
the separate [Forecast Model Roadmap Status](./FORECAST_MODEL_ROADMAP_STATUS.md).
That file distinguishes active model features from experiments that were
tested but not adopted.

This proposal is a research roadmap, not an instruction to add every listed
indicator. The current project has already implemented or benchmark-tested
several items:

| Proposal item | Workspace status |
| --- | --- |
| LightGBM and chronological walk-forward evaluation | Implemented; corrected 60-month benchmark uses 14-month training, 3-month test windows, with 6-month advances. A 3-month-advance diagnostic also exists. |
| OHLC candle structure | Five causal daily candle features were tested against close-only on matched out-of-sample rows; they were not adopted. |
| Trend/momentum/volatility features | Close-only model already uses returns, SMA/EMA ratios, RSI, MACD, Bollinger features and volatility. A separate advanced close-only feature group was tested and rejected. |
| Volume and relative volume | Volume history was audited and a causal relative-volume feature was tested; neither established a useful gain, so production features remain unchanged. |
| Market context | A four-feature NIFTYBEES proxy candidate was tested and rejected. It is not equivalent to full NIFTY 50 or sector-index coverage. |
| Training-window length | The controlled 8/14/20-month comparison is complete. Twenty months reduced MAPE versus 14 months, but did not improve direction and still trailed the no-change baseline; production remains at 14 months. |
| Corporate actions and data quality | Split/bonus adjustment, flagged reversal-candle exclusions, and data-quality reporting are implemented. Dividends and event impacts are not comprehensively modeled. |
| Return forecast, direction and uncertainty range | Expected price changes, direction, residual-calibrated intervals and a conservative directional gate exist. These are not calibrated probabilities of threshold outcomes. |
| Probability and risk targets | The historical threshold-probability classifier was benchmarked and not adopted as a general model. Benchmark-only prospective probability tracking is collecting data; calibrated production probabilities and risk targets are not implemented. |
| Human-readable forecast output | An initial `npm run forecast:report -- SYMBOL` report uses the existing 1- and 3-session return forecasts and backtest diagnostics. Threshold probabilities, confidence scores, volume/sector signals, and similar-setup statistics are explicitly withheld until validated. |
| VWAP and time-of-day features | Not available in the validated daily-bar pipeline; true intraday bars are required. |
| Sector context and relative strength | Not yet benchmarked with matched sector-index data. A feasibility probe found uneven history among sector ETF proxies; any test must report its proxy mapping and coverage. |
| F&O/open interest | Historical comparisons and feature ablations were run; no general improvement was established and no F&O feature was adopted in production. |
| XGBoost, Random Forest, CatBoost | Not benchmarked in this forecasting pipeline. |
| Trading rules, backtesting and orders | Explicitly out of scope until forecast evidence improves; Kite remains in HOLD. |

The rejected feature experiments are not evidence that those data sources can
never help. They mean only that the tested implementations did not improve on
the matched no-change baseline. Continue one predeclared, point-in-time
experiment at a time; do not add indicators merely to increase feature count.

The probability-target work includes an outcome-rate audit, a historical
classifier benchmark that was not adopted, and a separate prospective
benchmark-only tracker. Continue the daily score-then-capture sequence; do not
treat early or immature scorecards as evidence of model improvement.

------------------------------------------------------------------------

# 2. Core Principle

Do not assume:

> More indicators = better prediction.

Many technical indicators are derived from the same price data and
therefore contain overlapping information.

The model should focus on a relatively small number of meaningful
feature groups and learn the relationships between them.

Recommended first model:

-   **LightGBM** --- primary model
-   **XGBoost** --- comparison model
-   **Random Forest** --- baseline model
-   **CatBoost** --- optional later experiment

Use **walk-forward / time-series validation**, not random train/test
splitting, to avoid future-data leakage.

------------------------------------------------------------------------

# 3. Feature Group 1 --- Raw Candle Data

For every candle, store:

-   Open
-   High
-   Low
-   Close
-   Volume

Create additional candle-structure features:

-   Candle body
-   Upper wick
-   Lower wick
-   High - Low
-   Close - Open
-   Candle body percentage
-   Candle range percentage
-   Upper wick percentage
-   Lower wick percentage
-   Close position within candle
-   Gap from previous close

### Example

For:

-   Open = 100
-   High = 110
-   Low = 99
-   Close = 109

The candle has strong upward price action.

Compare this with:

-   Open = 100
-   High = 110
-   Low = 99
-   Close = 100

The range is the same, but the buying/selling behaviour is very
different.

------------------------------------------------------------------------

# 4. Feature Group 2 --- Historical Price Behaviour

Do not provide only the current price.

Calculate historical returns:

-   1-day return
-   2-day return
-   3-day return
-   5-day return
-   10-day return
-   20-day return

Calculate historical price ranges:

-   5-day high
-   5-day low
-   10-day high
-   10-day low
-   20-day high
-   20-day low
-   50-day high
-   50-day low
-   52-week high
-   52-week low

Calculate distance from important moving averages:

-   Distance from EMA20
-   Distance from EMA50
-   Distance from EMA200

The model should understand where the current price sits within its
recent historical range.

------------------------------------------------------------------------

# 5. Feature Group 3 --- Trend

Use:

-   EMA9
-   EMA20
-   EMA50
-   EMA100
-   EMA200

However, do not rely only on the raw EMA values.

Create relationships:

-   Price \> EMA20
-   EMA20 \> EMA50
-   EMA50 \> EMA200
-   Price / EMA20
-   Price / EMA50
-   Price / EMA200

Create trend/slope features:

-   EMA20 slope
-   EMA50 slope
-   EMA200 slope

Example of a strong trend structure:

-   Price \> EMA20
-   EMA20 \> EMA50
-   EMA50 \> EMA200
-   EMA20 rising
-   EMA50 rising

------------------------------------------------------------------------

# 6. Feature Group 4 --- Volume

Volume should be treated as an important input.

Do not use only absolute volume.

Create:

-   Volume
-   Volume change %
-   5-day average volume
-   20-day average volume
-   50-day average volume
-   Volume / 20-day average volume
-   Volume / 50-day average volume
-   Relative volume

Example:

-   Today's volume = 8 million
-   20-day average = 3 million
-   Relative volume = 2.67

A price breakout accompanied by high relative volume can be materially
different from a breakout on weak volume.

------------------------------------------------------------------------

# 7. Feature Group 5 --- Momentum

Use a limited set of momentum indicators.

## RSI

Include:

-   RSI14
-   RSI change
-   RSI relative to 50
-   RSI short-term value
-   RSI trend
-   Potential RSI divergence features

Do not hard-code:

-   RSI \> 70 = SELL
-   RSI \< 30 = BUY

Allow the model to learn the historical relationship.

## MACD

Include:

-   MACD
-   Signal
-   MACD histogram
-   Histogram change

Optional:

-   Rate of change / ROC

------------------------------------------------------------------------

# 8. Feature Group 6 --- Volatility

Volatility is very important for forecasting and risk management.

Use:

## ATR

-   ATR14
-   ATR percentage
-   ATR / price
-   ATR change

Example:

-   ATR = ₹25
-   Stock price = ₹1,000
-   ATR% = 2.5%

Also consider:

-   5-day historical volatility
-   10-day historical volatility
-   20-day historical volatility
-   Bollinger Band width
-   Volatility change

ATR helps normalize price movement across stocks with different prices
and volatility characteristics.

------------------------------------------------------------------------

# 9. Feature Group 7 --- VWAP

VWAP is especially important for intraday forecasting.

Use:

-   VWAP
-   Price - VWAP
-   Price / VWAP
-   Distance from VWAP %
-   VWAP slope
-   Price above/below VWAP

Example:

-   Price = ₹1,025
-   VWAP = ₹1,000
-   Distance = +2.5%

VWAP should be used as market context rather than as a standalone
BUY/SELL signal.

------------------------------------------------------------------------

# 10. Feature Group 8 --- Support and Resistance

Convert support/resistance into numerical features.

Use:

-   Distance to previous-day high
-   Distance to previous-day low
-   Distance to previous-week high
-   Distance to previous-week low
-   Distance to 20-day high
-   Distance to 20-day low
-   Distance to 50-day high
-   Distance to 50-day low
-   Distance to recent swing high
-   Distance to recent swing low

Example:

-   Current price = ₹1,000
-   Previous-day high = ₹1,010
-   Distance = approximately -0.99%

This tells the model that the stock is close to a recent resistance
level.

------------------------------------------------------------------------

# 11. Feature Group 9 --- Gap Analysis

Include:

-   Today's open vs yesterday close
-   Today's open vs yesterday high
-   Today's open vs yesterday low
-   Gap percentage
-   Gap direction

Example:

-   Yesterday close = ₹1,000
-   Today open = ₹1,030
-   Gap = +3%

The model can learn whether different types of gaps tend to continue or
reverse under different market conditions.

------------------------------------------------------------------------

# 12. Feature Group 10 --- Market Context

Do not forecast an individual stock in isolation.

For NSE stocks, include market-level features such as:

-   NIFTY 50 return 1D
-   NIFTY 50 return 3D
-   NIFTY 50 return 5D
-   NIFTY 50 volatility
-   NIFTY 50 RSI
-   NIFTY 50 distance from EMA20
-   NIFTY 50 volume
-   NIFTY trend direction

The stock's behaviour is influenced by the broader market.

Example:

### HDFCBANK

Use:

-   HDFCBANK features
-   NIFTY 50 features
-   NIFTY BANK features
-   Banking-sector features

### TCS

Use:

-   TCS features
-   NIFTY 50 features
-   NIFTY IT features

This is generally more useful than simply adding many extra technical
indicators to the stock itself.

------------------------------------------------------------------------

# 13. Feature Group 11 --- Sector Context

For each stock, identify its relevant sector/index.

Include:

-   Sector 1D return
-   Sector 3D return
-   Sector 5D return
-   Sector momentum
-   Sector volatility
-   Sector trend
-   Stock return relative to sector
-   Stock relative strength

The model should understand whether a stock is:

-   Strong while its sector is strong
-   Strong while its sector is weak
-   Weak while its sector is strong
-   Weak while its sector is weak

------------------------------------------------------------------------

# 14. Feature Group 12 --- Time Features

For intraday forecasting, include:

-   Time since market open
-   Hour
-   Minute
-   Day of week
-   Minutes remaining until market close
-   Opening session flag
-   Midday session flag
-   Closing session flag

For NSE, useful broad sessions are:

-   09:15--10:00
-   10:00--12:00
-   12:00--14:00
-   14:00--15:30

Market behaviour can differ significantly between the opening, middle,
and closing periods.

------------------------------------------------------------------------

# 15. Feature Group 13 --- F&O Data

For stocks with derivatives data, add F&O features.

Potential inputs:

-   Futures price
-   Futures premium/discount
-   Futures return
-   Futures volume
-   Futures open interest
-   Open-interest change %
-   Call open interest
-   Put open interest
-   Call OI change
-   Put OI change
-   Put/Call ratio
-   Price change + OI change relationship

Important combinations to let the model learn include:

-   Price rising + OI rising
-   Price rising + OI falling
-   Price falling + OI rising
-   Price falling + OI falling

Do not hard-code these combinations as automatic BUY/SELL rules. Let the
model learn the historical outcome.

------------------------------------------------------------------------

# 16. Feature Group 14 --- Corporate and Event Information

Eventually include:

-   Earnings/results date
-   Dividend
-   Bonus
-   Stock split
-   Corporate actions
-   Major company events
-   Major market/news events

Do not make this the first priority.

First build a strong model using price, volume, market, sector, trend,
momentum and volatility data.

------------------------------------------------------------------------

# 17. Recommended Initial Feature Set

A good first version can use approximately 50--80 carefully selected
features.

## Price / Candle

-   Open
-   High
-   Low
-   Close
-   Volume
-   Body %
-   Upper wick %
-   Lower wick %
-   Candle range %
-   Gap %

## Returns

-   Return 1D
-   Return 2D
-   Return 3D
-   Return 5D
-   Return 10D
-   Return 20D

## Price Structure

-   Distance from 5D high
-   Distance from 5D low
-   Distance from 10D high
-   Distance from 10D low
-   Distance from 20D high
-   Distance from 20D low
-   Distance from 52W high
-   Distance from 52W low

## Trend

-   EMA20 distance
-   EMA50 distance
-   EMA200 distance
-   EMA20 slope
-   EMA50 slope
-   EMA200 slope

## Momentum

-   RSI14
-   RSI change
-   RSI relative to 50
-   MACD
-   MACD histogram
-   MACD histogram change
-   ROC

## Volume

-   Relative volume
-   Volume change
-   Volume / average 20
-   Volume / average 50
-   OBV
-   OBV slope

## Volatility

-   ATR14
-   ATR%
-   ATR change
-   Bollinger Band width
-   Historical volatility

## VWAP

-   Distance from VWAP
-   VWAP slope
-   VWAP deviation

## Market

-   NIFTY return 1D
-   NIFTY return 5D
-   NIFTY RSI
-   NIFTY volatility
-   NIFTY distance from EMA20
-   NIFTY volume

## Sector

-   Sector return 1D
-   Sector return 5D
-   Sector momentum
-   Sector volatility
-   Relative stock-vs-sector strength

## Time

-   Day of week
-   Time of day
-   Minutes from market open
-   Minutes to market close

## F&O, where available

-   OI change
-   Futures return
-   Futures premium/discount
-   Put/Call ratio
-   Call OI change
-   Put OI change

------------------------------------------------------------------------

# 18. What NOT to Do

Avoid building a model with dozens of indicators simply because they are
available.

For example, do not blindly add:

-   RSI
-   MACD
-   Stochastic
-   CCI
-   Williams %R
-   MFI
-   ADX
-   Supertrend
-   Ichimoku
-   Bollinger Bands
-   Multiple SMAs
-   Multiple EMAs

Many of these indicators are derived from the same underlying price
data.

The objective is not to have 100 indicators.

The objective is to have **useful, non-redundant information**.

------------------------------------------------------------------------

# 19. Recommended Forecast Targets

## Target 1 --- Direction

Predict:

-   UP
-   DOWN

Example:

`1 = next-day return > 0`

`0 = next-day return <= 0`

## Target 2 --- Future Return

Predict:

-   1-day return
-   3-day return
-   5-day return

## Target 3 --- Probability

This is especially useful for a trading system.

Examples:

-   Probability of return \> +1% within 3 days
-   Probability of return \< -1% within 3 days
-   Probability of positive return within 5 days

## Target 4 --- Risk

Estimate:

-   Expected upside
-   Expected downside
-   Maximum expected adverse movement
-   Volatility

------------------------------------------------------------------------

# 20. Preferred Prediction Approach

Instead of:

> "The model predicts RELIANCE will be ₹2,847 tomorrow."

Prefer:

``` text
RELIANCE

Probability of UP:          72%
Probability of +1% / 3D:    64%
Probability of -1% / 3D:    18%
Expected return / 3D:       +0.84%

Market trend:               Bullish
Sector trend:               Bullish
Relative volume:            High
Volatility:                 Normal
VWAP position:              Above
```

The trading engine can then decide whether the setup is worth taking.

------------------------------------------------------------------------

# 21. Model Strategy

Recommended order:

### Model 1 --- LightGBM

Use as the primary model.

Advantages:

-   Fast
-   Strong on tabular data
-   Handles nonlinear relationships
-   Handles many engineered numerical features
-   Good for experimentation

### Model 2 --- XGBoost

Use as a comparison model.

### Model 3 --- Random Forest

Use as a baseline.

### Model 4 --- CatBoost

Experiment later, especially if categorical/contextual features become
important.

Do not assume one model will always win. Validate them against the same
historical periods and the same features.

------------------------------------------------------------------------

# 22. Validation

This is critical.

Do NOT randomly split stock data like:

``` text
Random 80% = training
Random 20% = testing
```

This can introduce future information into the training process.

Instead use:

-   Walk-forward validation
-   Time-series split
-   Rolling training window
-   Out-of-sample testing

Example:

``` text
Train: 2020–2022
Validate: 2023

Train: 2020–2023
Validate: 2024

Train: 2020–2024
Validate: 2025

Final test: 2026
```

The exact periods should depend on the available dataset.

------------------------------------------------------------------------

# 23. Avoid Data Leakage

Never allow the model to see information that would not have been
available at the prediction time.

Examples of leakage:

-   Using tomorrow's close as a feature
-   Using future volume
-   Calculating an indicator using future candles
-   Using revised/future corporate information
-   Randomly mixing future observations into training
-   Creating labels and features incorrectly aligned in time

Every feature must represent information available **at the moment the
prediction is supposed to be made**.

------------------------------------------------------------------------

# 24. Backtesting

A good ML accuracy score does NOT automatically mean a profitable
trading strategy.

Backtest the actual trading rules.

Measure:

-   Total return
-   CAGR
-   Win rate
-   Average winning trade
-   Average losing trade
-   Profit factor
-   Maximum drawdown
-   Sharpe ratio
-   Sortino ratio
-   Number of trades
-   Average holding period
-   Transaction costs
-   Slippage
-   Brokerage/taxes/charges

A model with 55% directional accuracy can potentially be useful.

A model with 70% accuracy can still lose money if the losing trades are
much larger than the winners.

------------------------------------------------------------------------

# 25. Recommended Overall Architecture

``` text
                    HISTORICAL DATA
                          |
          +---------------+---------------+
          |               |               |
       Stock Data     Market Data     Sector Data
          |               |               |
          +---------------+---------------+
                          |
                    Feature Engine
                          |
       +------------------+------------------+
       |                  |                  |
   Candle/Price        Volume            Volatility
       |                  |                  |
    Trend              VWAP             Momentum
       |                  |                  |
       +------------------+------------------+
                          |
                    F&O Data (optional)
                          |
                    Feature Dataset
                          |
                  Time-Series Split
                          |
              +-----------+-----------+
              |                       |
           LightGBM                XGBoost
              |                       |
              +-----------+-----------+
                          |
                    Predictions
                          |
             Probability / Return / Risk
                          |
                    Trading Rules
                          |
                    Backtesting
                          |
                  Risk Management
                          |
                     Final Signal
```

------------------------------------------------------------------------

# 26. Practical Priority

If building this system from scratch, implement features in this order:

### Phase 1 --- Essential

1.  OHLCV
2.  Candle structure
3.  Historical returns
4.  Historical highs/lows
5.  EMA20/50/200
6.  RSI
7.  MACD
8.  Volume / relative volume
9.  ATR
10. NIFTY market context

### Phase 2 --- Stronger Model

11. VWAP
12. Support/resistance distances
13. Bollinger width
14. Sector index
15. Relative strength vs sector
16. Time-of-day features
17. NIFTY volatility

### Phase 3 --- Advanced

18. F&O data
19. Open interest
20. Futures premium/discount
21. Put/Call ratio
22. Corporate events
23. News/event features

------------------------------------------------------------------------

# 27. Key Principle

The final model should answer:

> **Given everything that was known at this exact moment, what is the
> probability and expected size of the stock's next meaningful move?**

It should not try to magically predict the exact future price.

The strongest system will combine:

**Price action + Volume + Trend + Volatility + Market + Sector + VWAP +
Momentum + F&O + Risk Management**

and then validate everything using **strict time-based out-of-sample
testing**.

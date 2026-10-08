# Forecast Model Roadmap Status

**As of:** 2026-10-08  
**Roadmap:** [Feed Stock 2 Forecast Model](./feedtstock2forecastmodel.md)  
**Purpose:** Track what is implemented, what has only been researched, what is
currently running, and what must happen before the forecast output is suitable
for broker or trading decisions.

## Executive status

The workspace has a working research forecast and an initial text report. It
does **not** yet have a broker-ready predictive signal:

- The standard technical model uses 12 close-derived features, not the
  roadmap's proposed 50-80 feature set.
- The main model and tested feature variants have not consistently beaten the
  no-change forecast baseline. More features are not a substitute for measured
  improvement.
- Expected-return estimates, a conservative `UNCERTAIN` signal gate, prediction
  ranges, chronological backtests, data-quality checks, and corporate-action
  adjustment are implemented.
- Calibrated probabilities, sector inputs, validated volume signals, and
  historical similar-setup statistics are not available in the report.
- Daily prospective probability tracking is running as a separate
  benchmark-only process. It does not change the production forecast or place
  trades.
- No experimental feature or probability classifier has been promoted to the
  standard forecast. Kite remains in HOLD; this roadmap does not authorize
  order execution.

The detailed protocols and authoritative experiment results remain in the
[forecast improvement plan](./FORECAST_IMPROVEMENT_PLAN.md) and the
[development baseline](../checkpoints/2026-10-07-development-baseline.md).

## Status definitions

| Status | Meaning |
| --- | --- |
| **Implemented - active model** | Used by the standard technical forecast or its quality controls. |
| **Implemented - report only** | Shown as context; not necessarily a model input or validated trading signal. |
| **Tested - not adopted** | A research implementation was evaluated but did not meet the evidence bar for adoption. |
| **In progress** | A defined experiment or collection process is currently running. |
| **Not started / blocked** | No validated implementation exists; stated dependencies must be resolved first. |
| **Out of scope for now** | Do not connect it to trading or order execution at this stage. |

## Feature-by-feature status

Statuses refer to the roadmap's numbered Feature Groups 1-14. "Available in
historical data" does not mean the field is used by the current model.

| Roadmap feature group | Status | What exists now | Remaining work |
| --- | --- | --- | --- |
| **1. Raw candle data (OHLCV)** | Partial; candle candidate tested, not adopted | Historical rows can carry OHLCV. Five causal candle features were tested against close-only forecasts on matched out-of-sample rows. | Keep OHLCV as source data, but do not add candle features to the standard model without a new positive, leakage-safe result. |
| **2. Historical price behaviour** | Partial - active model | The 12 close-derived features include 1/5-session returns, price/SMA20 and price/SMA50, ROC10 and ROC20, plus related indicators. | Roadmap's 2/3/10/20-session returns, rolling high/low distances, 52-week position, and EMA20/50/200 distances are not all present in the active feature vector. Test candidates individually. |
| **3. Trend** | Partial - active model and display | The model uses SMA20/SMA50 price ratios and EMA12/EMA26 ratio. The report labels trend using close vs SMA20/SMA50. | EMA9/20/50/100/200 slope and full trend-stack features are not implemented in the active model. The report's label is a simple rule, not a model probability. |
| **4. Volume** | Tested - not adopted | Volume history was audited and a causal relative-volume feature was tested. It did not establish a useful gain. | Volume is not used by the standard technical model or the report. Re-test only with a predeclared matched-origin experiment. |
| **5. Momentum** | Partial - active model | RSI14, MACD histogram, ROC10 and ROC20 are included in the close-derived feature set. | RSI changes/divergence, full MACD/signal relationships, and additional momentum features are not active. Avoid adding correlated indicators without evidence. |
| **6. Volatility** | Partial - active model; advanced candidate tested | The model uses 20-session realized volatility and Bollinger %B/bandwidth. Forecasts include uncertainty ranges and a daily volatility estimate. | ATR14 and ATR-derived features are not active. A separate advanced volatility/path feature set was tested and not adopted. The displayed volatility is not a calibrated loss probability. |
| **7. VWAP** | Not started / blocked by data granularity | The validated pipeline is daily-bar based. | True intraday bars are needed before VWAP distance, slope, or time-of-day relationships can be computed. Do not approximate intraday VWAP from daily bars. |
| **8. Support and resistance** | Not started | No validated swing-point or support/resistance-distance feature set is active. | Define causal high/low and swing-point calculations, then evaluate on shared out-of-sample dates. |
| **9. Gap analysis** | Tested - not adopted | Overnight gap was among the OHLC candidate features. The OHLC group did not establish a gain. | No gap feature is in the standard forecast. A separate retest needs a clear hypothesis and matched benchmark. |
| **10. Market context** | Tested - not adopted as a technical feature | A four-feature NIFTYBEES proxy candidate was benchmarked and rejected. The report can display the proxy's recent change; this is descriptive context, not a validated market signal. | NIFTYBEES is an ETF proxy, not the NIFTY 50 index. Any new market feature requires matched-origin validation and explicit proxy coverage. |
| **11. Sector context** | Not benchmarked; next research candidate | A feasibility probe found sector ETF proxies with uneven historical coverage. There is no validated sector feature in the standard model. | Define stock-to-sector proxy mapping, disclose coverage, then compare sector context against close-only and no-change on identical origins. |
| **12. Time features** | Not started / unavailable for intraday use | The standard forecast has no intraday time-of-day inputs. | Intraday session features need timestamped intraday observations. Daily day-of-week/calendar features would still need a separate hypothesis and validation. |
| **13. F&O data** | Research code and data validation implemented; not adopted | Historical archive import/validation, futures/options feature construction, and matched ablation experiments exist. The expanded comparison did not meet its predeclared direction-success criterion. | F&O features are not part of the standard technical model. Do not interpret availability or a favorable point estimate as a demonstrated general benefit. |
| **14. Corporate and event information** | Partial - data-quality controls active | Recognized split/bonus adjustments, reversal-candle screening, and data-quality reporting are implemented. An optional FinBERT path exists for archived news. | Dividends and event impacts are not comprehensively modeled. News archive provenance and point-in-time availability remain limitations; earnings/event features are not validated. |

### Other roadmap targets and methods

| Roadmap item | Status |
| --- | --- |
| **Direction / return targets** | Forecasts provide expected-return estimates and direction. The standard signal is conservatively gated and can be `UNCERTAIN`; this is not a calibrated chance of an up move. |
| **1-, 3-, and 5-session return output** | The API's standard horizons are next session and five sessions. The report obtains the 3-session estimate from the third point of the five-session forecast. |
| **Threshold probabilities and downside risk** | Historical classifiers and target audits have been run, but no general probability classifier was adopted. The separate prospective tracker collects 1- and 5-session events only; the report does not publish numeric probabilities. A 3-session threshold probability is not implemented. |
| **Model confidence score** | Not implemented. A prediction interval or a forecast direction must not be relabeled as a confidence score. |
| **LightGBM and walk-forward evaluation** | Implemented. The standard research comparison uses chronological folds; random train/test splits are avoided. |
| **XGBoost, Random Forest, CatBoost** | Not benchmarked in this forecast pipeline. |
| **Data leakage and quality controls** | Point-in-time price features, chronological folds, corporate-action adjustment, and flagged reversal-candle exclusions are implemented. Optional archived text still has provenance limitations. |
| **Trading strategy/backtest and orders** | Forecast error evaluation exists; there is no approved cost-aware strategy backtest or order policy. Trading remains out of scope and Kite remains in HOLD. |

## Status of the example output

The initial report command is
`npm run forecast:report -- SYMBOL`. Its formatter and CLI are implemented in
[`report-format.ts`](../../scripts/forecast/report-format.ts) and
[`forecast-report.ts`](../../scripts/forecast/forecast-report.ts).

| Example output field | Current output |
| --- | --- |
| 1-session expected return | **Available** from the current technical forecast. |
| 3-session expected return | **Available** as the third point from the five-session forecast. |
| 1-session UP/DOWN probability | **Withheld**; no calibrated production probability is available. |
| 3-session probability of `> +1%` / `< -1%` | **Withheld**; the prospective probability tracker does not currently evaluate a 3-session horizon. |
| Trend | **Displayed as a simple SMA rule** (close vs SMA20/SMA50), not as a learned probability. |
| Market | **Displayed as NIFTYBEES proxy change** when available; not a full NIFTY index signal. |
| Sector | **Unavailable**; sector proxy mapping and matched evaluation are unfinished. |
| Volume | **Not used** by the standard model; the tested relative-volume candidate was not adopted. |
| Volatility | **Displayed as a model daily estimate**; not a normal/high risk classification or downside probability. |
| Model confidence | **Withheld**; no calibrated confidence score exists. |
| Historical performance of similar setups | **Unavailable**; no point-in-time, out-of-sample analogue study exists. The report instead shows separate walk-forward diagnostics, which must not be presented as similar-setup performance. |

The first live report run for RELIANCE, using the 2026-10-07 close, estimated
+0.23% for one session and +0.77% for three sessions and returned `UNCERTAIN`.
Its five-session diagnostic had 466 samples, 2.76% model MAPE vs 2.26%
no-change MAPE, and 54.3% directional accuracy. This is one symbol's
diagnostic, not evidence of a general edge.

## Quantitative readiness for a broker

**Current decision: research/monitoring only; not a buy/sell or order signal.**

The latest common-date 8/14/20-month comparison found the 20-month model had
lower MAPE than the 14-month model, but every trained window still had worse
MAPE than no-change. For the 14-month model, the matched comparison was:

| Horizon | Model MAPE | No-change MAPE | Direction accuracy |
| --- | ---: | ---: | ---: |
| 1 session | 1.1155% | 1.0170% | 50.20% |
| 5 sessions | 2.8420% | 2.3775% | 50.56% |

The direction changes between training windows were inconclusive. Keep the
current 14-month setting and forecast gates unchanged. See the
[matched training-window results](../../results/forecast-training-windows/summary-2026-10-07T18-49-00-282Z.csv)
and [uncertainty results](../../results/forecast-training-windows/uncertainty-2026-10-07T18-49-00-282Z.csv).

Before exposing a forecast as a broker-grade recommendation, require all of
the following:

1. Correct, sufficiently complete, point-in-time data for the stock and each
   context source.
2. A predeclared out-of-sample result that improves on both the existing
   close-only model and the no-change baseline on matched origins; report
   uncertainty and per-symbol/regime coverage.
3. Calibrated probabilities and explicit downside/risk measurements before
   publishing probability or confidence percentages.
4. A separate paper-trading test net of brokerage, taxes, slippage, liquidity
   limits, and realistic position sizing, with drawdown limits.
5. Human review and explicit risk controls before any future order-execution
   discussion.

The existing 55% directional figure is a preview gate in the improvement plan,
not a universal acceptance threshold or proof of profitability.

## Next development steps

Daily probability tracking continues in parallel and remains unchanged:
after each NSE close, run
[`forecast:probability-score`](./DAILY_RUN_TASKS.md) first and
`forecast:probability-capture` second. The current tracker covers 1- and
5-session events; wait for at least 200 distinct matured forecast-origin dates
before interpreting its paired bootstrap intervals.

| Priority | Work | Deliverable / decision gate |
| --- | --- | --- |
| **1 - Next research experiment** | Run a sector-context feasibility and matched benchmark using an explicit stock-to-ETF-proxy map. Keep the current standard model unchanged. | Publish symbol mapping, available history and skipped coverage first. Compare close-only, sector-context candidate, and no-change on identical symbol/origin/target rows at supported horizons. Adopt nothing unless the predeclared out-of-sample criteria are met. |
| **2 - Complete the desired probability fields** | Design a separate 3-session threshold-probability experiment; do not silently change the daily 1/5-session tracker. Compare its Brier score, log loss and calibration against causal-prior and 50% baselines using chronological tests and uncertainty intervals. | Add `> +1%` and `< -1%` probabilities to the report only after they are calibrated and pass the predeclared evaluation. |
| **3 - Similar-setup evidence** | Define what counts as a similar setup using information available at the forecast origin. Measure later outcomes only on untouched future periods; report sample size, win rate, average win/loss, drawdown and uncertainty. | Show a similar-setup section only after it is demonstrably point-in-time and out-of-sample. Do not substitute ordinary backtest rows for analog outcomes. |
| **4 - Broker risk validation** | If predictive improvements emerge, test an explicit paper strategy net of all costs, liquidity limits and risk/position rules. | No production recommendation or order integration until forecast edge and net strategy results pass independent review. |
| **Ongoing** | Continue the existing daily score-then-capture routine; keep the report available for research/monitoring. | Do not tune on immature prospective outcomes and do not change production or trading behavior based on early scorecards. |

Feature additions should remain hypothesis-driven. The roadmap's Phase 1/2/3
lists are candidate ordering, not a commitment to implement every indicator.

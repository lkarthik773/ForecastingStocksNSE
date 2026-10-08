# F&O Forecasting Chat Context

**Updated:** 2026-10-07  
**Purpose:** Persistent handoff for the forecasting work discussed in chat. Read this file and [FNO_INTEGRATION_STATUS.md](./FNO_INTEGRATION_STATUS.md) before continuing.

The consolidated starting baseline is [Development Checkpoint 1](../checkpoints/2026-10-07-development-baseline.md). Follow [DAILY_RUN_TASKS.md](../development/DAILY_RUN_TASKS.md) for prospective probability capture and scoring.

## Workspace and immediate continuation

- The workspace has moved to `S:\NSE\nseapi`; the package root is `S:\NSE\nseapi\nse-bse-api`. Continue from this workspace, not the previous `C:` location.
- The current local archives and benchmark artifacts are present in the moved package. Keep large downloaded archives local and out of version control.
- On 2026-10-07 the eight additional archives (`ICICIBANK`, `SBIN`, `LT`, `BAJFINANCE`, `SUNPHARMA`, `ITC`, `MARUTI`, `BHARTIARTL`) were added alongside the original five. All 13 passed `npm run forecast:fno-validate`: both recognized schemas, all futures/CE/PE dates covered, full spot-date overlap, and no reported conflicts. No more raw data is currently needed for the planned matched comparison.
- Remaining possible additions after this comparison are `HINDUNILVR` and `ASIANPAINT`; confirm their F&O eligibility and compatible full-history futures and CE/PE archives before adding them.
- The archive preflight command is available as `npm run forecast:fno-validate`; it checks file/symbol/schema, date coverage, overlap with NSE spot history, missing Futures/CE/PE sessions, and conflicting contracts before expensive benchmark runs. Pass symbols after `--` to check selected files, or omit them to check all top-level CSVs in `downloads/`.
- The expanded 13-symbol comparison uses a pre-registered primary test: `options_only` versus `technical` on the eight newly added symbols for forecast origins 2025-10-07 through 2026-10-07, with 2,000 moving-block bootstrap replicates of 20 origin sessions. The exact decision criteria and results location are documented in [FNO_INTEGRATION_STATUS.md](./FNO_INTEGRATION_STATUS.md).
- The primary holdout comparison is complete but inconclusive for direction: +1.33 pp with a 95% block-bootstrap interval of [-0.79, +4.07] pp. MAPE improved, but the direction interval includes zero; do not select or ship a feature based on this experiment.
- A separate benchmark-only probability classifier was run across the same 29 symbols and matched 27,180 historical outcome rows. It improved next-day threshold-event Brier scores slightly, but was worse for next-day direction and all five-session events; it was not adopted.
- Prospective probability tracking began after the 2026-10-07 close: 29 symbols × three events × two horizons = 174 saved predictions. No labels had matured at the initial score. Continue after each trading-day close using the daily run checklist; intervals are withheld until 200 distinct forecast-origin dates have matured.
- The LightGBM 8/14/20-month training-window benchmark completed on a fixed 2026-10-07 as-of date: 20 months reduced MAPE versus 14 months on both horizons, but direction was inconclusive and all windows trailed the no-change baseline. Keep the 14-month production default; results are in [FNO_INTEGRATION_STATUS.md](./FNO_INTEGRATION_STATUS.md) and [FORECAST_IMPROVEMENT_PLAN.md](../development/FORECAST_IMPROVEMENT_PLAN.md).

## User goal and constraints

- Improve the stock forecasting model using downloaded historical F&O data.
- Focus on measured forecasting quality; do not claim deployment readiness or ship experimental features as proven improvements.
- Keep detailed status and results in project files instead of repeating the full history in chat.
- Make benchmark outputs readable as charts in the package `results/` folder.

## Data and implementation

- The user downloaded NSE historical derivatives CSVs for TCS, INFY, HDFCBANK, RELIANCE and WIPRO to [`downloads/`](../../downloads/).
- All 13 archives cover 2021-10-01 through 2026-10-06 or 2026-10-07 and contain futures plus CE/PE options. All passed local archive and NSE spot-history validation. The importer handles legacy and newer NSE formats.
- `technical_fno` uses the local archive; `technical_futures` uses the historical NSE futures API. Keep the raw archives local and out of version control.
- The project-local Python 3.12 / LightGBM setup is in place.

## Latest matched refinement ablation

Run: `npm run forecast:fno-ablation` from `nse-bse-api/`. Fourteen variants produced 70 successful runs and were compared on the same 3,700 five-session origin/target pairs (740 per symbol), from 2023-06-07 through 2026-09-04.

| Variant | Direction | Change vs technical | MAPE | MAPE change |
|---|---:|---:|---:|---:|
| Technical baseline | 50.41% | — | 2.955% | — |
| Historical futures | 50.95% | +0.54 pp | 2.971% | +0.017 pp |
| All archive F&O | 50.27% | -0.14 pp | 2.858% | -0.096 pp |
| Archive futures group | 49.38% | -1.03 pp | 2.886% | -0.069 pp |
| Options group only | 51.14% | +0.73 pp | 2.885% | -0.069 pp |
| All F&O without PCR | 50.41% | 0.00 pp | 2.864% | -0.091 pp |
| All F&O without options volume | 51.00% | +0.59 pp | 2.863% | -0.092 pp |
| All F&O without futures premium | 50.30% | -0.11 pp | 2.859% | -0.096 pp |
| All F&O without futures OI/price-OI | 49.65% | -0.76 pp | 2.876% | -0.079 pp |
| 3-day premium lookback | 50.41% | 0.00 pp | 2.866% | -0.089 pp |
| 3/10-day OI lookbacks | 50.81% | +0.41 pp | 2.849% | -0.105 pp |
| 3-day premium + 3/10-day OI | 49.86% | -0.54 pp | 2.878% | -0.076 pp |
| Options, front expiry only | 50.14% | -0.27 pp | 2.880% | -0.074 pp |
| Options, front-expiry ATM | 50.54% | +0.14 pp | 2.900% | -0.054 pp |

**Interpretation:** The options-only group remains the strongest mean direction variant (+0.73 pp), but its edge is small and mixed by symbol. The 3/10-day OI variant had the lowest MAPE (2.849%, -0.105 pp) and a small mean direction gain (+0.41 pp), but its directional change varied by chronological slice (-2.36, 0.00, +2.89 pp). No variant is a consistent winner. The front-expiry ATM variant also varied across time slices (-1.48, -3.62, +4.29 pp in direction versus technical).

## Expanded 13-symbol comparison

The matched run completed all 14 variants for 13 symbols and 9,502 symbol-origin pairs (2023-06-07 through 2026-09-04). On the predeclared last-12-month holdout for the eight new symbols, `options_only` improved direction by +1.33 pp (95% block-bootstrap CI [-0.79, +4.07]) and MAPE by -0.108 pp (95% CI [-0.164, -0.045]); five of eight new symbols improved direction. It did not pass the predeclared criterion because the direction interval crosses zero.

Expanded run artifacts are in [`results/fno-expanded-2026-10-07/`](../../results/fno-expanded-2026-10-07/), and detailed results/protocol are in [FNO_INTEGRATION_STATUS.md](./FNO_INTEGRATION_STATUS.md).

## Key result files

- [SVG comparison chart](../../results/forecast-fno-ablation-comparison.svg)
- [Aggregate metrics](../../results/forecast-fno-ablation-comparison.csv)
- [Per-symbol metrics](../../results/forecast-fno-ablation-by-symbol.csv)
- [Error report](../../results/forecast-fno-ablation-errors.csv)
- Detailed archive inventory, earlier benchmarks, tests, and next steps: [FNO_INTEGRATION_STATUS.md](./FNO_INTEGRATION_STATUS.md)

## Validation and next work

- Latest build passed.
- Focused F&O/data/training tests passed 28/28, including actual LightGBM training; the matched runner completed all 70 runs and exported the updated artifacts. The runner uses HTTP/1.1 because NSE HTTP/2 requests reset during the first attempt.
- Chronological slices were analyzed using matched cached predictions. Results are still exploratory and do not establish generalization.
- All 13 archives passed validation with full futures/CE/PE spot-session coverage; no additional raw data is needed for the completed comparison.
- The local preflight is `npm run forecast:fno-validate`; expanded matched comparisons, per-symbol and time-slice scoring, and block-bootstrap intervals are complete.
- The direction result remains inconclusive. For another independent-symbol replication, optional remaining candidates are HINDUNILVR and ASIANPAINT; no feature-selection or deployment claim until a predeclared test establishes generalization.
- Probability artifacts: [historical benchmark](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/summary.csv), [prospective snapshot](../../results/forecast-probability-prospective/snapshots/snapshot-2026-10-07.json), and [latest prospective scorecard](../../results/forecast-probability-prospective/scorecard.csv). Production forecast behavior remains unchanged.

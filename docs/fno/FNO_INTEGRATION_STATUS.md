# F&O Integration Status

**Updated:** 2026-10-07
**Goal:** Improve out-of-sample forecast accuracy. Release decisions are out of scope until an accuracy gain is demonstrated.
**Current state:** Historical F&O comparisons and the probability classifier have not established general gains; prospective probability tracking continues. The controlled 8/14/20-month benchmark is complete: 20 months reduced MAPE versus 14 months on both horizons, but did not improve direction and still trailed the no-change baseline. No production change was made.
**Development baseline:** [Checkpoint 1](../checkpoints/2026-10-07-development-baseline.md) records completed work and the starting point for the next development phase.

## Test results (re-run 2026-10-07)

| Suite | Result |
|---|---|
| `fno-features.test.ts` | 7/7 pass |
| `fno-data-fetcher.test.ts` | 7/7 pass |
| `fno-archive.test.ts` | 3/3 pass |
| `futures-features.test.ts` | 3/3 pass |
| `futures-data-fetcher.test.ts` | 2/2 pass |
| `trained-forecast.integration.test.ts` | 3/3 pass, including actual LightGBM training |
| Total targeted | 25/25 |
| Latest F&O/data/training regression run | 28/28 pass, including actual LightGBM training |
| Refinement-focused F&O unit tests | 13/13 pass |
| Probability snapshot/scoring tests | 11/11 pass |
| Forecast and corporate-action regression tests | 28/28 pass |
| Package build and benchmark-script type-check | pass |

Forecast regression suite: 79/79 pass (re-run after archive integration).

Full repository suite (earlier run): 168 pass / 12 fail. The extra failures were NSE network tests returning HTTP 404, not F&O related.

Passing tests prove calculations, causal feature construction, NSE-history parsing and LightGBM training plumbing. They do not establish an accuracy gain.

## Cross-cutting probability classifier (2026-10-07)

This is separate from the F&O model comparisons. A fixed benchmark-only
standardized logistic classifier was evaluated on the same 29 symbols and
exact same 27,180 symbol/origin/horizon rows as the corrected historical
benchmark. It uses the existing close-only technical features, quality masks,
and 14-month training / 3-month test / 6-month advance folds.

| Horizon | Event | Samples | Classifier Brier | Prior-only Brier | Δ Brier (classifier - prior) | Classifier log loss | Prior-only log loss |
|---|---|---:|---:|---:|---:|---:|---:|
| Next day | Return > 0% | 14,044 | 0.2598 | 0.2504 | +0.0094 | 0.7163 | 0.6940 |
| Next day | Return > +1% | 14,044 | 0.1653 | 0.1694 | -0.0041 | 0.5192 | 0.5206 |
| Next day | Return < -1% | 14,044 | 0.1579 | 0.1628 | -0.0049 | 0.5004 | 0.5055 |
| Five sessions | Return > 0% | 13,136 | 0.2788 | 0.2521 | +0.0267 | 0.7734 | 0.6974 |
| Five sessions | Return > +1% | 13,136 | 0.2604 | 0.2373 | +0.0231 | 0.7384 | 0.6682 |
| Five sessions | Return < -1% | 13,136 | 0.2498 | 0.2292 | +0.0206 | 0.7180 | 0.6513 |

The candidate is worse on next-day direction and all five-session events.
Next-day threshold-event Brier scores improve modestly, but this is not
sufficient to adopt it. Production forecasts remain unchanged.

Prospective capture and scoring are now running separately:

- First capture: **2026-10-07**, 29 symbols, 174 probabilities (three events
  × two horizons); all labels are pending.
- Initial scorecard: zero matured rows; 29 pending targets at each horizon.
  This confirms capture/scoring plumbing only, not model skill.
- After the first capture, run `npm run forecast:probability-score` first and
  then `npm run forecast:probability-capture` after each trading-day close
  (16:00 IST or later). This updates matured prior outcomes before the next
  snapshot.
- Prospective block-bootstrap intervals are withheld until at least 200
  distinct origins; then the scorecard uses 20-session blocks and 2,000
  replicates. Duplicate symbol/origin records are rejected.
- The operational checklist is [DAILY_RUN_TASKS.md](../development/DAILY_RUN_TASKS.md).

Artifacts: [historical aggregate](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/summary.csv), [historical uncertainty](../../results/forecast-probability-classifier/current-schedule-2026-10-07T17-21-02-080Z/uncertainty.csv), [first prospective snapshot](../../results/forecast-probability-prospective/snapshots/snapshot-2026-10-07.json), and [current prospective scorecard](../../results/forecast-probability-prospective/scorecard.csv). No additional historical data is needed from the user.

## Training-window comparison (complete, as of 2026-10-07)

The benchmark-only LightGBM experiment compares 8-, 14-, and 20-month
training windows on the same 29 symbols and shared one- and five-session
forecast origins/targets. The feature set, quality filters, corporate-action
adjustments, three-month test folds, and six-month advance are held constant.
One NSE as-of date is frozen for all model calls. The first common test fold
begins after a 20-month history anchor. Paired scores use only origins
available in every window; skipped folds and coverage are reported separately.
The scorecard reports MAPE, no-change MAPE, direction accuracy, per-symbol
metrics, and paired 20-session block-bootstrap intervals (2,000 replicates)
for 8 vs 14 and 20 vs 14 months.

All 87 runs completed with the same 2026-10-07 NSE as-of date and identical
test-fold boundaries. The 20-month window reduced MAPE versus 14 months by
0.0160 pp at one session and 0.0797 pp at five sessions; paired 95% intervals
excluded zero for both. Directional differences were inconclusive, and all
three windows had worse MAPE than the no-change baseline. The 8-month window
also had lower forecast coverage due to more skipped folds. Keep the production
14-month schedule unchanged pending independent validation.

The earlier HTTP/1.1 partial run crossed an NSE date boundary and is retained
only for audit. Corrected [full results](../../results/forecast-training-windows/training-window-benchmark-2026-10-07T18-49-00-282Z.json),
[aggregate scorecard](../../results/forecast-training-windows/summary-2026-10-07T18-49-00-282Z.csv),
and [coverage report](../../results/forecast-training-windows/coverage-2026-10-07T18-49-00-282Z.csv)
are available.
Procedure and current result location are tracked in the
[forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Benchmark results (`src/forecast/fno-benchmark.ts`)

Earlier standalone `technical` model baseline (the separate 853-sample backtest; not the paired comparison below):

| Symbol | Directional acc. | MAPE | Interval coverage |
|---|---:|---:|---:|
| TCS | 53.58% | 2.82% | 93.46% |
| INFY | 47.01% | 3.44% | 93.08% |
| HDFCBANK | 51.00% | 2.47% | 92.45% |
| RELIANCE | 50.88% | 2.72% | 92.58% |
| WIPRO | 51.23% | 3.05% | 92.83% |

`technical_fno`: now uses the manually downloaded archive files. Both models produced 853 five-session walk-forward samples per symbol.

`technical_futures`: benchmark completed. It compares `technical` and futures-only LightGBM predictions on the same 5-session walk-forward origin/target dates (740 paired samples per symbol).

| Symbol | Technical direction | Futures direction | Change (pp) | Technical MAPE | Futures MAPE | MAPE change |
|---|---:|---:|---:|---:|---:|---:|
| TCS | 54.19% | 53.78% | -0.41 | 2.865% | 2.894% | +0.029 pp |
| INFY | 44.86% | 48.38% | +3.51 | 3.515% | 3.397% | -0.118 pp |
| HDFCBANK | 49.59% | 50.81% | +1.22 | 2.492% | 2.447% | -0.046 pp |
| RELIANCE | 51.22% | 50.27% | -0.95 | 2.807% | 2.869% | +0.062 pp |
| WIPRO | 52.16% | 51.76% | -0.41 | 3.094% | 3.252% | +0.158 pp |
| Mean | 50.41% | 51.00% | **+0.59** | 2.955% | 2.972% | **+0.017 pp** |

### Readout

- Futures signals improved direction accuracy for **INFY** and **HDFCBANK**, and reduced error for those same symbols.
- Direction accuracy declined for **TCS, RELIANCE and WIPRO**.
- Across the five symbols, mean direction accuracy increased by only **0.59 percentage points**; mean MAPE worsened slightly by **0.017 percentage points**.
- This is a small, inconsistent signal—not evidence of a general improvement or a proven "best" feature set. Keep the futures features experimental and test refinements against the same paired origins.

`technical_fno`: historical options-inclusive benchmark completed using 853 walk-forward five-session samples per symbol.

| Symbol | Technical direction | F&O direction | Change (pp) | Technical MAPE | F&O MAPE | MAPE change | F&O interval coverage |
|---|---:|---:|---:|---:|---:|---:|---:|
| TCS | 53.58% | 51.58% | -2.00 | 2.8191% | 2.7185% | -0.1006 pp | 91.95% |
| INFY | 47.01% | 47.01% | 0.00 | 3.4354% | 3.3454% | -0.0900 pp | 93.96% |
| HDFCBANK | 51.00% | 55.10% | +4.10 | 2.4658% | 2.3181% | -0.1477 pp | 92.96% |
| RELIANCE | 50.88% | 48.89% | -1.99 | 2.7231% | 2.6732% | -0.0499 pp | 93.46% |
| WIPRO | 51.23% | 50.76% | -0.47 | 3.0471% | 3.0366% | -0.0105 pp | 92.83% |
| Mean | 50.74% | 50.67% | **-0.07** | 2.8981% | 2.8184% | **-0.0797 pp** | 93.03% |

### Options-inclusive readout

- Direction accuracy improved only for HDFCBANK (+4.10 pp), was unchanged for INFY, and declined on TCS, RELIANCE and WIPRO.
- MAPE improved modestly for all five symbols.
- Mean directional accuracy declined by 0.07 pp, while mean MAPE improved by 0.08 pp. This is a mixed result, not proof that adding F&O produces better directional forecasts.
- The original +5-12 pp direction-accuracy estimate was not supported by this test.

## Matched F&O feature ablation (2026-10-07)

The ablation runner compares nine variants on the **same 3,700 origin/target pairs**: 740 five-session forecasts for each of TCS, INFY, HDFCBANK, RELIANCE and WIPRO. The common evaluation period runs from the 2023-06-07 forecast origin through the 2026-09-04 target. All variants retain the same technical inputs; “options group only” means only options-derived inputs are enabled among the archive F&O features. The independent historical-futures feature set is also included.

| Variant | Directional accuracy | Change vs technical | MAPE | MAPE change vs technical |
|---|---:|---:|---:|---:|
| Technical baseline | 50.41% | — | 2.955% | — |
| Historical futures | 51.00% | +0.59 pp | 2.971% | +0.016 pp |
| All archive F&O | 50.27% | -0.14 pp | 2.858% | -0.096 pp |
| Archive futures group only | 49.38% | -1.03 pp | 2.886% | -0.069 pp |
| Options group only | 51.14% | +0.73 pp | 2.885% | -0.069 pp |
| All F&O, without PCR | 50.41% | 0.00 pp | 2.864% | -0.091 pp |
| All F&O, without options volume | 51.00% | +0.59 pp | 2.863% | -0.092 pp |
| All F&O, without futures premium | 50.30% | -0.11 pp | 2.859% | -0.096 pp |
| All F&O, without futures OI/price-OI signals | 49.65% | -0.76 pp | 2.876% | -0.079 pp |

### Readout

- The options-only group had the highest directional accuracy in this comparison (+0.73 pp), but the gain is small and not consistent across symbols. It is a candidate for further testing, not a demonstrated improvement.
- The combined archive F&O model reduced MAPE by 0.096 pp but did not improve mean directional accuracy. This reinforces that error and direction are different objectives.
- Excluding PCR or options-volume signals left mean direction unchanged or slightly higher than baseline while retaining most of the MAPE reduction. Futures OI/price-OI combinations appear more useful than the archive futures group as a whole, but their removal also had mixed per-symbol effects.
- No variant is a clear winner across all five symbols. These results cover one five-session horizon and one fixed historical evaluation window; expand the symbol and time coverage before choosing or deploying features.

### Follow-up lookback and options aggregation comparison (2026-10-07)

The matched runner was extended with shorter premium/OI windows and two options-only aggregation variants. All 14 variants completed for the same five symbols; comparisons use the same 3,700 five-session origin/target pairs (740 per symbol), from 2023-06-07 through 2026-09-04.

| Variant | Direction | Change vs technical | MAPE | MAPE change |
|---|---:|---:|---:|---:|
| Technical baseline | 50.41% | — | 2.955% | — |
| 3-day premium lookback | 50.41% | 0.00 pp | 2.866% | -0.089 pp |
| 3/10-day OI lookbacks | 50.81% | +0.41 pp | 2.849% | -0.105 pp |
| 3-day premium + 3/10-day OI | 49.86% | -0.54 pp | 2.878% | -0.076 pp |
| Options, front expiry only | 50.14% | -0.27 pp | 2.880% | -0.074 pp |
| Options, front-expiry ATM | 50.54% | +0.14 pp | 2.900% | -0.054 pp |

The front-expiry ATM aggregation chooses the nearest available strike to spot independently for calls and puts in the same front expiry. Default production aggregation remains unchanged (all active strikes/expiries).

#### Time-slice stability check

The existing cached predictions were also scored over three chronological slices on identical matched symbol/origin pairs. Deltas are relative to technical within each period.

| Period | Samples | Variant | Direction change | MAPE change |
|---|---:|---|---:|---:|
| 2023-06-07–2024-06-06 | 1,145 | 3/10-day OI | -2.36 pp | -0.019 pp |
|  |  | Front-expiry ATM options | -1.48 pp | +0.045 pp |
| 2024-06-07–2025-06-06 | 1,135 | 3/10-day OI | 0.00 pp | -0.041 pp |
|  |  | Front-expiry ATM options | -3.62 pp | -0.002 pp |
| 2025-06-07–2026-09-04 | 1,420 | 3/10-day OI | +2.89 pp | -0.226 pp |
|  |  | Front-expiry ATM options | +4.29 pp | -0.176 pp |

Neither candidate has a stable directional advantage across all three periods. The 3/10-day OI variant reduced aggregate MAPE in every slice, but this result is still limited to five symbols and this one walk-forward setup; it is not evidence of generalization.

Readable chart and data exports:

- [F&O ablation chart](../../results/forecast-fno-ablation-comparison.svg)
- [Aggregate comparison CSV](../../results/forecast-fno-ablation-comparison.csv)
- [Per-symbol comparison CSV](../../results/forecast-fno-ablation-by-symbol.csv)
- [Run errors CSV](../../results/forecast-fno-ablation-errors.csv) (header only; all 70 runs succeeded)

Reproduce from `nse-bse-api/` with `npm run forecast:fno-ablation`. The script saves its fold predictions under `node_modules/.cache/forecast-benchmark/`, supports resuming through `FORECAST_FNO_ABLATION_RESUME`, and uses the HTTP/1.1 NSE client because the HTTP/2 transport reset during the initial run.

## Downloaded archive inventory and parsing

The manually downloaded files in `nse-bse-api/downloads/` are:

| File | Date range | Trade dates | Records |
|---|---|---:|---:|
| `TCS.csv` | 2021-10-01 to 2026-10-06 | 1,243 | 385,660 |
| `INFY.csv` | 2021-10-01 to 2026-10-06 | 1,243 | 288,613 |
| `HDFCBANK.csv` | 2021-10-01 to 2026-10-06 | 1,243 | 334,624 |
| `RELIANCE.csv` | 2021-10-01 to 2026-10-06 | 1,243 | 357,254 |
| `WIPRO.csv` | 2021-10-01 to 2026-10-06 | 1,243 | 312,601 |

Each file has daily futures and call/put contracts. The rows change from the legacy `INSTRUMENT`/`OPEN_INT` schema through 2024-07-05 to the newer NSE `FO`/`STF`/`STO` schema starting 2024-07-08. `fno-archive.ts` handles both layouts; its default aggregates daily call/put OI and volume over active strikes/expiries, and the benchmark can alternatively select front-expiry or front-expiry ATM options. It selects the nearest unexpired futures price and sums open interest across active futures expiries. Conflicting duplicate contract records are rejected.

`NSEClient` uses `downloads/` by default for F&O archives; specify `forecastTraining.fnoArchiveDir` to use another directory. Keep the large raw files local and do not commit them.

## Futures-only feature set

`technical_futures` uses ten causal signals built only from historical spot and futures records:

- Futures premium level and 1-day/5-day changes
- Futures open-interest 1-day/5-day changes and 5-vs-20-day momentum
- Four spot-price/futures-OI combinations (price up/down × OI up/down)

The fetcher selects the nearest unexpired futures contract for premium and sums OI across active expiries to reduce expiry-roll discontinuities. No option-chain API is called. The feature model requires 21 matched futures observations.

## Known problems (blockers to proving value)

1. The archive importer assumes a flat `SYMBOL.csv` file using the two inspected NSE schemas. Different export columns require updating and testing the row mappings.
2. The five available archives all cover the same symbols; additional-symbol generalization still needs compatible historical F&O archives.
3. The historical data stops at 2026-10-06 in the files inspected; update archives before rerunning for newer origins.

## Code changes made

- `trained-forecast.ts`: `fnoFeatures` on `TrainingObservation`, `technical_fno` feature set, `getFnoFeaturesForObservation()`.
- `forecast-api.ts`: `includeFno` option, `technical_fno` model, optional `OptionsApi`.
- `nse-client.ts`: passes `OptionsApi` to `ForecastApi`.
- `fno-features.ts`: 28 features, NaN guards. `fno-data-fetcher.ts`: date parsing fix, eligibility messages.
- `fno-archive.ts`: parses the two archive layouts and produces causal historical F&O observations.
- `npm run forecast:fno-validate -- SYMBOL...`: checks local archive schemas, symbol consistency, valid contract coverage, conflicting rows, and missing Futures/CE/PE sessions against NSE spot history. With no symbols it checks each top-level CSV in `downloads/`; gaps and API errors fail the command.
- `fno-feature-ablation.ts`: runs matched technical, futures, lookback and options-aggregation ablations and exports summary/per-symbol CSVs plus an SVG chart.

## Next steps (accuracy-focused)

- [x] Set up isolated Python 3.12/LightGBM environment (`npm run setup:lightgbm`).
- [x] Build and test the futures-only feature set and matched-date benchmark.
- [x] Run the paired futures-only benchmark against NSE historical data and record results.
- [x] Load downloaded historic options and run `technical_fno` against `technical`.
- [x] Run matched F&O feature-group ablations and export readable comparison charts.
- [x] Test shorter OI/premium lookbacks on matched folds; results are mixed and do not show a consistent directional gain.
- [x] Test front-expiry and front-expiry ATM option aggregations on matched folds; neither is a consistent winner.
- [x] Check stability across three chronological slices; directional changes remain inconsistent.
- [x] Add an archive preflight/validation command for symbol/schema, date coverage, spot overlap, missing dates, and duplicate/conflicting contracts before benchmark training.
- [ ] Expand to additional symbols when compatible historical F&O archives are available.
- [ ] Predefine a held-out evaluation protocol and uncertainty estimates that account for overlapping five-session forecasts; report per-symbol and chronological-slice results before considering feature selection.

Suggested sector-diverse symbols for the next archive batch: `ICICIBANK`, `SBIN`, `LT`, `BAJFINANCE`, and `SUNPHARMA`. Optional further candidates: `ITC`, `MARUTI`, `BHARTIARTL`, `HINDUNILVR`, and `ASIANPAINT`. Verify compatible futures and CE/PE history and the available date range for each symbol before benchmarking.

## Expanded-symbol pre-registered evaluation

The 13 validated local archives are `TCS`, `INFY`, `HDFCBANK`, `RELIANCE`, `WIPRO`, `ICICIBANK`, `SBIN`, `LT`, `BAJFINANCE`, `SUNPHARMA`, `ITC`, `MARUTI`, and `BHARTIARTL`. The CSVs remain in the existing `downloads/` input directory because the loader expects that flat symbol-named layout; no archive files were moved.

Before running the expanded comparison:

- Run all 14 existing variants with the same five-session walk-forward configuration; retain only common origin/target pairs per symbol across every variant.
- Treat the original five symbols as the development cohort and the eight added symbols as the symbol-generalization cohort.
- The single primary comparison is `options_only` versus `technical`, on the eight added symbols using forecast origins from **2025-10-07 through 2026-10-07**. The period overlaps prior exploratory dates on the original five symbols, so this is an unseen-symbol confirmation, not a pristine time-only holdout.
- Estimate paired uncertainty with 2,000 deterministic moving-block bootstrap replicates, sampling 20 consecutive origin sessions jointly across symbols to preserve cross-symbol co-movement and overlapping five-session outcomes.
- Count the primary result as meeting the predeclared criterion only if direction accuracy improves by at least **0.5 percentage points**, the 95% block-bootstrap interval for direction change excludes zero on the positive side, the upper 95% interval for MAPE change is no worse than **+0.05 percentage points**, and at least five of the eight new symbols have positive direction changes. This is a decision rule for this experiment, not a deployment threshold.
- Report all-variant results by symbol and chronological slice as exploratory; do not promote whichever of the 14 variants scores highest on the confirmation cohort. A failed or inconclusive primary comparison is not evidence of a general improvement.

Use `FORECAST_FNO_RESULTS_DIR` to write the expanded run and analysis into a separate results folder, preserving the earlier five-symbol benchmark artifacts. `npm run forecast:fno-generalization -- <progress-json>` produces the time-slice and block-bootstrap CSVs from a completed ablation progress file.

### Expanded comparison results (2026-10-07)

All 13 symbols completed all 14 variants without run errors. The per-symbol matched comparisons contain **9,502 symbol-origin pairs** from 2023-06-07 through 2026-09-04; 11 symbols contributed 740 pairs each, while BHARTIARTL and ITC contributed 681 each because the independent NSE historical-futures variant had fewer eligible predictions for those symbols. Matching is within each symbol across every variant; aggregate scores pool those matched symbol-origin rows.

| Variant | Direction | Change vs technical | MAPE | MAPE change |
|---|---:|---:|---:|---:|
| Technical baseline | 50.61% | — | 2.817% | — |
| All archive F&O | 50.79% | +0.18 pp | 2.730% | -0.087 pp |
| Options group only | 50.96% | +0.35 pp | 2.761% | -0.056 pp |
| Without options volume | 51.24% | +0.63 pp | 2.729% | -0.088 pp |
| 3-day premium lookback | 51.13% | +0.52 pp | 2.728% | -0.089 pp |
| 3/10-day OI lookbacks | 50.73% | +0.12 pp | 2.723% | -0.093 pp |

The highest directional point estimate and lowest MAPE belong to different exploratory variants. These full-period results pool the same data used to compare 14 variants and are not a feature-selection or generalization claim.

The predeclared primary test (`options_only` vs `technical`, eight new symbols, origins 2025-10-07 through 2026-10-07) had 1,648 paired forecasts:

- Direction accuracy change: **+1.33 pp**, 95% moving-block interval **[-0.79, +4.07] pp**.
- MAPE change: **-0.108 pp**, 95% moving-block interval **[-0.164, -0.045] pp**.
- Five of eight new symbols had positive direction changes.
- **Decision: does not meet the predeclared success criteria.** The direction interval includes zero, despite passing the point-estimate, MAPE non-inferiority, and per-symbol-count conditions.

Across all available periods on the eight new symbols, options-only direction change was only **+0.10 pp** (95% interval **[-1.14, +1.27] pp**), while MAPE improved by **0.048 pp** (95% interval **[-0.084, -0.010] pp**). On all 13 symbols, options-only direction changes were -0.56 pp in the first slice, +0.51 pp in the second, and +0.92 pp from 2025-06-07 through 2026-10-07. This reinforces that the result is mixed over time and does not establish a reliable directional improvement.

The new archives do not need correction or extension for this comparison: all passed preflight with complete futures/CE/PE spot-session coverage. The archived raw CSVs remain in `downloads/`. Expanded-run artifacts, including per-symbol scores, chronological slices, bootstrap intervals, and the chart, are in [`results/fno-expanded-2026-10-07/`](../../results/fno-expanded-2026-10-07/); the earlier five-symbol results were preserved.

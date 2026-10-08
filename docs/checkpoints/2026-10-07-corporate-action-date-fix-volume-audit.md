# 2026-10-07 - Corporate-Action Date Fix and Volume Audit

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Corporate-Action Date Parsing Correction

NSE historical rows use dates such as `01-Oct-2025`. The shared adjustment
helper previously truncated every date to ten characters before parsing,
causing this format to be rejected and split/bonus adjustments to be skipped.
The parser now preserves NSE's complete `DD-Mon-YYYY` date and continues to
accept ISO-formatted dates. A regression test covers the NSE format.

Because missed actions create artificial return discontinuities, prior
corporate-action-adjusted benchmark results were invalid. The default Phase 1
benchmark, Phase 2 common-date history comparison, and all three Phase 3
feature ablations were rerun and re-exported. Their earlier checkpoint metrics
are superseded; the corrected tables in the living context and plan and the
current result CSV/SVG files are authoritative.

Corrected default Phase 1 schedule (29 symbols, 60-month history, 14-month
training / 3-month frozen test / 6-month advance):

| Horizon | LightGBM MAPE | No-change MAPE | Direction accuracy |
| --- | ---: | ---: | ---: |
| Next day | 1.1320% | 1.0194% | 50.36% |
| Next 5 sessions | 2.8892% | 2.3503% | 50.43% |

The model remains worse than no-change and below the 55% directional preview
gate. No production model, public API options, preview gate, Kite behavior, or
prospective holdout policy changed.

The separately rerun 3-month-advance diagnostic also remained worse than
no-change: next-day MAPE 1.1649% versus 1.0554% (50.47% direction), and
five-session MAPE 2.9199% versus 2.4244% (50.77% direction).

## Five-Year Volume Audit

- Audited all 29 symbols over 1,239 daily rows each, 2021-04-05 through
  2026-04-02 (35,931 rows total).
- `chTotTradedQty` was populated, positive and valid on every row. There were
  no duplicate dates, invalid/zero volumes, missing closes or non-equity rows.
- Eight distinct ex-date groups covered nine split/bonus actions.
- Share-factor-restated five-session median-volume ratios after/before events
  ranged about 0.56-2.39; adjusted-close ratios ranged about 0.957-1.127.
  These event windows are descriptive, not evidence of volume predictiveness
  or proof that all share-unit conventions are resolved.
- No volume feature was added. A candidate requires an explicit corporate-
  action unit convention and causal scale normalization, followed by a
  separate matched-date ablation.

Audit outputs:
[per-symbol quality](../../results/forecast-volume-history-audit-by-symbol.csv),
[corporate-action event windows](../../results/forecast-volume-corporate-action-audit.csv).

## Corrected Benchmark Outputs

- Phase 1: [aggregate](../../results/forecast-benchmark-comparison.csv),
  [per-symbol](../../results/forecast-benchmark-by-symbol.csv),
  [folds](../../results/forecast-benchmark-folds.csv) and
  [readable chart](../../results/forecast-benchmark-comparison.svg).
- Phase 2: [history comparison](../../results/forecast-history-window-comparison.csv)
  and [readable chart](../../results/forecast-history-window-comparison.svg).
- Phase 3 OHLC: [comparison](../../results/forecast-feature-ablation-comparison.csv)
  and [chart](../../results/forecast-feature-ablation-comparison.svg).
- Phase 3 market context: [comparison](../../results/forecast-market-context-ablation-comparison.csv)
  and [chart](../../results/forecast-market-context-ablation-comparison.svg).
- Phase 3 advanced technical: [comparison](../../results/forecast-advanced-technical-ablation-comparison.csv)
  and [chart](../../results/forecast-advanced-technical-ablation-comparison.svg).

## Verification

- `npm run forecast:benchmark:gaps`: 29 symbols completed; no model-run errors.
  The corrected diagnostic scored 25,885 next-day and 24,154 five-session
  pairs, over 428 and 427 folds respectively.
- `npm run forecast:benchmark:export`: regenerated aggregate, symbol, fold and
  corporate-action CSV outputs. The readable Phase 1 SVG was updated and its
  displayed default/diagnostic values were reconciled with the corrected
  aggregate CSV.
- Corrected Phase 1 default, Phase 2 history windows and all three Phase 3
  candidates were regenerated; their CSV and chart artifacts were checked for
  presence and current metric labels.
- Corporate-action regression test passed as part of `npm run test:forecast`
  (70 tests across seven files); `npm run test:kite` passed (44 tests).
- `npm run typecheck:kite`, strict type-checking of the audit/action code, and
  `npm run build` all passed.

All feature candidates remain benchmark-only and rejected for production; none
beats the corrected no-change baseline. The planned causal volume ablation was
completed in the follow-up
[relative-volume checkpoint](2026-10-07-phase3-volume-ablation.md). Its
normalization does not apply actions effective after a forecast origin to that
origin's feature; the candidate was rejected for production. The next planned
forecast-only action is the local point-in-time sentiment archive coverage
audit.

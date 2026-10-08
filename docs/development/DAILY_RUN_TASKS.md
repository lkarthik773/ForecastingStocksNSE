# Daily Forecast Probability Run Tasks

## Scope

This checklist is for the benchmark-only prospective probability tracker. It
does not run the full historical benchmark, change production forecasts, or
place trades.

There is no separate daily training command. The daily capture command fits
the fixed logistic classifier from the latest available 14-month training
window for each symbol, event, and horizon, then records that day's
probabilities. It uses close-only technical features and the existing data
quality and corporate-action checks.

## Run after each NSE trading-day close

Run once per trading session, at or after 16:00 IST. Skip weekends and NSE
holidays. The latest completed snapshot is for 2026-10-08, so continue on the
next trading day.

From the package root, run these commands in this order:

1. Score outcomes that have matured:

   ```powershell
   npm run forecast:probability-score
   ```

2. If scoring succeeds, capture the new day's probabilities:

   ```powershell
   npm run forecast:probability-capture
   ```

Scoring first refreshes the matured-outcome ledger. The next capture uses that
ledger when calculating causal prior probabilities. If scoring fails, stop,
resolve the error, and do not treat the day's run as complete.

## Check each run

- The capture should save a new
  `results/forecast-probability-prospective/snapshots/snapshot-YYYY-MM-DD.json`
  with 29 symbols and 174 probabilities.
- The scorer refreshes `scorecard.csv`, `scorecard.json`, `calibration.csv`,
  `uncertainty.csv`, and `matured-outcomes.json` under
  `results/forecast-probability-prospective/`.
- Early scorecards will have pending outcomes. A one-session label needs one
  later observed trading session; a five-session label needs five. Pending
  outcomes are expected and are not evidence of model performance.
- Do not rerun capture for the same date to overwrite a snapshot. The script
  rejects duplicate daily captures; investigate any failed or incomplete run
  before continuing.

## Milestone and next steps

Continue the daily sequence until at least 200 distinct forecast-origin dates
have matured for the comparisons. This means 200 distinct trading-session
dates, not 200 individual symbol predictions; the threshold will therefore
take roughly 200 trading sessions to reach. The scorer withholds bootstrap
intervals until this threshold, then uses paired 20-session blocks and 2,000
replicates.

At that milestone, review each event and horizon's sample counts, calibration,
Brier score, and log loss against both the causal prior and the 50% baseline,
including the paired uncertainty intervals. Record the result without tuning
on this prospective dataset. Keep production unchanged unless a separate,
well-supported adoption decision is made.

No additional F&O archives or symbol data are required for these daily
probability runs. The full historical classifier benchmark is a separate
research command and should not be rerun every day.

## Run status

**2026-10-08: Complete.** The matured-outcome scorer processed 87 probabilities
from 1 existing snapshot. The daily capture saved
`results/forecast-probability-prospective/snapshots/snapshot-2026-10-08.json`
with 29 symbols and 174 predictions. The scorer output files
(`scorecard.csv`, `scorecard.json`, `calibration.csv`, `uncertainty.csv`, and
`matured-outcomes.json`) were verified present. Continue with the next NSE
trading session; do not recapture 2026-10-08.

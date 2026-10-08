# 2026-10-07 - Phase 4 Sentiment Archive Availability Audit

Living context: [Development context](../development/CONTEXT.md).
Improvement roadmap: [Forecast improvement plan](../development/FORECAST_IMPROVEMENT_PLAN.md).

## Result: No Real Archive Available

The forecast-only Phase 4 step was to inspect an existing local historical
headline archive before running any sentiment experiment. In this workspace:

- `FINBERT_NEWS_ARCHIVE` is not set in the process environment.
- No root dotenv file configures this variable.
- No news/headline archive was found in conventional project data, test-fixture,
  or FinBERT cache locations.
- No external news was fetched; no archive contents or credentials were read
  into documentation.

Therefore real-archive coverage, history depth, duplicate rate, timestamp
quality, and sentiment forecasting performance cannot be measured here.
Synthetic fixture coverage in unit tests is not evidence of real-world archive
quality or forecast accuracy.

## Code-Level Readiness Findings

The current loader accepts a version-1 JSON file scoped to one requested symbol
or `GLOBAL`, with at most 2,000 headlines and a 5 MB size cap. Each entry needs
a title and a parseable timezone-qualified `publishedAt`. Historical feature
generation excludes articles at/after the forecast cutoff and deduplicates by
exact timestamp plus trimmed title. It aggregates the prior three calendar
days and requires at least three headlines per covered price date; preprocessing
requires 180 covered dates spanning at least 180 calendar days, in addition to
per-fold training/test minimums.

The schema cannot currently establish two important properties:

1. The current archive contract does not validate or use per-headline
   symbol/issuer attribution, so relevance to the forecast company cannot be
   measured or filtered (even if extra fields are present in an input).
2. A valid publication timestamp does not establish when the title was
   captured or whether its text was later edited. Historical text provenance
   cannot be verified from this schema alone.

**Decision:** do not run a sentiment ablation until a real archive is available
and its relevance and point-in-time provenance can be assessed. If the input
does not support those checks, document it as unsuitable instead of scoring it.
Do not fetch hosted news, change the public forecast, alter the no-change gate,
or change Kite HOLD behavior.

## Resume Criteria

Provide an existing local archive through `FINBERT_NEWS_ARCHIVE` or the
`forecastTraining.newsArchivePath` option. Before FinBERT scoring, audit:

- per-symbol relevant headline counts and dates;
- duplicate records and normalization policy;
- timezone validity and publication timestamp ordering;
- capture/edit/version provenance for point-in-time text;
- daily coverage meeting the three-headline threshold;
- total chronological span and per-fold eligible counts.

Only after those checks pass should technical-only and technical-plus-FinBERT
be compared on identical chronological origins, targets and samples. This
remains a price-forecasting experiment only; no buy/sell or paper-trading work
is authorized by this step.

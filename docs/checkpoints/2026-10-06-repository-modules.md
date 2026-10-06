# Checkpoint: Repository Modules

Date: 2026-10-06

Living context: [Development context](../development/CONTEXT.md).

## Changes

- NSE and BSE remain separate exchange modules. The redundant `nse/nse`
  directory is now `nse/client`.
- Forecast/LightGBM/FinBERT logic moved from NSE APIs into `src/forecast`.
- Kite authentication/configuration/account reads moved into `src/kite`.
- HTTP apps moved into `apps/explorer` and `apps/kite`; only maintenance
  tooling remains in `scripts/build` and `scripts/forecast`.
- Tests mirror domain/app folders. Documentation moved into `docs`, and the
  placeholder environment template into `config/examples`.
- Relative imports, document links, npm scripts and Render requirements paths
  updated. Module barrels and `/forecast`, `/kite` package exports added;
  existing package API exports retained.
- Real credential files, runtime caches, forecast logic and HOLD behavior were
  not changed. User reported working live Kite login and read APIs before moves.

## Verification

- Initial relocated forecast/Kite/explorer suite: 86 tests passed.
- Final offline regression suite: 101 tests passed across forecast, Kite,
  explorer and BSE helpers/symbol parser. Live exchange/network tests not run.
- Clean ESM/CommonJS builds and strict Kite app typecheck passed; editor reports
  no errors in relocated source/apps and touched tests.
- Package imports verified in both formats for root, NSE, BSE, forecast and
  Kite; the existing NSE forecast export is identical to the forecast module.
- Relocated PowerShell setup parses and resolves the repository root correctly;
  no environment installation was rerun. All eight documentation files have
  valid local links. No stale old paths found in source/documentation search.
- Both HTTP apps start from `apps`: explorer at port 3101 renders 29 endpoints
  and icons; Kite at port 3102 renders nine Swagger operations. No horizontal
  overflow observed. No live forecast or broker request made during validation.
- Restarting the owned Kite process discards its in-memory login; user must
  repeat login. Forecast behavior and HOLD trading restrictions are unchanged.
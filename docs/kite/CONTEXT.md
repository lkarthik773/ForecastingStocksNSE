# Kite Integration Context

## Decisions (2026-10-06)

- Separate `kiteintegrationapi` service in this repository; keep the existing
  unauthenticated Explorer out of the broker-account path.
- Immediate scope: HOLD, verify Kite connectivity and read account details only.
  No order placement, modification, cancellation, or automatic execution.
- Intended deployment: hosted, multiple users. Each caller must be isolated to
  their own Kite connection. First stage uses administrator-provisioned secrets;
  this is not yet a self-service multi-user login product.
- Later scope: NSE delivery/CNC limit orders with manual confirmation, using the
  existing forecast API. Do not turn an estimated direction into an order.
- Forecast entry: `nse.forecastStock`; use explicit model selection, signal,
  backtest quality, freshness and risk flags. See docs/development/CONTEXT.md.
- Configure identities, URLs, credentials and tokens through environment or a
  deployment secret manager. Never put real values in source, logs or chat.

## Main Steps

1. Read-only configuration, per-user authentication and isolated Kite reads.
2. Mocked tests for isolation, secret redaction and rejection of write requests.
3. User supplies hosting/domain and identity-provider decisions; configure real
   credentials outside chat and verify connectivity without trading.
4. User-bound Kite login/callback now implemented with process-local sessions;
  persistent encrypted storage and production identity remain pending.
5. Add forecast-to-preview gating, risk limits, audit/reconciliation and manual
   confirmation only after explicit approval to leave HOLD mode.

## Starting Points

- Broker core: `src/kite/`; HTTP server and Swagger: `apps/kite/`.
- Focused tests: `tests/kite/kiteintegration.test.ts`.
- Broker API secret/password/OTP are not needed for pre-provisioned read-only
  access tokens. Never automate password/OTP login.
- Live connectivity is unverified until valid user tokens are configured.

## Current Implementation

- GET-only service: health/status/connection/profile/margins/holdings/positions/
  existing orders/trades. Bearer authentication selects the user; no overrides.
- Direct official REST reads using existing Axios; redirects/proxies disabled,
  finite timeout/response size, per-user throttling and sanitized failures.
- `.env.kite` or deployment secrets; `config/examples/.env.kite.example` has placeholders only.
  `npm run start:kite`, `npm run test:kite`, `npm run typecheck:kite`.
- User confirmed Render (hostname undecided), no application identity provider
  yet, and an existing access token to configure locally outside chat.
- Forecast integration is retained as future work, not invoked during HOLD.
- Public deployment is blocked pending identity/token-storage/hosting decisions.
  Setup and endpoint details live in `docs/kite/README.md`.
- Added actual Swagger UI at `/docs` (also `/`) and GET-only `/openapi.json`.
  Authorize with the service apiToken; no embedded broker credentials or stored
  browser authorization. The NSE/BSE custom Explorer remains separate.
- Fixed startup environment loading: the entry point loads `.env.kite` explicitly
  through dotenv; optional `KITE_ENV_FILE` overrides its path. tsx preload did
  not load the configured file. Local service startup verified; no broker call.
- Added `GET /api/kite/login` and configured callback (default
  `/auth/kite/callback`, optional legacy `/`). Official checksum exchange checks
  API key and expected `kiteUserId`; configure `kiteApiSecret` only on backend.
  Short-lived single-use state + HttpOnly browser cookie prevent account mixing.
- Login installs access tokens only in process memory; no token responses or
  environment-file writes. Restart/expiry requires a new login. Swagger reload
  requires reauthorization. Callback requires the same browser and exact host.
- Verification: 38 focused mocked tests and strict Kite typecheck pass. Live
  token exchange requires user-configured secret/client ID and portal redirect;
  no real broker exchange or trading has been performed by the agent.
- User subsequently confirmed successful live login and account API reads.
  This is user-reported verification; HOLD remains active.
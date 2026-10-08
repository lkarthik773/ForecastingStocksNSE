# Kite Integration API

HOLD is enforced in code, not an environment toggle. Account endpoints are
read-only. An authenticated `POST /api/kite/preview` can create a forecast-gated
NSE CNC limit-order preview, but cannot place, modify, cancel or convert an
order. Existing orders/trades can be read without changing them.

## Local Setup

1. Create an ignored `.env.kite` using `config/examples/.env.kite.example` as the template.
2. Set `KITE_USERS_JSON` with a username label, random service `apiToken`,
   `kiteApiKey`, `kiteApiSecret` and expected `kiteUserId` for each user.
   `kiteUserId` is the actual Zerodha client ID, not the username label.
   `kiteAccessToken` can be empty when login is configured. Generate the service
   token from at least 32 random bytes, encoded as base64url. A valid existing
   access token can alternatively be used without enabling login.
3. In the Kite developer console, register the exact redirect URL:
   `http://127.0.0.1:3102/auth/kite/callback`. This is the default for local
   settings; use `KITE_REDIRECT_URL` for explicit configuration. Legacy root
   redirects are supported only with `KITE_REDIRECT_URL=http://127.0.0.1:3102/`.
   The scheme, host, port and path must match. Do not mix localhost and 127.0.0.1.
4. Run `npm run start:kite`, then open `http://127.0.0.1:3102/docs`.
5. Click **Authorize**, enter your service `apiToken` without a `Bearer` prefix,
   then authorize and close the dialog. Never enter the Kite access token here.
6. Execute `GET /api/kite/login`. Open its returned `loginUrl` in the same
   browser within five minutes and sign in directly on Kite. Browser cookies
   must be enabled; do not switch browser profiles or use incognito for the
   returned URL. Do not share the login URL or callback query parameters.
7. Successful login redirects back to Swagger. Authorize again (authorization
   is intentionally not persisted across reloads), then execute
   `GET /api/kite/connection` using **Try it out** and **Execute**.
   Success returns the Kite profile. Other account reads work the same way.
   The preview endpoint accepts a JSON body and never submits an order.

The entry point explicitly loads `.env.kite`; `KITE_ENV_FILE` can override its
path. Deployment environment variables take
precedence. Do not commit that file or share its contents in chat. Protect its
filesystem permissions and use the hosting secret manager in production.
The service never accepts a username/account override in request parameters.
Separate service API tokens select separate administrator-provisioned connections.
Kite API secret stays exclusively on the backend. Password and OTP entry happens
only on the official Kite page and is never handled by this service.
Swagger assets are local and the specification is at `/openapi.json`. Swagger
does not persist authorization across reloads or use an external validator.
Its request/response display contains private data: log out and close the page
after use; do not share screenshots containing tokens or account details.

## Endpoints

All account/login-start endpoints use GET and require authentication. `/health` and the
credential-free documentation assets/specification are unauthenticated; docs
still enforce the configured host and browser origin. The callback accepts no
bearer header; instead it requires single-use login state plus the browser's
HttpOnly SameSite=Lax cookie. HTTPS deployments use host-only Secure cookies.
`POST /api/kite/preview` requires the service bearer token and JSON. It is the
only supported POST route; every broker write request remains rejected.

| Path | Result |
| --- | --- |
| `/health` | Process health; does not verify Kite connectivity |
| `/api/kite/status` | Authenticated user and enforced HOLD status |
| `/api/kite/login` | User-bound Kite login URL and browser-binding cookie |
| `/auth/kite/callback` | Broker redirect handler; never call manually |
| `/api/kite/connection` | Real connectivity check through the profile API |
| `/api/kite/profile` | Account profile |
| `/api/kite/margins` | Available funds/margins |
| `/api/kite/holdings` | Delivery holdings |
| `/api/kite/positions` | Day/net positions |
| `/api/kite/orders` | Today's existing orders |
| `/api/kite/trades` | Today's existing executed trades |
| `POST /api/kite/preview` | Forecast-gated CNC limit-order preview only |

The preview requires symbol, `BUY`/`SELL`, positive whole-share quantity and a
positive limit price; horizon is optionally `next_day` or `week`. It requests
the explicit technical-indicator NSE forecast internally. It is blocked unless
the forecast signal and direction match the requested side, the model beats
the no-change baseline, the backtest has at least 30 samples and 55% directional
accuracy, the forecast is under 15 minutes old, the last close is at most 10
calendar days old, and the context risk flag is explicitly clear. Estimated
notional cannot exceed INR 10,000. An eligible response contains
`previewOnly: true`, `mode: HOLD` and `tradingEnabled: false`; it does not
submit anything to Kite. A blocked preview returns HTTP 422 with the failed
safety checks and forecast diagnostics, including signal, estimated direction,
projected value, close date, forecast age, risk flag, and measured backtest
metrics such as samples, directional accuracy and model-vs-naive errors.
Available holdings, price tick-size, liquidity and intraday
conditions are not yet validated.

Missing/invalid service authentication returns 401. Broker authentication or
permission failures return 424; rate limits return 429; other broker failures
return sanitized 502 errors. Broker writes and unsupported methods return 405.
Blocked previews return 422; malformed preview bodies return 400; unsupported
body types return 415 and oversized bodies return 413. Account responses are
not cached.
Login configuration errors return 409; invalid, expired or replayed callbacks
return 400. The callback exchanges the request token using the official checksum
and checks the returned API key and client ID before installing the access token.
Tokens are retained in process memory only, never returned to the browser or
written to environment files. A restart discards exchanged sessions; log in again
or configure a separately provisioned valid token. Normal tokens expire at 6 AM
the next day and can also be invalidated earlier. Repeat the Swagger login flow
to renew; no automated password/OTP login or refresh-token assumptions are made.

## Hosting And Next Steps

Render is the intended target; hostname and identity provider are not decided.
Do not deploy publicly yet. Future deployment needs `KITE_HOST=0.0.0.0`,
`KITE_PORT` matching the platform port, and `KITE_PUBLIC_ORIGIN=https://<hostname>`.
TLS must terminate at a trusted proxy; prevent direct public access to the HTTP
listener and preserve the configured Host. Browser cross-origin access is not
enabled. Configure edge request limits and redact Authorization headers and
account-response bodies and callback query strings in infrastructure logs.

Production application identity, encrypted persistent per-user token storage,
multi-instance session coordination and operational auditing remain future work.
Pending login state and sessions are process-local; use one service instance for
controlled testing. Administrator-provisioned
bearer tokens are for controlled initial testing, not public user registration.
Broker URLs are configurable but pinned to the official HTTPS origin to prevent
credential forwarding; HTTP redirects and environment HTTP proxies are disabled.

Verification: `npm run test:kite` and `npm run typecheck:kite`.
Feature handoff: [Kite context](CONTEXT.md).
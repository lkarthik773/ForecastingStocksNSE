# Checkpoint: Render Explorer Deployment

Date: 2026-10-06

Living context: [Development Context](../DEVELOPMENT_CONTEXT.md).
Status: implemented in the shared working tree; not committed or deployed.

## Change

- Render's previous `node dist-cjs/index.js` start command ran library exports
  and exited without opening a listener. `npm start` now runs the Explorer.
- Public hosting is opt-in through `RENDER_EXTERNAL_URL` or
  `EXPLORER_PUBLIC_ORIGIN`; the latter overrides the former for custom domains.
- Hosted mode listens on `0.0.0.0` by default and uses Render's `PORT`.
  Explicit `HOST` overrides the bind address. Local mode remains loopback-only.
- Exact public Host and browser Origin checks support HTTPS proxy termination
  without trusting arbitrary forwarded headers. They are not authentication.
- `GET /health` is a host-independent process check with no exchange calls.
- A Render Blueprint and manual deployment settings use npm and retain dev
  dependencies required for tsx and browser icons. Python LightGBM installation,
  access control, and exchange cloud-IP restrictions remain separate concerns.

## Verification

- `npm run test:explorer`: 13 tests passed, covering hosted pages, catalogue,
  API calls, health checks, rejected hosts/origins, and local-only defaults.
- Actual Render deployment and live cloud exchange access are not verified.
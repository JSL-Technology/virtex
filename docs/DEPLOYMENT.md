# Deployment

How a Virteex environment is built from source. Everything here is executable — if a step in this
document does not work, the step is wrong, not the reader.

## What changed and why it matters

Three things used to make a reproducible deployment impossible:

- **No baseline migration.** The schema only existed where somebody had once run TypeORM's
  `synchronize`. `migration:run` against an empty database failed on the first foreign key,
  because every migration in the folder extended tables that nothing created. There is now a
  `BaselineSchema` migration generated from the entity definitions, and `npm run check:schema-drift`
  proves in CI that it stays in step with them.
- **No production frontend environment.** `environment.ts` shipped `production: false` and
  `apiUrl: 'http://localhost:3000/api/v1'`, and the production build configuration had no
  `fileReplacements`, so a production bundle pointed at the developer's own machine.
  `tools/generate-environment.mjs` now writes the real values before the build and fails loudly
  when they are missing.
- **`npm ci` did not resolve.** `dockview-angular` declares a peer dependency on Angular ≥ 21
  while the workspace is on Angular 20 (which is what `@nx/angular` 22.1.3 supports). The peer is
  pinned through `overrides` in `package.json`; the API surface actually consumed — `DockviewApi`,
  `DockviewComponent`, `DockviewGroupPanel`, `IDockviewPanel` — is stable across that range.

## Prerequisites

| Component  | Version | Notes |
| ---------- | ------- | ----- |
| Node.js    | 20.x    | Pinned by `.nvmrc` and `engines`. |
| PostgreSQL | 16+     | `uuid-ossp` and `pgcrypto` are created by the baseline migration. |
| Redis      | 6+      | Sessions, rate limiting, plan-limit counters. |

## 1. Configure the backend

Copy `.env.example` to `.env` and fill it in. The application validates its configuration at boot
and refuses to start when a required value is missing or looks like a placeholder — a process that
cannot authenticate securely must not accept traffic.

Generate each secret independently:

```bash
openssl rand -hex 32
```

`NODE_ENV` must be exactly `development` or `test` for the built-in development fallbacks to be
available. Every other value — including unset — is treated as a real deployment.

## 2. Run the migrations

```bash
npm run migration:run
```

Safe on an empty database and on one that predates the baseline: the baseline detects an existing
schema and adopts the migration history without touching anything.

To verify the migrations and entities still agree (this is what CI runs):

```bash
npm run check:schema-drift
```

## 3. Build the frontend

The production bundle needs deployment-specific values compiled into it:

```bash
export API_URL="https://api.example.com/api/v1"
export RECAPTCHA_V3_SITE_KEY="6Lc..."
export VAPID_PUBLIC_KEY="B..."        # optional; omit to disable web push

npm run build:client-web
```

`build:client-web` runs `tools/generate-environment.mjs` first. It fails the build — rather than
substituting a default — when `API_URL` or `RECAPTCHA_V3_SITE_KEY` is missing, and rejects a
non-HTTPS `API_URL`, because session cookies are issued `Secure` and a plain-HTTP API can never
hold a session.

## 4. Same-ORIGIN requirement

**The API and the web client must be served from the same origin.**

This section previously said "same site" and offered "a subdomain fronted by the same origin" as an
option. Same-site is not sufficient, and the subdomain wording was ambiguous enough to be read as
`api.example.com` alongside `app.example.com`, which does not work. Two independent reasons:

1. **Session cookies.** They are `HttpOnly; Secure; SameSite=Lax`, and a browser does not attach
   `SameSite=Lax` cookies to cross-site XHR at all.
2. **The CSRF cookie.** It is issued as `__Host-XSRF-TOKEN`, which by definition carries no
   `Domain` attribute — it is host-only. The SPA reads it from `document.cookie` on its OWN origin
   and copies it into the `X-XSRF-TOKEN` header. Served from a different host, the client cannot
   see the cookie, sends no header, and every state-changing request answers `403 Invalid CSRF
   Token`. The prefix is not optional: without it a compromised sibling subdomain could overwrite
   the cookie, which is precisely what the signed double-submit exists to prevent.

Supported topologies:

- A path prefix on the same origin: `https://app.example.com/api/v1` (recommended).
- A reverse proxy that fronts both the SPA and the API under one hostname.

Not supported: the client on one host and the API on another, whatever the shared registrable
domain. Note that the repository README describes deploying `client-web` to Render as a standalone
static site — that is a separate origin, and authentication cannot work that way.

Set `CORS_ORIGIN` and `FRONTEND_URL` to the client's origin, and `API_URL` to the API's base URL
including the version prefix.

## 4b. Identity-provider redirect URIs

Every OIDC provider — the built-in social ones and each customer's enterprise IdP — must have BOTH
of these registered:

- `{API_PUBLIC_URL}/auth/{provider}/callback` (or `/auth/sso/{idpId}/callback`) — sign-in.
- `{API_PUBLIC_URL}/auth/step-up/sso/callback` — **re-authentication for sensitive actions.**

The second one is new. Accounts provisioned through SSO have no local password and no TOTP secret,
so they cannot answer a password or OTP step-up challenge; they re-authenticate against their own
identity provider with `prompt=login`. Without this redirect URI registered, an SSO tenant's
administrators cannot invite users, edit them, revoke sessions, create subsidiaries, open the
billing portal or change their own email.

Set `CORS_ORIGIN` and `FRONTEND_URL` to the client's origin, and `API_URL` to the API's base URL
including the version prefix.

## 5. Reverse proxy

Set `TRUST_PROXY` to match the deployment:

| Value            | Meaning |
| ---------------- | ------- |
| unset            | `1` in production, `false` in development. |
| `1`, `2`, …      | Trust exactly N proxy hops. Use `2` when chaining a CDN in front of a load balancer. |
| `10.0.0.0/8,…`   | Trust only these proxies. The most precise option. |
| `true`           | Trust every hop. Only safe when the app is unreachable except through the proxy. |

Getting this wrong is not cosmetic: without it `request.ip` is the proxy's address for every
request, which collapses rate limiting into one shared bucket, misattributes account lockouts, and
defeats impossible-travel detection.

## 6. Stripe

Point a webhook endpoint at `POST {API_URL}/payment/webhook` and subscribe it to at least:

```
checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

Put its signing secret in `STRIPE_WEBHOOK_SECRET`. Plans and their limits are provisioned by
migration, so no seeding flag is involved; the Stripe price ids belong in `STRIPE_PRICE_*`.

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
| Redis      | 6+      | Sessions, rate limiting, plan-limit counters, job queues. |
| pgvector   | 0.5+    | Optional. Enables duplicate-product detection by photo. |
| Python     | 3.12    | Only for the AI engine container (`apps/ai-engine`). |

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

`migration:run` first runs `migration:reconcile` (`tools/db/reconcile-migration-renames.mjs`). It
rewrites the recorded identity of every migration that was renamed after it shipped, as listed in
`tools/db/migration-renames.json`, so a renamed migration is recognised as applied instead of
running twice. It is idempotent and does nothing on an empty database. If you run TypeORM directly
instead of through `npm run migration:run`, run `npm run migration:reconcile` first.

Every migration must have a unique 13-digit timestamp that matches its class name;
`npm run verify:migration-identities` enforces it in CI. To rename a migration that has shipped,
rename the file and class, then append the old and new identity to `migration-renames.json`.

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

## 7. AI platform

Everything here is optional: without it every screen works by hand, and the AI-assisted parts
answer 503 or stay hidden. The architecture and the reasoning behind each model are in
`docs/IA_PLAN_MAESTRO.md`.

### 7.1 API settings

| Variable                                                          | Purpose                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                                               | Enables photo-to-product and anomaly explanations. Server-side only.                  |
| `AI_MODEL_VISION`, `AI_MODEL_NARRATIVE`, `AI_MODEL_DEEP_ANALYSIS` | Model per feature; defaults `claude-opus-5-5`, `claude-opus-5-5`, `claude-fable-5-1`. |
| `VOYAGE_API_KEY`                                                  | Image embeddings for duplicate detection (needs pgvector).                            |
| `AI_ENABLED=false`                                                | Turns every model call off without removing the key.                                  |
| `AI_OPEN_FOOD_FACTS_ENABLED=true`                                 | Looks scanned barcodes up in Open Food Facts; only the barcode is sent. Off by default. |

Every call is metered against the plan's `ai_credits` and recorded in `ai_requests` (tokens, cost,
latency, outcome — never the user's input). The plan features `ai_vision`, `ai_forecasting` and
`ai_anomalies` gate the screens.

### 7.2 Database

The `AiPlatform` migration creates the role the engine connects as, `virtex_ai_engine`, with no
BYPASSRLS: it reads the source tables and writes only the `ai_*` tables it produces. Give it a
password before migrating, the same way `virtex_app` gets one:

```bash
AI_ENGINE_DB_PASSWORD='…' npm run migration:run
```

If the database offers the `vector` extension, the migration installs it and creates
`product_embeddings`; if not, it skips that table and everything else still applies.

### 7.3 The engine

The forecasting and anomaly engine is a Python worker that consumes the `ai-engine` BullMQ queue
from the same Redis as the API. It holds no state, so it scales by running more replicas.

```bash
docker build -t virtex-ai-engine apps/ai-engine
docker run \
  -e AI_ENGINE_DB_HOST=… -e AI_ENGINE_DB_NAME=… -e AI_ENGINE_DB_PASSWORD=… \
  -e REDIS_HOST=… -e REDIS_PORT=6379 [-e REDIS_PASSWORD=… -e REDIS_TLS=true] \
  virtex-ai-engine
```

| Variable                      | Default            | Purpose                                                                                    |
| ----------------------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| `AI_ENGINE_DB_USER`           | `virtex_ai_engine` | Never the application's role, never the schema owner.                                      |
| `AI_ENGINE_CONCURRENCY`       | `1`                | Tenants processed at once per replica.                                                     |
| `AI_ENGINE_MAX_SERIES`        | `20000`            | Series modelled individually per tenant; the slowest movers beyond it are averaged.        |
| `AI_ENGINE_FOUNDATION_MODELS` | `false`            | Chronos-Bolt zero-shot forecasts for new products; needs the `foundation` extra (PyTorch). |

The API queues a forecasting and an anomaly run per entitled tenant every night at 02:17 server
time, and on demand from the screens. A run that never finishes is marked failed after six hours;
the screens keep showing the last good results meanwhile.

When a run finishes, the API announces what it found — products at risk of stocking out, new
high-severity anomalies — in the notification bell of the people allowed to see them, once per run
whatever the number of API replicas. It hears the engine through BullMQ's job events; a sweep every
three hours covers any it missed.

To decide which forecasting model to trust on a tenant's own data, run the benchmark from the
engine image (read-only, as the engine role):

```bash
docker run --rm -e AI_ENGINE_DB_HOST=… -e AI_ENGINE_DB_NAME=… -e AI_ENGINE_DB_PASSWORD=… \
  virtex-ai-engine virtex-ai-benchmark --organization <uuid> --windows 3 --output /tmp/report.json
```

It compares the engine's ensemble with LightGBM (with and without holiday, price and promotion
drivers) and a seasonal-naive baseline — and Prophet and CatBoost when the image is built with the
`benchmark` extra — by WAPE, MASE, bias, P10–P90 coverage and run time.

### 7.4 Phases 2–5: what else runs, and when

All of it is gated by plan features in `saas.config` (`ai_assistant`, `ai_cashflow`,
`ai_reconciliation`, `ai_collections`, `ai_manager_reports`, `ai_agents`; off on starter) and by
permissions; every model call still goes through the gateway and its credits.

| What                                   | When                                                   | Notes                                                                                                       |
| -------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Cash-flow projection (`CASHFLOW`)      | nightly with the other runs, 02:17                     | Starts from today's cash in the ledger; a shortfall chance ≥ 30 % is announced in the bell.                 |
| Manager's monthly report               | 1st of the month, 06:41, for the month that ended      | Written on the `ai-reports` queue by the deep-analysis model; announced to `ai_reports:view` holders.       |
| Duplicate scan (customers, suppliers, products) | Sundays 03:23                                  | No model call; runs for every plan.                                                                         |
| Replenishment agent                    | daily 07:13, only where a company turned it on         | Writes draft purchase orders (or sends them for approval within the company's limit); never to a supplier. |
| In-app help index                      | when the API starts                                    | `ai/help/articles/*.md` ship in the bundle (`help/`) and are synced into `ai_knowledge_chunks`.            |

Each scheduled job claims its slot with the scheduler lock, so any number of API replicas runs it
once. Reports are processed by the API itself (queue `ai-reports`), not by the Python engine.

Migrations added in these phases: `AiCopilot`, `VendorBillAttachments`, `AiKnowledge`, `AiCashflow`,
`ReconciliationSettings`, `Collections`, `AiDuplicateSuggestions`, `AiAgents` — all tenant tables with
forced row-level security. `AiCashflow` grants the engine role read access to the receivables,
payables and payroll sources it simulates from.

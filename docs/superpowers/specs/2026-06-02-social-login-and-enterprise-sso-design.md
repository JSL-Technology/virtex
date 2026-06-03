# Social Login + Enterprise SSO — Design Spec

- **Date:** 2026-06-02
- **Status:** Approved (implementation in progress)
- **Scope:** Add social login (Google, Microsoft) and vendor-neutral enterprise SSO to the existing IAM, without replacing it.

## Guiding principle

The existing in-house IAM remains the **single source of truth**. External identity
providers (Google, Microsoft, and per-tenant enterprise IdPs) act as **single-use
verifiers**: they confirm the user controls an email address once, then step aside.
All session issuance (JWT, cookies, roles, 2FA, `tokenVersion`) is done by the
existing code via `SocialAuthService` / `TokenService`. If any provider is down,
email/password login keeps working. The app never delegates its IAM to an external service.

## Root cause being fixed

The app runs on **Fastify** (`main.ts` uses `FastifyAdapter`), but the previous social
login used Passport strategies configured with `state: true`, which requires server-side
**session** support to store the OAuth `state`. Only `@fastify/cookie` is registered — no
session middleware — so the OAuth callback fails with *"OAuth 2.0 authentication requires
session support"*. **Social login was effectively broken.** Additionally, Okta used the
dead `passport-okta-oauth@0.0.1` package.

## Shared technical foundation

- **`openid-client` v5** (CommonJS, OpenID-certified) replaces the three Passport strategies.
- **Stateless handshake**: generate `state` + `nonce` + **PKCE (S256)**, store them in a
  short-lived (5 min) **encrypted + signed httpOnly cookie** (`oauth_tx`, AES-256-GCM).
  No server session → horizontally scalable with no shared session store. This fixes the
  Fastify bug.
- **Full `id_token` validation**: signature via the issuer JWKS, plus `iss` / `aud` /
  `exp` / `nonce`.
- IdP / handshake errors redirect to `FRONTEND_URL/auth/login?error=<code>` without leaking detail.
- All token delivery stays cookie-only, reusing `CookieService`.

## Phase 1 — Global social login (Google + Microsoft) — DELIVERED FIRST

New backend units:
- **`OauthStateService`** — builds and verifies the `oauth_tx` transaction cookie
  (`state`, `nonce`, PKCE `code_verifier`, provider). AES-256-GCM encryption keyed from
  `OAUTH_STATE_SECRET` (+ `AUTH_SALT`), authenticated. Tampered/expired cookie ⇒ reject.
- **`OidcProviderService`** — lazily discovers and caches an `openid-client` `Client` per
  provider from env. Google issuer `https://accounts.google.com`; Microsoft issuer
  `https://login.microsoftonline.com/<tenant>/v2.0` (`MICROSOFT_TENANT`, default `common`).

Controller (Passport removed for social):
- `GET /auth/:provider` → validate provider ∈ allowlist, build authorization URL, set
  `oauth_tx`, redirect.
- `GET /auth/:provider/callback` → read `oauth_tx`, validate `state`, exchange `code` with
  PKCE, validate `id_token`, map claims → `SocialUser` (with real `email_verified`), clear
  cookie, delegate to existing `handleSocialCallback`.

Unchanged downstream: `SocialUser`, `SocialAuthService` (M-02 anti-hijacking, hashed-PII
audit), social register-token flow, `CookieService`.

Env: `GOOGLE_CLIENT_ID/SECRET/CALLBACK_URL`, `MICROSOFT_CLIENT_ID/SECRET/CALLBACK_URL`,
`MICROSOFT_TENANT=common`, new `OAUTH_STATE_SECRET`. Remove global Okta vars.

Deps: **+** `openid-client`; **−** `passport-google-oauth20`, `passport-microsoft`,
`passport-okta-oauth` (+ `@types`).

Frontend: `social-auth-buttons` keeps Google + Microsoft, replaces the Okta button with a
generic **"Sign in with your company (SSO)"** entry that opens the email-based SSO discovery
flow. Existing `socialLogin()` redirect (`/api/v1/auth/:provider`) is unchanged.

## Phase 2 — Vendor-neutral enterprise SSO (per-tenant)

- **`IdentityProvider`** entity (per `Organization`): `type=oidc`, `issuerUrl`, `clientId`,
  `clientSecret` (**encrypted at rest** via a `CryptoService` keyed by `ENCRYPTION_SECRET`),
  `scopes`, `enabled`, `defaultRoleId`, claim→role mapping.
- **`OrganizationDomain`** entity: verified email domains, used for tenant resolution.
- **Home Realm Discovery**: `POST /auth/sso/discover` takes an email, resolves the org by
  verified domain, returns the SSO start URL. `GET /auth/sso/:idpId` / callback reuse
  `OauthStateService` + `openid-client`.
- **JIT provisioning**: map/create the `User` inside the resolved org in the existing IAM,
  with the IdP's default role. Reuses `SocialAuthService` linking rules.
- Works with any OIDC IdP: Okta, Microsoft Entra, Google Workspace, Ping, OneLogin, Auth0.

## Phase 3 — Admin UI + domain verification

- CRUD of `IdentityProvider` for each organization's admin.
- Domain ownership verification via **DNS TXT** record (anti-takeover control) before an
  SSO config can be enabled.
- "Test connection" action.

## Phase 4 — SAML (optional / future)

For legacy IdPs (ADFS, older Ping) via `@node-saml`, if an enterprise customer requires it.
Out of scope for the initial delivery.

## Cross-cutting security

PKCE + state + nonce + `id_token` signature validation everywhere; IdP secrets encrypted at
rest; mandatory domain verification before enabling SSO; respect IdP `email_verified` for
linking (existing M-02 rule); rate-limiting on start/discovery endpoints; strict
provider/idpId allowlisting to prevent SSRF / open-redirect.

## Testing (Phase 1)

Unit: `OauthStateService` (state/nonce/PKCE round-trip; tampered cookie ⇒ reject); claim →
`SocialUser` mapping per provider; invalid provider rejected. Existing `SocialAuthService`
specs retained.

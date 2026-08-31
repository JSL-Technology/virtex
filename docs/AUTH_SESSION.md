# Session bootstrap

How the SPA answers "who is signed in?" on every page load, and why it is shaped this way.

## The problem this replaced

The client used to ask `GET /auth/status`, an endpoint guarded like a protected resource. For a
visitor who was not signed in — the normal state of the login screen — it answered **401**. The
client could not tell that apart from "your access token expired two minutes ago", so it responded
to both by firing `POST /auth/refresh` to find out. For a signed-out browser that request could
only fail too: **400** with no cookie, **401** with a dead one, **403** when the CSRF token was
missing.

And it did this several times per page load. `checkAuthStatus()` had no de-duplication and reset
the auth state to `pending` on entry, defeating the caching the guards were written to do, so the
app initializer and each `canActivateChild` evaluation — Angular runs those once per nested child
level — each paid for a full round trip. Opening `/es/auth/login` produced:

```
GET  /api/v1/auth/status   401   ×3
POST /api/v1/auth/refresh  403   ×3
```

None of it indicated a fault. An error rate that is always red is an error rate nobody reads.

## The contract

### `GET /api/v1/auth/session`

Public, `Cache-Control: no-store`, and it **always answers 200**. Signed out is an answer, not a
failure.

```jsonc
{
  "authenticated": false,   // a valid access token accompanied the request
  "user": null,             // the principal, re-read from the source of truth
  "refreshable": true       // POST /auth/refresh can succeed — do not call it otherwise
}
```

It also **reissues the CSRF cookie**, bound to whoever turned out to be signed in (`anon` when
nobody is). That closes a real gap: the token used to be minted only alongside a session, so a
browser holding a session cookie but no readable `XSRF-TOKEN` — cleared cookies, a rotated
`CSRF_SECRET`, a token bound to a user who has since signed out — could never satisfy `CsrfGuard`
again. `POST /auth/refresh` answered 403 for the rest of that cookie's life and the only way out
was clearing site data by hand. That state now repairs itself on the next page load.

`authenticated` is resolved by `OptionalJwtAuthGuard`, which runs the very same `JwtStrategy` as
every protected route and reports the absence of a principal instead of rejecting the request. An
expired or tampered token is therefore indistinguishable from no token: both are simply "not
authenticated". There is no second, weaker verification path to drift out of sync with the real
one.

### `POST /api/v1/auth/refresh`

Unchanged in purpose, but it now leaves the browser in a coherent state on every failure: a
request with no refresh cookie answers 401 (not 400 — the request is well formed, it just carries
nothing to renew), and any rejection clears the auth cookies. Without that, a marker cookie could
outlive its refresh token and report `refreshable` on every bootstrap for the rest of its life,
each one ending in the same failure.

## Cookies

| Cookie | Path | HttpOnly | Lifetime | Purpose |
| --- | --- | --- | --- | --- |
| `__Host-access_token` | `/` | yes | access-token TTL | the credential |
| `__Secure-refresh_token` | `/api/v1/auth/refresh` | yes | refresh TTL (longer with "remember me") | renewal, scoped so it is not attached to every API call |
| `__Host-XSRF-TOKEN` | `/` | **no** | ≥ refresh TTL | signed double-submit; the SPA copies it into `X-XSRF-TOKEN` |
| `__Host-auth_session` | `/` | yes | exactly the refresh cookie's | presence flag: "this browser holds a refresh token" |

In local plain-HTTP development every name drops its prefix, because browsers reject the `Secure`
attribute the prefixes mandate. Both names are read everywhere, so switching `NODE_ENV` cannot
strand a browser holding cookies written under the other one.

### Why the marker cookie exists

The refresh cookie is deliberately path-scoped to `POST /auth/refresh`, so a long-lived credential
is not attached to every API call. The cost is that no other endpoint can see it — including the
one that has to tell the client whether a silent refresh is worth attempting. Without an answer
the client has only two options and both are wrong: never refresh (every expired access token
becomes a forced re-login) or always refresh (the 400/401/403 noise above).

The marker carries no authority. It is the constant `1`. Presenting it proves nothing and grants
nothing — `POST /auth/refresh` still demands the real refresh token and a valid CSRF token — and
it is not counted as a session cookie by `CsrfGuard`. It is `HttpOnly` regardless, because nothing
in the browser needs to read it. Its lifetime is the refresh cookie's, and both are cleared
together on sign-out and on any rejected refresh, so a stale marker cannot outlive what it
describes.

## The client

`AuthService.resolveSession()` is the only thing that ever issues a session request, and it
memoises its result. `provideAppInitializer` calls it once before the first route is evaluated;
every guard afterwards calls it too and gets the replayed answer synchronously. Every path that
establishes or ends a session — login, 2FA, passkey, signup, refresh, logout — replaces that memo
with an already-settled value, so the memo and the state signals cannot disagree.

`reloadSession()` forces a fresh read, for the screens that change the principal itself (enabling
a second factor, editing the profile). Routing never calls it.

What each case now costs:

| Situation | Requests | Console |
| --- | --- | --- |
| Never signed in (the login page) | `GET /auth/session` → 200 | clean |
| Signed in | `GET /auth/session` → 200 | clean |
| Access token expired, refresh alive | `GET /auth/session` → 200, `POST /auth/refresh` → 200 | clean |
| Signed out in another tab | `GET /auth/session` → 200 (`refreshable: false`) | clean |
| API down | `GET /auth/session` → 5xx | one warning, and the memo is dropped so the next navigation retries |

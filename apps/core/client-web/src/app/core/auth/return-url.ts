import { Injectable } from '@angular/core';
import { pathWithoutOrganization } from '../tenancy/active-organization.service';

/** Where the destination waits while the person signs in. */
const STORAGE_KEY = 'virtex.auth.return_url';

/**
 * How long a remembered destination stays valid.
 *
 * Long enough for a sign-in with a second factor, a password reset in another tab or an identity
 * provider that asks for consent; short enough that a link abandoned on the sign-in page does not
 * surprise someone who signs in for an unrelated reason later the same day.
 */
const TTL_MS = 30 * 60 * 1000;

/** First segments that are not the workspace: going "back" to them after signing in means nothing. */
const NON_WORKSPACE = new Set(['auth', 'payment', 'unauthorized']);

/** Workspace pages that are where a sign-in lands anyway; remembering them would change nothing. */
const LANDING_PATHS = new Set(['/', '/overview', '/dashboard']);

/**
 * The part of a URL the app may navigate to after signing in, or null when it must not.
 *
 * A destination that arrives from outside —the address bar, a `returnUrl` query parameter, a link
 * in an e-mail— is untrusted input. Navigating to it unchecked is an open redirect: a link to the
 * real sign-in page that, once the person has typed their password into it, sends them to a
 * look-alike site. So only a path on THIS origin is accepted:
 *
 *  - it must start with exactly one `/` — `//evil.example` and `/\evil.example` are
 *    protocol-relative to a browser, which is the classic way through a naive "starts with /" check;
 *  - it is resolved against the current origin and the result must still be on that origin, which
 *    also rejects `javascript:` and other schemes however they are encoded;
 *  - it must point into the workspace: back to the sign-in page itself would loop, and the
 *    language-prefixed public pages are not a destination someone was trying to reach.
 */
export function sanitizeReturnUrl(raw: unknown, origin = currentOrigin()): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return null;
  if (value.length > 2048) return null;

  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (url.origin !== new URL(origin).origin) return null;

  const segments = url.pathname.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  if (NON_WORKSPACE.has(first)) return null;
  // `/es/auth/login`, `/en/...`: the language-prefixed public site.
  if (/^[a-z]{2}$/i.test(first)) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}

/** Is this the page a sign-in lands on by default (with or without the company prefix)? */
export function isLandingUrl(url: string): boolean {
  const path = pathWithoutOrganization(url).split('?')[0].split('#')[0];
  return LANDING_PATHS.has(path === '' ? '/' : path);
}

/**
 * The page someone was trying to reach when they were asked to sign in.
 *
 * ## Why it is remembered at all
 *
 * A link —saved in the browser, pasted in a chat, sent in an e-mail— is a promise to show a
 * specific page. When the session had expired, the guard used to send the person to the sign-in
 * page and forget the link, so they signed in and landed on the home page, and the link had
 * to be found again by hand. Every product people bookmark keeps that promise.
 *
 * ## Why it travels twice
 *
 * As a `returnUrl` query parameter on the sign-in page, because that is visible and survives being
 * copied; and in `sessionStorage`, because the sign-in methods that leave the app —Google, SAML or
 * OIDC single sign-on— come back through the server, which lands on the workspace home and knows
 * nothing about the link. `sessionStorage` belongs to the browser tab, so the destination survives
 * that round trip in the tab that started it and never leaks into another.
 *
 * Every read goes through `sanitizeReturnUrl`, including the copy read back from storage: storage
 * is writable by any script on the origin, and the check is cheap.
 */
@Injectable({ providedIn: 'root' })
export class ReturnUrlService {
  /** Remember a destination. Returns the sanitized value, or null when it was not acceptable. */
  remember(raw: unknown): string | null {
    const url = sanitizeReturnUrl(raw);
    if (!url || isLandingUrl(url)) {
      this.clear();
      return null;
    }
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ url, at: Date.now() }));
    } catch {
      // Storage blocked (private mode, policy): the query parameter still carries it this far.
    }
    return url;
  }

  /** The remembered destination, without forgetting it. */
  peek(): string | null {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const stored = JSON.parse(raw) as { url?: unknown; at?: unknown };
      if (typeof stored.at !== 'number' || Date.now() - stored.at > TTL_MS) {
        this.clear();
        return null;
      }
      return sanitizeReturnUrl(stored.url);
    } catch {
      return null;
    }
  }

  /** The remembered destination, forgotten on the way out: a destination is used once. */
  consume(): string | null {
    const url = this.peek();
    this.clear();
    return url;
  }

  clear(): void {
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* nothing stored */
    }
  }
}

function currentOrigin(): string {
  return typeof location !== 'undefined' ? location.origin : 'http://localhost';
}

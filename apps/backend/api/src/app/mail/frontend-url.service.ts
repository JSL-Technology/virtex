import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Builds links into the web client.
 *
 * Every transactional link the product sent used to be constructed inline at its call site, and
 * every one of them was wrong. The client routes public pages under `/:lang/auth/*` and the
 * signup wizard under `/:lang/:country/auth/register`, but the backend emitted:
 *
 *   FRONTEND_URL + /auth/reset-password#token=…          (no :lang)
 *   FRONTEND_URL + /auth/set-password?token=…            (no :lang, and the page reads #token=)
 *   FRONTEND_URL + /es/auth/register?email_token=…       (no :country)
 *   FRONTEND_URL + /auth/register?social_registration…   (neither)
 *   FRONTEND_URL + /auth/login?error=…                   (no :lang)
 *
 * None of those paths match a route. They fall through to the authenticated shell, whose guard
 * redirects to the login page and discards the query string on the way — so password recovery,
 * user invitations and email confirmation all led nowhere, and OAuth errors were never shown.
 *
 * Routes are declared here once, as data, and `LinkBuilderSpec` in the client's route tests
 * asserts that each one resolves. A link that stops matching becomes a failing test rather than
 * a support ticket.
 */
@Injectable()
export class FrontendUrlService {
  /** Languages the client has translations for. Must match SUPPORTED_LANGS in app.routes.ts. */
  private static readonly SUPPORTED_LANGUAGES = ['es', 'en'] as const;
  private static readonly DEFAULT_LANGUAGE = 'es';

  /**
   * Country used when a link has no better information. The signup route requires a country
   * segment, and a missing one produces a URL that does not resolve.
   */
  private static readonly DEFAULT_COUNTRY = 'do';

  constructor(private readonly configService: ConfigService) {}

  private get origin(): string {
    return this.configService.getOrThrow<string>('FRONTEND_URL').replace(/\/+$/, '');
  }

  private language(preferred?: string | null): string {
    const candidate = (preferred ?? '').slice(0, 2).toLowerCase();
    return (FrontendUrlService.SUPPORTED_LANGUAGES as readonly string[]).includes(candidate)
      ? candidate
      : FrontendUrlService.DEFAULT_LANGUAGE;
  }

  private country(preferred?: string | null): string {
    const candidate = (preferred ?? '').slice(0, 2).toLowerCase();
    return /^[a-z]{2}$/.test(candidate) ? candidate : FrontendUrlService.DEFAULT_COUNTRY;
  }

  /**
   * Password reset.
   *
   * The token travels in the URL fragment, not the query string: fragments are never sent to a
   * server, so the token stays out of proxy logs, CDN logs and `Referer` headers
   * (RFC 3986 §3.5; OWASP ASVS 2.1.7; CWE-598).
   */
  passwordReset(token: string, language?: string | null): string {
    return `${this.origin}/${this.language(language)}/auth/reset-password#token=${encodeURIComponent(token)}`;
  }

  /**
   * Invitation acceptance.
   *
   * Also a fragment. This link used to carry `?token=` while the page read only `#token=`, so
   * even a correctly-routed invitation arrived with no token at all.
   */
  setPasswordFromInvitation(token: string, language?: string | null): string {
    return `${this.origin}/${this.language(language)}/auth/set-password#token=${encodeURIComponent(token)}`;
  }

  /** Registration email confirmation ("magic link"). Requires both segments. */
  confirmRegistrationEmail(token: string, language?: string | null, country?: string | null): string {
    return (
      `${this.origin}/${this.language(language)}/${this.country(country)}` +
      `/auth/register?email_token=${encodeURIComponent(token)}`
    );
  }

  /** Where a social sign-in lands when the account does not exist yet. */
  socialRegistration(language?: string | null, country?: string | null): string {
    return `${this.origin}/${this.language(language)}/${this.country(country)}/auth/register?social_registration=true`;
  }

  /** Login page, optionally carrying an error code for the banner. */
  login(errorCode?: string, language?: string | null): string {
    const base = `${this.origin}/${this.language(language)}/auth/login`;
    return errorCode ? `${base}?error=${encodeURIComponent(errorCode)}` : base;
  }

  /** Password-recovery request page. */
  forgotPassword(language?: string | null): string {
    return `${this.origin}/${this.language(language)}/auth/forgot-password`;
  }

  /** Landing page after a successful sign-in. */
  dashboard(): string {
    return `${this.origin}/dashboard`;
  }

  /**
   * Confirm an email-address change.
   *
   * Lands on the profile screen — where the change was requested — which reads the token from the
   * fragment and calls the confirm endpoint. The previous target,
   * `/settings/email-change/confirm`, is not a route: the change could be requested but never
   * applied, and the pending record simply expired.
   *
   * The confirm endpoint requires an authenticated session, so an unauthenticated visitor is
   * routed to sign in first and returns here afterwards.
   */
  confirmEmailChange(token: string): string {
    return `${this.origin}/settings/my-profile#email_change_token=${encodeURIComponent(token)}`;
  }

  /** Billing screen; also the return target for Stripe Checkout and the billing portal. */
  billing(withCheckoutSession = false): string {
    const base = `${this.origin}/settings/billing`;
    // The placeholder must stay literal — Stripe expands it when it redirects.
    return withCheckoutSession ? `${base}?session_id={CHECKOUT_SESSION_ID}` : base;
  }

  /** Post-payment landing for the payment-first signup. */
  checkoutComplete(): string {
    return `${this.origin}/auth/checkout-complete?session_id={CHECKOUT_SESSION_ID}`;
  }

  /**
   * Where the IdP re-authentication lands once a step-up proof has been issued.
   *
   * The cookie carrying the proof is already set by then; the page's job is to resume whatever
   * the user was doing. The scope travels so the client knows which pending action to retry.
   */
  stepUpComplete(scope: string): string {
    return `${this.origin}/settings/security?step_up=ok&scope=${encodeURIComponent(scope)}`;
  }

  /** Where it lands when the provider refused or the identity did not match. */
  stepUpFailed(): string {
    return `${this.origin}/settings/security?step_up=failed`;
  }

  /** Where Checkout returns when the visitor abandons signup. */
  registerCancelled(language?: string | null, country?: string | null): string {
    return `${this.origin}/${this.language(language)}/${this.country(country)}/auth/register`;
  }
}

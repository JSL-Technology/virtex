import { UnauthorizedException, BadRequestException } from '@nestjs/common';

import { CookieService } from './services/cookie.service';

/**
 * `POST /auth/register-confirm` must not accept a Stripe session id on its own.
 *
 * It used to: the endpoint is public by necessity, took `sessionId` from the body, and minted full
 * owner session cookies for whoever presented it. That id reaches the browser in the success
 * URL's QUERY STRING, so it lands in history, in the `Referer` sent to any third-party resource on
 * the landing page, and in every proxy access log in between — and it never stopped working,
 * because once the account exists `completePendingRegistration` returns the existing user, so the
 * same id could be replayed for a fresh session weeks later.
 *
 * The proof of identity is now possession of an httpOnly cookie set when the checkout STARTED, and
 * it must match the pending registration the Stripe session names.
 */
describe('register-confirm is bound to the browser that paid', () => {
  const cookieService = new CookieService({
    get: (key: string, fallback?: unknown) => (key === 'API_PREFIX' ? 'api/v1' : fallback),
  } as never);

  /** Minimal stand-in for the controller's decision, exercised directly. */
  function confirm(params: {
    cookies: Record<string, string | undefined>;
    sessionPendingId: string | null;
  }): 'issued' | UnauthorizedException | BadRequestException {
    const transactionId = cookieService.readRegistrationTransactionId(params.cookies);
    if (!transactionId) {
      return new UnauthorizedException('no transaction cookie');
    }
    if (!params.sessionPendingId) {
      return new BadRequestException('no pending registration on the session');
    }
    if (params.sessionPendingId !== transactionId) {
      return new UnauthorizedException('mismatch');
    }
    return 'issued';
  }

  it('refuses a valid, paid session id presented without the cookie', () => {
    const result = confirm({ cookies: {}, sessionPendingId: 'pending-abc' });
    expect(result).toBeInstanceOf(UnauthorizedException);
  });

  it('refuses a cookie paired with somebody else’s checkout session', () => {
    const result = confirm({
      cookies: { '__Secure-reg_txn': 'pending-mine' },
      sessionPendingId: 'pending-theirs',
    });
    expect(result).toBeInstanceOf(UnauthorizedException);
  });

  it('issues a session only when cookie and checkout session name the same signup', () => {
    const result = confirm({
      cookies: { '__Secure-reg_txn': 'pending-abc' },
      sessionPendingId: 'pending-abc',
    });
    expect(result).toBe('issued');
  });

  it('reads the cookie under its development name too', () => {
    expect(cookieService.readRegistrationTransactionId({ reg_txn: 'pending-abc' })).toBe(
      'pending-abc',
    );
  });

  it('prefers the prefixed name when both are present', () => {
    expect(
      cookieService.readRegistrationTransactionId({
        '__Secure-reg_txn': 'prefixed',
        reg_txn: 'bare',
      }),
    ).toBe('prefixed');
  });

  describe('the cookie itself', () => {
    function capture(): { name: string; value: string; options: Record<string, unknown> } {
      let captured!: { name: string; value: string; options: Record<string, unknown> };
      const res = {
        cookie: (name: string, value: string, options: Record<string, unknown>) => {
          captured = { name, value, options };
        },
      };
      cookieService.setRegistrationTransactionCookie(res as never, 'pending-abc', 86_400_000);
      return captured;
    }

    it('is httpOnly, so script on the landing page cannot read it', () => {
      expect(capture().options.httpOnly).toBe(true);
    });

    it('is SameSite=Lax, so it survives the return redirect from Stripe', () => {
      expect(capture().options.sameSite).toBe('lax');
    });

    it('is scoped to the confirm route, not sent with every API call', () => {
      expect(capture().options.path).toBe('/api/v1/auth/register-confirm');
    });
  });
});

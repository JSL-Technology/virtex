import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

interface ThrottledRequest {
  /** The client address as Fastify resolves it under the configured `trustProxy` allow-list. */
  ip?: string;
  /** After ActiveTenantGuard: the principal re-resolved for the company the request acts in. */
  user?: { id?: string; organizationId?: string | null } | null;
}

/**
 * Rate limits keyed by WHO asks, not by where the packet came from.
 *
 * The global guard used to be the library default: one bucket per client address, 20 requests a
 * minute, hard-coded. An office behind a single NAT shares one address, and a single screen of the
 * portal makes several requests — so a handful of colleagues working at once locked the whole
 * company out (audit 2026-10-31: 94 % of requests answered 429 with seven clients on one address).
 *
 * Now:
 *  - an authenticated request is counted against the person in the company they are acting in,
 *    so one user cannot exhaust their colleagues' allowance, and one tenant cannot exhaust
 *    another's;
 *  - an anonymous request (sign-in, sign-up, password recovery, public catalogues) is counted
 *    against the client address, which is the only identity it has. Those routes carry their own,
 *    much stricter `@Throttle` limits.
 *
 * It runs AFTER the authentication and active-tenant guards (see the order in `AppModule`), so the
 * principal and the company are already resolved when the key is built.
 */
@Injectable()
export class PrincipalThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const request = req as ThrottledRequest;
    const userId = request.user?.id;
    if (userId) {
      const organizationId = request.user?.organizationId ?? 'none';
      return `user:${userId}:org:${organizationId}`;
    }
    // `ip`, never the left-most `X-Forwarded-For` entry: that one is whatever the client wrote.
    return `ip:${request.ip ?? 'unknown'}`;
  }
}

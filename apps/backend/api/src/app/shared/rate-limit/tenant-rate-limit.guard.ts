import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { TooManyRequestsError } from '../../i18n/localized.exception';

export const TENANT_RATE_LIMIT = 'rate-limit:tenant';

export interface RateWindow {
  limit: number;
  /** Window length in milliseconds. */
  ttl: number;
}

export interface TenantRateLimitOptions {
  /** Per signed-in person, whatever address they come from. */
  perUser: RateWindow;
  /** Per company, across all of its people: what one tenant may spend of a shared, metered resource. */
  perOrganization: RateWindow;
  /** Groups routes that draw on the same resource, so their requests count together (e.g. `ai`). */
  bucket: string;
}

/**
 * Limits a route per person and per company rather than per IP address.
 *
 * The default throttler keys on the client address, which is the right key for signing in and the
 * wrong one for a metered resource: an office behind one NAT shares one quota, and one person with
 * several addresses has as many. A language model is metered by the company's plan, so it is
 * limited by who asks and for which company — the same distributed store the throttler uses (Redis
 * outside development), so the limit holds across replicas and restarts.
 *
 * Requests without a signed-in tenant user are refused here: every route this guards acts for one.
 */
export const TenantRateLimit = (options: TenantRateLimitOptions) => SetMetadata(TENANT_RATE_LIMIT, options);

@Injectable()
export class TenantRateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectThrottlerStorage() private readonly storage: ThrottlerStorage,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<TenantRateLimitOptions | undefined>(TENANT_RATE_LIMIT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) return true;
    const request = context.switchToHttp().getRequest<{ user?: { id?: string; organizationId?: string } }>();
    const userId = request.user?.id;
    const organizationId = request.user?.organizationId;
    if (!userId || !organizationId) throw new TooManyRequestsError('common.rate_limited', { seconds: 60 });

    const checks: Array<[string, RateWindow]> = [
      [`tenant-rl:${options.bucket}:user:${organizationId}:${userId}`, options.perUser],
      [`tenant-rl:${options.bucket}:org:${organizationId}`, options.perOrganization],
    ];
    for (const [key, window] of checks) {
      const record = await this.storage.increment(key, window.ttl, window.limit, 0, options.bucket);
      if (record.totalHits > window.limit) {
        throw new TooManyRequestsError('common.rate_limited', { seconds: Math.max(1, Math.ceil(record.timeToExpire)) });
      }
    }
    return true;
  }
}

/** The windows every route that calls a language model shares, in the `ai` bucket. */
export const AI_RATE_LIMIT = {
  bucket: 'ai',
  /** A person asking faster than one call every two seconds is a script, not a person. */
  perUser: { limit: 30, ttl: 60_000 },
  /** A whole company: enough for a busy office, not for a runaway integration. */
  perOrganization: { limit: 120, ttl: 60_000 },
} as const;

import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
import { TENANT_RATE_LIMIT, TenantRateLimitGuard, TenantRateLimitOptions } from './tenant-rate-limit.guard';

/** A throttler store in memory: hits per key within the window. */
function memoryStorage() {
  const hits = new Map<string, number>();
  return {
    increment: async (key: string) => {
      const totalHits = (hits.get(key) ?? 0) + 1;
      hits.set(key, totalHits);
      return { totalHits, timeToExpire: 42, isBlocked: false, timeToBlockExpire: 0 };
    },
  };
}

describe('TenantRateLimitGuard', () => {
  const options: TenantRateLimitOptions = { bucket: 'ai', perUser: { limit: 2, ttl: 60_000 }, perOrganization: { limit: 3, ttl: 60_000 } };
  const handler = () => undefined;
  Reflect.defineMetadata(TENANT_RATE_LIMIT, options, handler);
  const context = (user: { id: string; organizationId: string } | undefined) =>
    ({
      getHandler: () => handler,
      getClass: () => class Controller {},
      switchToHttp: () => ({ getRequest: () => ({ user, ip: '10.0.0.1' }) }),
    }) as unknown as ExecutionContext;

  it('limits a person, whatever address they come from, and a company across its people', async () => {
    const guard = new TenantRateLimitGuard(new Reflector(), memoryStorage() as never);
    const ana = { id: 'u-ana', organizationId: 'org-1' };
    const luis = { id: 'u-luis', organizationId: 'org-1' };
    await expect(guard.canActivate(context(ana))).resolves.toBe(true);
    await expect(guard.canActivate(context(ana))).resolves.toBe(true);
    await expect(guard.canActivate(context(ana))).rejects.toMatchObject({ messageKey: 'common.rate_limited', params: { seconds: 42 } });
    // Ana's refused request did not count against the company: Luis has exactly one left there.
    await expect(guard.canActivate(context(luis))).resolves.toBe(true);
    await expect(guard.canActivate(context(luis))).rejects.toMatchObject({ messageKey: 'common.rate_limited' });
    // Another company is untouched.
    await expect(guard.canActivate(context({ id: 'u-x', organizationId: 'org-2' }))).resolves.toBe(true);
  });

  it('refuses a request with no signed-in tenant user', async () => {
    const guard = new TenantRateLimitGuard(new Reflector(), memoryStorage() as never);
    await expect(guard.canActivate(context(undefined))).rejects.toMatchObject({ messageKey: 'common.rate_limited' });
  });
});

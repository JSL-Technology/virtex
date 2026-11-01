import { PrincipalThrottlerGuard } from './principal-throttler.guard';
import { envValidation as envValidationSchema } from '../../config/env.validation';

/**
 * The rate-limit key (audit 2026-10-31: one bucket per address, 20/min, locked whole offices out
 * behind a NAT). These pin who is counted together and who is not.
 */
describe('PrincipalThrottlerGuard key', () => {
  const guard = Object.create(PrincipalThrottlerGuard.prototype) as PrincipalThrottlerGuard;
  const tracker = (req: Record<string, unknown>) =>
    (guard as unknown as { getTracker(r: Record<string, unknown>): Promise<string> }).getTracker(req);

  it('counts two colleagues behind the same address separately', async () => {
    const a = await tracker({ ip: '200.1.1.1', user: { id: 'ana', organizationId: 'org-1' } });
    const b = await tracker({ ip: '200.1.1.1', user: { id: 'luis', organizationId: 'org-1' } });
    expect(a).not.toEqual(b);
  });

  it('counts the same person separately in each company they act in', async () => {
    const one = await tracker({ ip: '1.1.1.1', user: { id: 'ana', organizationId: 'org-1' } });
    const two = await tracker({ ip: '1.1.1.1', user: { id: 'ana', organizationId: 'org-2' } });
    expect(one).not.toEqual(two);
  });

  it('counts anonymous requests by the resolved client address, ignoring forwarded headers', async () => {
    const key = await tracker({ ip: '10.0.0.5', headers: { 'x-forwarded-for': '6.6.6.6' } });
    expect(key).toBe('ip:10.0.0.5');
  });
});

describe('rate-limit configuration', () => {
  it('refuses a TTL written in seconds (the old .env.example said 60)', () => {
    const { error } = envValidationSchema.validate({ NODE_ENV: 'development', THROTTLE_TTL: 60 }, { allowUnknown: true, abortEarly: false });
    expect(error?.message).toMatch(/THROTTLE_TTL/);
  });

  it('defaults to a limit a working office can live with', () => {
    const { value } = envValidationSchema.validate({ NODE_ENV: 'development' }, { allowUnknown: true });
    expect(value.THROTTLE_TTL).toBe(60_000);
    expect(value.THROTTLE_LIMIT).toBeGreaterThanOrEqual(300);
  });
});

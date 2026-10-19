import { SmsAbuseGuardService } from './sms-abuse.guard.service';

/**
 * QA A-10: every refused SMS read "could not be sent, try again", while the server knew it was the
 * per-number cap and for how long. The reason the person can act on now reaches them; the
 * anti-fraud caps proper still say nothing about which one fired.
 */
describe('SmsAbuseGuardService', () => {
  const store = new Map<string, unknown>();
  const cache = {
    get: jest.fn(async (k: string) => store.get(k)),
    set: jest.fn(async (k: string, v: unknown) => void store.set(k, v)),
  };
  const config = { get: jest.fn((_key: string, fallback?: unknown) => fallback) };
  const guard = new SmsAbuseGuardService(cache as never, config as never);

  beforeEach(() => store.clear());

  it('names the per-number cap and the wait until its window reopens', async () => {
    for (let i = 0; i < 5; i++) await guard.assertMaySend('+12025550147');
    const error = await guard.assertMaySend('+12025550147').catch((e) => e);

    expect(error.getStatus()).toBe(429);
    expect(error.code).toBe('SMS_NUMBER_LIMIT');
    expect(error.params.retryAfterSeconds).toBeGreaterThan(3500);
    expect(error.params.minutes).toBe(60);
  });

  it('keeps the window fixed from the first message, so retrying does not push it back', async () => {
    for (let i = 0; i < 6; i++) await guard.assertMaySend('+12025550148').catch(() => undefined);
    const [, entry] = [...store.entries()].find(([k]) => k.startsWith('sms:number:'))!;
    const first = (entry as { resetAt: number }).resetAt;
    await guard.assertMaySend('+12025550148').catch(() => undefined);
    const [, again] = [...store.entries()].find(([k]) => k.startsWith('sms:number:'))!;
    expect((again as { resetAt: number }).resetAt).toBe(first);
  });

  it('says a number outside the served markets cannot be texted', async () => {
    const error = await guard.assertMaySend('+447700900123').catch((e) => e);
    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('SMS_COUNTRY_NOT_SUPPORTED');
  });

  it('answers the fraud caps proper only with "SMS is unavailable"', async () => {
    // 100 messages to one carrier prefix in the hour: the per-prefix cap.
    for (let i = 0; i < 100; i++) {
      await guard.assertMaySend(`+1202555${String(1000 + i).padStart(4, '0')}`).catch(() => undefined);
    }
    const error = await guard.assertMaySend('+12025559999').catch((e) => e);
    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe('SMS_UNAVAILABLE');
  });
});

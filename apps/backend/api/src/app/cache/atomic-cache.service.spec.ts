import { AtomicCacheService } from './atomic-cache.service';

/**
 * QA R3-A08: a successful step-up never cleared the attempt budget, because `increment` counted on
 * the raw Redis key and `reset` deleted through Keyv's namespaced key. Five correct confirmations
 * locked an administrator out.
 */
describe('AtomicCacheService.reset', () => {
  const makeRedis = () => {
    const keys = new Map<string, number>();
    return {
      keys,
      set: jest.fn(),
      get: jest.fn(async (k: string) => (keys.has(k) ? String(keys.get(k)) : null)),
      incr: jest.fn(async (k: string) => {
        keys.set(k, (keys.get(k) ?? 0) + 1);
        return keys.get(k) as number;
      }),
      pExpire: jest.fn(async () => true),
      del: jest.fn(async (k: string) => (keys.delete(k) ? 1 : 0)),
    };
  };

  it('deletes the very key increment counted on, so the next attempt starts from one', async () => {
    const redis = makeRedis();
    const cacheManager = { stores: [{ store: { client: redis } }], del: jest.fn() } as never;
    const service = new AtomicCacheService(cacheManager, {} as never);
    service.onApplicationBootstrap();

    for (let i = 0; i < 5; i++) await service.increment('step-up-attempts:u1', 300_000);
    await service.reset('step-up-attempts:u1');

    expect(redis.del).toHaveBeenCalledWith('step-up-attempts:u1');
    expect(await service.increment('step-up-attempts:u1', 300_000)).toBe(1);
  });
});

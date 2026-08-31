import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import type { Cache } from 'cache-manager';

/** The two node-redis calls this service needs, named so no wider client is implied. */
interface AtomicRedisClient {
  set(
    key: string,
    value: string,
    options: { NX: true; PX: number },
  ): Promise<string | null>;
  incr(key: string): Promise<number>;
  pExpire(key: string, ms: number): Promise<boolean | number>;
}

/**
 * Cache operations whose correctness depends on being atomic.
 *
 * ## Why this is a service and not two private helpers
 *
 * `StepUpGuard` and `AuthService` each carried a private `redisClient()` that reached into
 * `cacheManager.store` looking for a client. With cache-manager 7 there is no `store` property at
 * all, so both always returned `null` and both always took their non-atomic in-memory fallback —
 * the branch each one's own comment describes as acceptable only "because that store is
 * single-process by construction".
 *
 * What those fallbacks protect is not a cache-hit rate:
 *
 *   - a single-use step-up token guards impersonation, account deletion and session revocation.
 *     Get-then-set lets two concurrent requests both observe "unused" and both proceed.
 *   - the step-up attempt budget is a brute-force limit. Read-then-write lets a burst of parallel
 *     guesses all observe the same low count.
 *
 * Both now go through one implementation, which finds the Redis client through Keyv's documented
 * accessor and — outside development — refuses to start if it cannot, rather than degrading to a
 * per-process approximation nobody would notice.
 */
@Injectable()
export class AtomicCacheService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AtomicCacheService.name);
  private client: AtomicRedisClient | null = null;

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    this.client = this.resolveClient();

    const isDevLike = ['development', 'test'].includes(
      (this.configService.get<string>('NODE_ENV') ?? '').toLowerCase(),
    );

    if (this.client) {
      this.logger.log({ event: 'atomic_cache_ready' }, 'Atomic cache operations backed by Redis.');
      return;
    }

    const message =
      'No Redis client is available for atomic cache operations. Single-use step-up tokens and ' +
      'the re-authentication attempt budget would be enforced per process, which is not ' +
      'enforcement at all in a multi-instance deployment.';

    if (isDevLike) {
      this.logger.warn({ event: 'atomic_cache_degraded' }, `${message} Continuing (development).`);
      return;
    }
    throw new Error(`FATAL: ${message}`);
  }

  /**
   * Claim a key exactly once. Returns true for the caller that won.
   *
   * `SET key value NX PX ttl` returns nil when the key already exists, so the check and the claim
   * are a single round trip and exactly one concurrent caller can win.
   */
  async claimOnce(key: string, ttlMs: number): Promise<boolean> {
    if (this.client) {
      const claimed = await this.client.set(key, '1', { NX: true, PX: ttlMs });
      return claimed === 'OK';
    }

    // Single-process fallback. Correct only where there is one process, which is why
    // `onApplicationBootstrap` refuses to reach this state outside development.
    if (await this.cacheManager.get(key)) return false;
    await this.cacheManager.set(key, 1, ttlMs);
    return true;
  }

  /**
   * Count one attempt and return the new total.
   *
   * The expiry is set on first use only, so the window starts at the first attempt rather than
   * sliding forward with every one — otherwise a steady trickle of guesses never resets.
   */
  async increment(key: string, windowMs: number): Promise<number> {
    if (this.client) {
      const attempts = await this.client.incr(key);
      if (attempts === 1) {
        await this.client.pExpire(key, windowMs);
      }
      return attempts;
    }

    const current = (await this.cacheManager.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.cacheManager.set(key, next, windowMs);
    return next;
  }

  /** Forget a counter — called when a challenge succeeds, so failures keep accumulating. */
  async reset(key: string): Promise<void> {
    await this.cacheManager.del(key);
  }

  /**
   * The Redis client behind the cache, through Keyv's own accessors.
   *
   * `cacheManager.stores` is the array of Keyv instances; a Keyv's `store` is the adapter, and
   * `@keyv/redis` exposes the node-redis client as `client`. Reached defensively because the
   * shape belongs to a dependency, and because the in-memory store legitimately has none.
   */
  private resolveClient(): AtomicRedisClient | null {
    const stores = (this.cacheManager as unknown as { stores?: unknown[] }).stores ?? [];

    for (const keyv of stores) {
      const adapter = (keyv as { store?: unknown }).store;
      const candidate = (adapter as { client?: unknown } | undefined)?.client;
      if (
        candidate &&
        typeof (candidate as AtomicRedisClient).set === 'function' &&
        typeof (candidate as AtomicRedisClient).incr === 'function' &&
        typeof (candidate as AtomicRedisClient).pExpire === 'function'
      ) {
        return candidate as AtomicRedisClient;
      }
    }
    return null;
  }
}

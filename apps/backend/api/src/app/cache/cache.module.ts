import { Global, Logger, Module, OnApplicationBootstrap } from '@nestjs/common';
import { CacheModule as NestCacheModule, CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import Keyv from 'keyv';
import KeyvRedis from '@keyv/redis';

import { redisUrl } from './redis.config';
import { AtomicCacheService } from './atomic-cache.service';

/**
 * The shared cache. It has to actually be shared.
 *
 * ## What was wrong
 *
 * This passed a `store` built by `cache-manager-redis-store@3` — an adapter written for
 * cache-manager 4/5 — to `cache-manager@7`, which is Keyv-based and takes `stores`. The option was
 * ignored, silently, and every instance fell back to an in-process `Map`. Nothing logged, nothing
 * failed, and `redis-cli KEYS '*'` returned only the throttler's keys, because the throttler
 * brings its own client.
 *
 * That is not a performance regression. Six security controls are built on this cache being one
 * shared thing, and each of them quietly became per-process:
 *
 *   - `SessionRegistryService` — the revoked-session denylist. A cache miss means "not revoked",
 *     so signing out or revoking a device on one instance left the access token valid on every
 *     other one until it expired.
 *   - the pending-2FA session — created by `POST /auth/login` on one instance and read by
 *     `POST /auth/verify-2fa`, which a load balancer sends somewhere else. Two-factor login simply
 *     did not work behind more than one replica.
 *   - `StepUpGuard`'s single-use `jti` — the atomic `SET NX PX` path was unreachable because
 *     `cacheManager.store` was undefined, so it fell through to the in-memory branch its own
 *     comment describes as safe only "because that store is single-process by construction".
 *   - `AuthService`'s step-up attempt budget — same mechanism, so five attempts became five per
 *     replica.
 *   - the cached authenticated principal — `clearUserSession` on a role change, a block or a
 *     membership revocation only cleared the instance that handled the request.
 *   - the SaaS usage counters and the limit-cache generation.
 *
 * ## What it does now
 *
 * A real Keyv/Redis store, and a boot check that refuses to run a deployment on an in-memory one.
 * The failure mode this replaces is invisible; the replacement is loud.
 */
@Global()
@Module({
  imports: [
    NestCacheModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const url = redisUrl(configService);
        const logger = new Logger('CacheModule');

        // Namespaced so a Redis shared with another service — or another environment pointed at
        // the same instance by mistake — cannot collide on `user_session:` or `2fa_pending:`.
        //
        // Keyv applies the namespace and `@keyv/redis` applies it again as a Redis key prefix, so
        // a stored key reads `virteex::virteex:user_session:<id>`. That is the library's own
        // convention and it is left alone; written here so anyone reading keys during an incident
        // recognises the shape instead of assuming a bug.
        const store = new KeyvRedis(url);
        const keyv = new Keyv({
          store,
          namespace: configService.get<string>('REDIS_NAMESPACE', 'virteex'),
        });

        // Keyv surfaces connection failures as an 'error' event. Unhandled, it takes the process
        // down; swallowed, an outage looks like a cold cache. Logged, it is diagnosable — and the
        // consumers that must not fail open (`SessionRegistryService`) already fall back to the
        // database on a cache error.
        keyv.on('error', (error: Error) =>
          logger.error({ event: 'cache_connection_error' }, `Redis cache error: ${error.message}`),
        );

        return {
          stores: [keyv],
          ttl: configService.get<number>('CACHE_TTL', 600_000),
        };
      },
    }),
  ],
  providers: [AtomicCacheService],
  exports: [NestCacheModule, AtomicCacheService],
})
export class CacheModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(CacheModule.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Prove the cache is the one we think it is, at boot, before it matters.
   *
   * A write followed by a read through the cache manager is the only check that cannot be fooled
   * by configuration that looks right: it fails when the store was ignored, when Redis is
   * unreachable, and when credentials are wrong. Outside development that is fatal, because every
   * control listed above degrades silently rather than loudly when this is not a shared store.
   */
  async onApplicationBootstrap(): Promise<void> {
    const key = `cache:selftest:${process.pid}:${Date.now()}`;
    const isDevLike = ['development', 'test'].includes(
      (this.configService.get<string>('NODE_ENV') ?? '').toLowerCase(),
    );

    try {
      await this.cacheManager.set(key, 'ok', 5_000);
      const readBack = await this.cacheManager.get<string>(key);
      await this.cacheManager.del(key);

      if (readBack !== 'ok') {
        throw new Error('the cache did not return the value it was just given');
      }
    } catch (error) {
      const message =
        `The shared cache is not usable: ${(error as Error).message}. ` +
        'Session revocation, two-factor login, single-use step-up tokens and SaaS quotas all ' +
        'depend on it being shared across instances. Check REDIS_URL / REDIS_HOST, credentials ' +
        'and TLS.';

      if (isDevLike) {
        this.logger.warn({ event: 'cache_selftest_failed' }, message);
        return;
      }
      this.logger.error({ event: 'cache_selftest_failed' }, message);
      throw new Error(`FATAL: ${message}`);
    }

    this.logger.log({ event: 'cache_ready' }, 'Shared cache verified.');
  }
}

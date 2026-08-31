
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UserCacheService } from './user-cache.service';

@Module({
  imports: [
    // No local CacheModule registration.
    //
    // This module used to register its own `CacheModule` with `cache-manager-redis-store`, and so
    // did two others. Nest resolves `CACHE_MANAGER` from the nearest registration, so the
    // application ran on FOUR separate cache instances — none of which was Redis, because that
    // adapter is written for cache-manager 4/5 and this project is on 7, so each silently fell
    // back to an in-process Map. A revoked session denylisted through one of them was invisible
    // to the other three.
    //
    // The single `CacheModule` in `app/cache` is `@Global()`, so `CACHE_MANAGER` resolves to one
    // shared, Redis-backed instance everywhere.
  ],
  providers: [UserCacheService],
  exports: [UserCacheService],
})
export class UserCacheModule {}

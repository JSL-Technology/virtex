
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CacheModule } from '@nestjs/cache-manager';
import * as redisStore from 'cache-manager-redis-store';
import { UserCacheService } from './user-cache.service';

@Module({
  imports: [
    CacheModule.registerAsync({
        imports: [ConfigModule],
        inject: [ConfigService],
        useFactory: async (configService: ConfigService) => {
            const redisHost = configService.get<string>('REDIS_HOST');
            if (redisHost) {
                return {
                    store: redisStore,
                    host: redisHost,
                    port: configService.get<number>('REDIS_PORT', 6379),
                    ttl: 600,
                };
            }
            return {
                ttl: 600,
            };
        },
    }),
  ],
  providers: [UserCacheService],
  exports: [UserCacheService],
})
export class UserCacheModule {}

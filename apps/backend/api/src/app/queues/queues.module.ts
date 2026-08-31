
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { redisConnectionOptions } from '../cache/redis.config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        // Credentials and TLS come from the same place the cache and the throttler read them, so
        // a managed Redis is configured once. This used to be host and port only, which made
        // every provider that requires AUTH or TLS unusable.
        connection: redisConnectionOptions(configService),
        defaultJobOptions: {
          removeOnComplete: true,
          removeOnFail: false,
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueuesModule {}
import { Module, Global } from '@nestjs/common';
import { StorageService } from './storage.service';
import { ConfigModule } from '@nestjs/config';
import { LocalStorageStrategy } from './strategies/local-storage.strategy';
import { S3StorageStrategy } from './strategies/s3-storage.strategy';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: StorageService,
      useClass: process.env.STORAGE_DRIVER === 's3' ? S3StorageStrategy : LocalStorageStrategy,
    },
    LocalStorageStrategy,
    S3StorageStrategy,
  ],
  exports: [StorageService],
})
export class StorageModule {}

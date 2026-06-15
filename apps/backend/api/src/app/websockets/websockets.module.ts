
import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { UserCacheModule } from '../auth/modules/user-cache.module';
import { KeyManagementModule } from '../auth/services/key-management.module';

@Module({
  imports: [
    UserCacheModule,
    // Shares the single RS256 KeyManagementService instance so the gateway verifies
    // access tokens with the same key the API signs them with.
    KeyManagementModule,
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketsModule {}

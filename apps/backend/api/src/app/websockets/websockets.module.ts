
import { Module, forwardRef } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { UserCacheModule } from '../auth/modules/user-cache.module';
import { KeyManagementModule } from '../auth/services/key-management.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    UserCacheModule,
    // Shares the single RS256 KeyManagementService instance so the gateway verifies
    // access tokens with the same key the API signs them with.
    KeyManagementModule,
    // `EventsGateway` injects `SessionRegistryService`, which `AuthModule` provides and exports;
    // nothing here imported it before, so the application could not even boot — Nest fails
    // eagerly on an unresolved constructor dependency. `forwardRef` because `AuthModule` is
    // large and central: nothing in it imports this module today, and this keeps that from
    // becoming a boot-order trap if something ever does.
    forwardRef(() => AuthModule),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class WebsocketsModule {}

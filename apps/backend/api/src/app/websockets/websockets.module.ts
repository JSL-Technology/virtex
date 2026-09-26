
import { Module, forwardRef } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { SessionRevocationBroadcaster } from './session-revocation-broadcaster';
import { KeyManagementModule } from '../auth/services/key-management.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    // Shares the single RS256 KeyManagementService instance so the gateway verifies
    // access tokens with the same key the API signs them with.
    KeyManagementModule,
    // And the single identity implementation, so the handshake decides who the caller is by the
    // same rules every HTTP request does. `UserCacheModule` used to be imported here instead, for
    // a hand-written copy of those rules that read the wrong field and skipped the membership
    // check — see `EventsGateway.handleConnection`.
    //
    // `forwardRef` because `AuthModule` is large and central: nothing in it imports this module
    // today, and this keeps that from becoming a boot-order trap if something ever does.
    forwardRef(() => AuthModule),
  ],
  providers: [EventsGateway, SessionRevocationBroadcaster],
  exports: [EventsGateway],
})
export class WebsocketsModule {}

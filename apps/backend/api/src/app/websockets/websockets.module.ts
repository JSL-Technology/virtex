import { Module } from '@nestjs/common';
import { EventsGateway } from './events.gateway';
import { SessionRevocationBroadcaster } from './session-revocation-broadcaster';

/**
 * The real-time channel. Platform code: it depends on no business module.
 *
 * Who a socket belongs to is answered through `SocketAuthenticatorPort`, which Identity provides
 * globally (`SocketAuthenticationModule`); revocations arrive through `SessionRevocationBroadcaster`,
 * which Identity publishes to. This module used to import `AuthModule` (behind a `forwardRef`) and
 * `KeyManagementModule` so the gateway could verify tokens itself — the platform reaching into
 * Identity, and a second copy of rules the HTTP path already owns.
 */
@Module({
  providers: [EventsGateway, SessionRevocationBroadcaster],
  exports: [EventsGateway, SessionRevocationBroadcaster],
})
export class WebsocketsModule {}

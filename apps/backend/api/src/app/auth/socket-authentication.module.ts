import { Global, Module } from '@nestjs/common';
import { SocketAuthenticatorPort } from '../websockets/ports/socket-authenticator.port';
import { WebsocketsModule } from '../websockets/websockets.module';
import { AuthModule } from './auth.module';
import { SessionRevocationRelay } from './listeners/session-revocation.relay';
import { SocketAuthenticator } from './services/socket-authenticator.service';

/**
 * Identity's side of the real-time channel: it answers the gateway's `SocketAuthenticatorPort` and
 * feeds session revocations into the platform's broadcaster.
 *
 * Global because the platform's `WebsocketsModule` consumes the port and may not import Identity —
 * the dependency points from Identity to the platform, never back. Same arrangement as
 * `KeyManagementModule` and `OrgSettingsModule`.
 */
@Global()
@Module({
  imports: [AuthModule, WebsocketsModule],
  providers: [
    SocketAuthenticator,
    { provide: SocketAuthenticatorPort, useExisting: SocketAuthenticator },
    SessionRevocationRelay,
  ],
  exports: [SocketAuthenticatorPort],
})
export class SocketAuthenticationModule {}

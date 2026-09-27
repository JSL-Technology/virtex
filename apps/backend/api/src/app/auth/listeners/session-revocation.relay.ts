import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SessionRevocationBroadcaster } from '../../websockets/session-revocation-broadcaster';
import { AuthEvents, AuthSessionsRevokedEvent } from '../events/auth.events';

/**
 * Carries a session revocation from Identity onto the platform's cross-replica channel.
 *
 * The socket handshake closes the door to NEW connections from a revoked session; this closes it
 * for the one already inside. A WebSocket authenticates once and never makes another authenticated
 * request, so without it the denylist has nothing to act on and the socket outlives the session by
 * up to the full access-token lifetime. Every replica — including this one — disconnects through
 * `SessionRevocationBroadcaster`, so the gateway needs no knowledge of Identity's events.
 */
@Injectable()
export class SessionRevocationRelay {
  constructor(private readonly broadcaster: SessionRevocationBroadcaster) {}

  @OnEvent(AuthEvents.SESSIONS_REVOKED)
  async relay(event: AuthSessionsRevokedEvent): Promise<void> {
    await this.broadcaster.publish({ userId: event.userId, sessionIds: [...event.sessionIds] });
  }
}

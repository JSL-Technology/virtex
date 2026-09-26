
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { KeyManagementService } from '../auth/services/key-management.service';
import { UserIdentityService } from '../auth/services/user-identity.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthEvents, AuthSessionsRevokedEvent } from '../auth/events/auth.events';
import { readAccessTokenCookie } from '../auth/services/access-token-cookie';

/**
 * CORS is deliberately NOT declared here.
 *
 * It used to be, as `origin: 'http://localhost:4200', credentials: true` — a second, fixed rule
 * for the same session the HTTP API resolves from `CORS_ORIGIN`. In a deployment that refused the
 * real front-end and kept a developer's origin on the allow-list of the production API.
 *
 * A decorator cannot read configuration: it is evaluated at import time, before `ConfigModule` has
 * loaded anything, which is how it came to be hardcoded. `ConfiguredIoAdapter` supplies the
 * origins from the running application instead, and its options override whatever is declared
 * here — so leaving this bare is what makes there be exactly one rule.
 */
@WebSocketGateway()
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  /** userId → the socket it is on, the tenant whose room it joined, and the session behind it. */
  private connectedUsers = new Map<
    string,
    { socketId: string; organizationId: string; sessionId?: string }
  >();

  constructor(
    private readonly keyManagementService: KeyManagementService,
    // The one identity implementation. `UserCacheService` and `SessionRegistryService` used to be
    // injected here so this gateway could re-derive, by hand, what `resolveFromPayload` already
    // decides — and the hand-written copy got both the cached shape and the membership check
    // wrong. They are gone from this constructor on purpose: there is nothing left here to
    // re-derive them for.
    @Inject(forwardRef(() => UserIdentityService))
    private readonly userIdentityService: UserIdentityService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookieHeader = client.handshake.headers.cookie;
      if (!cookieHeader) {
        client.disconnect();
        return;
      }

      // Read through the SAME rule the HTTP path uses. This used to accept the unprefixed
      // `access_token` cookie in every environment, while `JwtStrategy` restricts that name to
      // development — two different contracts for one credential. One function now decides.
      const token = readAccessTokenCookie(cookieHeader);

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.verifyAccessToken(token);
      if (!payload) {
        client.disconnect();
        return;
      }

      // Identity is resolved by the SAME service the HTTP path uses, and that is the whole change.
      //
      // This handshake used to carry its own copy of the checks, and the copy had drifted in two
      // directions at once:
      //
      //  - It read `cachedUser.security.tokenVersion`. The cache holds the projection
      //    `UserIdentityService.project()` writes, whose `tokenVersion` is a TOP-LEVEL field —
      //    there is no `security` object on it. So the comparison was always `0 !== payload
      //    .tokenVersion`, and every user who had ever changed their password or had a role
      //    changed (tokenVersion >= 1) was refused a socket permanently. It failed closed, which
      //    is why nobody read it as a security bug; it was still the same defect as reading the
      //    wrong field for an authorisation decision.
      //
      //  - It never re-checked that the user still belongs to `payload.organizationId`, which is
      //    the room it then joined. Removing somebody from a company does not bump `tokenVersion`,
      //    so an ex-member kept receiving that tenant's events until their access token expired.
      //
      // `resolveFromPayload` answers all of it in one place: the revocation denylist, the
      // cache-through load, the token version against the freshly loaded record, the status
      // allow-list, and membership of the organization the token names. It throws on every
      // rejection path, which is what the catch below turns into a disconnect.
      const principal = await this.userIdentityService.resolveFromPayload({
        id: payload.id,
        tokenVersion: payload.tokenVersion,
        organizationId: payload.organizationId,
        sessionId: payload.sessionId,
      } as JwtPayload);

      // Presence is tenant-scoped, and it was not.
      //
      // `this.server.emit(...)` reaches EVERY connected socket, so each tenant learned when any
      // user of any OTHER tenant came online — a cross-tenant disclosure of staff names and working
      // hours, delivered by the feature meant to show colleagues. This repository has already
      // shipped one leak of exactly this shape: a migration records webhook subscribers receiving
      // every tenant's payloads.
      //
      // The room is the boundary. A socket only ever hears what its own organization broadcasts,
      // and the per-document presence the product wants can be built on it without inheriting the
      // leak.
      // The tenant the PRINCIPAL resolved to, not the one the token asserted. They are the same
      // whenever the token is honest; when it is not, this is the one that was checked.
      const organizationId = principal.organizationId;
      if (!organizationId) {
        // A token without a tenant cannot be placed in a room, and a socket outside every room
        // would receive nothing anyway. Refusing is clearer than a silent, deaf connection.
        client.disconnect();
        return;
      }

      client.join(tenantRoom(organizationId));
      // The session is remembered so a later revocation can find this socket and hang up on it.
      this.connectedUsers.set(principal.id, {
        socketId: client.id,
        organizationId,
        sessionId: payload.sessionId,
      });

      this.server.to(tenantRoom(organizationId)).emit('user-status-update', {
        userId: principal.id,
        isOnline: true,
      });
    } catch (e) {
      client.disconnect();
    }
  }

  /**
   * Verifies the httpOnly access-token cookie the same way JwtStrategy does for HTTP requests:
   * RS256 with the public key resolved from the token's `kid` header, plus issuer/audience checks.
   *
   * Previously this used HS256 verification against JWT_SECRET, which can NEVER succeed for the
   * RS256-signed access tokens the API issues — so every authenticated socket was force-disconnected
   * ("io server disconnect"), and the client kept reconnecting in an endless storm.
   */
  private verifyAccessToken(
    token: string,
  ): { id: string; tokenVersion: number; organizationId?: string; sessionId?: string } | null {
    try {
      const decoded = jwt.decode(token, { complete: true });
      const kid = decoded?.header?.kid;
      const publicKey = this.keyManagementService.getPublicKey(kid);
      if (!publicKey) {
        return null;
      }

      return jwt.verify(token, publicKey, {
        algorithms: ['RS256'],
        issuer: 'virteex-api',
        audience: 'virteex-web',
      }) as { id: string; tokenVersion: number; organizationId?: string; sessionId?: string };
    } catch (e) {
      this.logger.debug(`WebSocket token verification failed: ${(e as Error).message}`);
      return null;
    }
  }

  /**
   * Hang up on the sockets of a session that has just been revoked.
   *
   * The handshake check above closes the door for NEW connections; this closes it for the one
   * already inside. A WebSocket authenticates once and then never makes another authenticated
   * request, so without this the denylist has nothing to act on and the socket outlives the
   * session by up to the full access-token lifetime.
   */
  @OnEvent(AuthEvents.SESSIONS_REVOKED)
  handleSessionsRevoked(event: AuthSessionsRevokedEvent): void {
    const revoked = new Set(event.sessionIds);
    for (const [userId, presence] of this.connectedUsers.entries()) {
      if (userId !== event.userId) continue;
      // A socket that predates the `sessionId` claim cannot be attributed to a family. Ending
      // every socket of a user whose sessions are being revoked is the safe reading: the worst
      // case is that they reconnect, which costs a round trip and proves the token again.
      if (presence.sessionId && !revoked.has(presence.sessionId)) continue;

      this.server.sockets.sockets.get(presence.socketId)?.disconnect(true);
      this.connectedUsers.delete(userId);
      this.logger.log(
        { event: 'ws_disconnected_on_revocation', userId },
        'Socket closed because its session was revoked',
      );
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, presence] of this.connectedUsers.entries()) {
      if (presence.socketId === client.id) {
        this.connectedUsers.delete(userId);
        this.logger.debug(`User disconnected: ${userId}`);

        this.server
          .to(tenantRoom(presence.organizationId))
          .emit('user-status-update', { userId, isOnline: false });
        break;
      }
    }
  }

  sendToUser(userId: string, event: string, data: unknown) {
    const presence = this.connectedUsers.get(userId);
    if (presence) {
      this.server.to(presence.socketId).emit(event, data);
    }
  }

  @OnEvent('user.force-logout')
  handleForceLogout(payload: { userId: string; reason: string }) {
    this.sendToUser(payload.userId, 'force-logout', { reason: payload.reason });
  }

  @OnEvent('user.status.changed')
  handleUserStatusChanged(payload: { userId: string; isOnline: boolean }) {
    // Only the user's own tenant hears it. An event for somebody who is not connected has no room
    // to go to, and broadcasting it to everyone was how the leak got in.
    const presence = this.connectedUsers.get(payload.userId);
    if (!presence) return;
    this.server.to(tenantRoom(presence.organizationId)).emit('user-status-update', payload);
  }

  @SubscribeMessage('user-status')
  handleUserStatus(client: Socket, payload: { isOnline: boolean }): void {
    for (const [userId, presence] of this.connectedUsers.entries()) {
      if (presence.socketId === client.id) {
        this.server.to(tenantRoom(presence.organizationId)).emit('user-status-update', {
          userId,
          isOnline: payload.isOnline,
        });
        break;
      }
    }
  }
}

/**
 * The room name a tenant's sockets share.
 *
 * Prefixed so it can never collide with a room named after something else — a document, a process —
 * once per-record presence is built on the same gateway.
 */
function tenantRoom(organizationId: string): string {
  return `org:${organizationId}`;
}

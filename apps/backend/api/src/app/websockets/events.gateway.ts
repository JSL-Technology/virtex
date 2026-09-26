
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Inject, Logger, OnModuleInit, forwardRef } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { KeyManagementService } from '../auth/services/key-management.service';
import { UserIdentityService } from '../auth/services/user-identity.service';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { AuthEvents, AuthSessionsRevokedEvent } from '../auth/events/auth.events';
import { readAccessTokenCookie } from '../auth/services/access-token-cookie';
import { SessionRevocationBroadcaster, SessionsRevokedMessage } from './session-revocation-broadcaster';

interface Presence {
  socketId: string;
  organizationId: string;
  sessionId?: string;
}

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
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  /**
   * userId → socketId → the tenant that socket joined and the session behind it.
   *
   * Keyed by socket, not by user: a user can hold more than one socket at once (two tabs, a
   * phone and a laptop), and a `Map<userId, Presence>` can only ever remember the LAST one to
   * connect. The one before it was silently overwritten in this map while its socket stayed
   * open — so revoking that earlier session found only the newer socket here, decided its
   * family did not match the revoked one, and left the actually-revoked socket connected until
   * its access token expired on its own.
   */
  private connectedUsers = new Map<string, Map<string, Presence>>();
  /** socketId → userId, the reverse index a per-socket disconnect needs to find its owner in O(1). */
  private socketOwners = new Map<string, string>();

  constructor(
    private readonly keyManagementService: KeyManagementService,
    // The one identity implementation. `UserCacheService` and `SessionRegistryService` used to be
    // injected here so this gateway could re-derive, by hand, what `resolveFromPayload` already
    // decides — and the hand-written copy got both the cached shape and the membership check
    // wrong. They are gone from this constructor on purpose: there is nothing left here to
    // re-derive them for.
    @Inject(forwardRef(() => UserIdentityService))
    private readonly userIdentityService: UserIdentityService,
    private readonly sessionRevocationBroadcaster: SessionRevocationBroadcaster,
  ) {}

  onModuleInit(): void {
    // Every replica reacts to every revocation through this one path — see
    // `SessionRevocationBroadcaster` for why, including the one that originated it.
    this.sessionRevocationBroadcaster.onRevoked((message) => this.disconnectRevokedSessions(message));
  }

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
      let sockets = this.connectedUsers.get(principal.id);
      const isFirstSocket = !sockets || sockets.size === 0;
      if (!sockets) {
        sockets = new Map();
        this.connectedUsers.set(principal.id, sockets);
      }
      sockets.set(client.id, { socketId: client.id, organizationId, sessionId: payload.sessionId });
      this.socketOwners.set(client.id, principal.id);

      // Announced only for the user's first socket: a second tab or device reconnecting is not a
      // new online status, and re-announcing it on every one would be noise the room already saw.
      if (isFirstSocket) {
        this.server.to(tenantRoom(organizationId)).emit('user-status-update', {
          userId: principal.id,
          isOnline: true,
        });
      }
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
   * Tells every replica a session was revoked; each reacts through `disconnectRevokedSessions`.
   *
   * The handshake check in `handleConnection` closes the door for NEW connections; that closes
   * it for the one already inside. A WebSocket authenticates once and then never makes another
   * authenticated request, so without this the denylist has nothing to act on and the socket
   * outlives the session by up to the full access-token lifetime.
   *
   * This only publishes — see `SessionRevocationBroadcaster` for why disconnecting also happens
   * through that same round trip rather than directly here, including on the replica that
   * received this very event.
   */
  @OnEvent(AuthEvents.SESSIONS_REVOKED)
  handleSessionsRevoked(event: AuthSessionsRevokedEvent): void {
    void this.sessionRevocationBroadcaster.publish({
      userId: event.userId,
      sessionIds: [...event.sessionIds],
    });
  }

  /** Hangs up on this replica's own sockets for a session family that was just revoked. */
  private disconnectRevokedSessions(message: SessionsRevokedMessage): void {
    const sockets = this.connectedUsers.get(message.userId);
    if (!sockets) return;

    const revoked = new Set(message.sessionIds);
    for (const [socketId, presence] of [...sockets.entries()]) {
      // A socket that predates the `sessionId` claim cannot be attributed to a family. Ending
      // every socket of a user whose sessions are being revoked is the safe reading: the worst
      // case is that they reconnect, which costs a round trip and proves the token again.
      if (presence.sessionId && !revoked.has(presence.sessionId)) continue;

      this.server.sockets.sockets.get(socketId)?.disconnect(true);
      sockets.delete(socketId);
      this.socketOwners.delete(socketId);
      this.logger.log(
        { event: 'ws_disconnected_on_revocation', userId: message.userId },
        'Socket closed because its session was revoked',
      );
    }
    if (sockets.size === 0) this.connectedUsers.delete(message.userId);
  }

  handleDisconnect(client: Socket) {
    const userId = this.socketOwners.get(client.id);
    if (!userId) return;
    this.socketOwners.delete(client.id);

    const sockets = this.connectedUsers.get(userId);
    const presence = sockets?.get(client.id);
    sockets?.delete(client.id);
    this.logger.debug(`Socket disconnected: ${client.id} (user ${userId})`);

    // Announced only once the user's LAST socket is gone: while another tab or device is still
    // connected, the user is still online from the room's point of view.
    if (presence && (!sockets || sockets.size === 0)) {
      this.connectedUsers.delete(userId);
      this.server
        .to(tenantRoom(presence.organizationId))
        .emit('user-status-update', { userId, isOnline: false });
    }
  }

  sendToUser(userId: string, event: string, data: unknown) {
    const sockets = this.connectedUsers.get(userId);
    if (!sockets) return;
    for (const presence of sockets.values()) {
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
    const sockets = this.connectedUsers.get(payload.userId);
    const presence = sockets ? sockets.values().next().value : undefined;
    if (!presence) return;
    this.server.to(tenantRoom(presence.organizationId)).emit('user-status-update', payload);
  }

  @SubscribeMessage('user-status')
  handleUserStatus(client: Socket, payload: { isOnline: boolean }): void {
    const userId = this.socketOwners.get(client.id);
    if (!userId) return;
    const presence = this.connectedUsers.get(userId)?.get(client.id);
    if (!presence) return;
    this.server.to(tenantRoom(presence.organizationId)).emit('user-status-update', {
      userId,
      isOnline: payload.isOnline,
    });
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

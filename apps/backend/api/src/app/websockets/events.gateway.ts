
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger, OnModuleInit } from '@nestjs/common';
import { SocketAuthenticatorPort } from './ports/socket-authenticator.port';
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
    // Who the socket belongs to is Identity's answer, not this gateway's: it used to verify tokens
    // and re-derive the session checks here by hand, and the copy drifted from the HTTP path. See
    // `SocketAuthenticator` for what the one implementation checks.
    private readonly socketAuthenticator: SocketAuthenticatorPort,
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

      // The revocation denylist, the token version, the account status and membership of the
      // organization the token names are all decided by Identity, the same way as for an HTTP
      // request. `null` is "no acceptable token"; a rejection is "a genuine token whose session,
      // account or membership no longer holds", which the catch below turns into a disconnect.
      const principal = await this.socketAuthenticator.authenticate(cookieHeader);
      if (!principal) {
        client.disconnect();
        return;
      }

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
      sockets.set(client.id, { socketId: client.id, organizationId, sessionId: principal.sessionId });
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

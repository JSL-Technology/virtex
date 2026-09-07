
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import { UserCacheService } from '../auth/modules/user-cache.service';
import { KeyManagementService } from '../auth/services/key-management.service';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:4200',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(EventsGateway.name);
  /** userId → the socket it is on, and the tenant whose room that socket joined. */
  private connectedUsers = new Map<string, { socketId: string; organizationId: string }>();

  constructor(
    private readonly userCacheService: UserCacheService,
    private readonly keyManagementService: KeyManagementService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookieHeader = client.handshake.headers.cookie;
      if (!cookieHeader) {
        client.disconnect();
        return;
      }

      const cookies = cookieHeader.split(';').map(c => c.trim());
      const token = cookies
        .find((row) => row.startsWith('access_token=') || row.startsWith('__Host-access_token='))
        ?.split('=')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.verifyAccessToken(token);
      if (!payload) {
        client.disconnect();
        return;
      }

      const cachedUser = await this.userCacheService.getUser(payload.id);
      if (!cachedUser) {
        client.disconnect();
        return;
      }
      const cachedVersion = (cachedUser as any)?.security?.tokenVersion ?? 0;
      if (cachedVersion !== payload.tokenVersion) {
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
      const organizationId = payload.organizationId;
      if (!organizationId) {
        // A token without a tenant cannot be placed in a room, and a socket outside every room
        // would receive nothing anyway. Refusing is clearer than a silent, deaf connection.
        client.disconnect();
        return;
      }

      client.join(tenantRoom(organizationId));
      this.connectedUsers.set(payload.id, { socketId: client.id, organizationId });

      this.server.to(tenantRoom(organizationId)).emit('user-status-update', {
        userId: payload.id,
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
  ): { id: string; tokenVersion: number; organizationId?: string } | null {
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
      }) as { id: string; tokenVersion: number; organizationId?: string };
    } catch (e) {
      this.logger.debug(`WebSocket token verification failed: ${(e as Error).message}`);
      return null;
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


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
  private connectedUsers = new Map<string, string>();

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

      this.connectedUsers.set(payload.id, client.id);

      this.server.emit('user-status-update', {
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
  private verifyAccessToken(token: string): { id: string; tokenVersion: number } | null {
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
      }) as { id: string; tokenVersion: number };
    } catch (e) {
      this.logger.debug(`WebSocket token verification failed: ${(e as Error).message}`);
      return null;
    }
  }

  handleDisconnect(client: Socket) {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.connectedUsers.delete(userId);
        console.log(`User disconnected: ${userId}`);

        this.server.emit('user-status-update', { userId, isOnline: false });
        break;
      }
    }
  }

  sendToUser(userId: string, event: string, data: any) {
    const socketId = this.connectedUsers.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, data);
    }
  }

  @OnEvent('user.force-logout')
  handleForceLogout(payload: { userId: string; reason: string }) {
    this.sendToUser(payload.userId, 'force-logout', { reason: payload.reason });
  }

  @OnEvent('user.status.changed')
  handleUserStatusChanged(payload: { userId: string; isOnline: boolean }) {
    this.server.emit('user-status-update', payload);
  }

  @SubscribeMessage('user-status')
  handleUserStatus(client: Socket, payload: { isOnline: boolean }): void {
    for (const [userId, socketId] of this.connectedUsers.entries()) {
      if (socketId === client.id) {
        this.server.emit('user-status-update', {
          userId,
          isOnline: payload.isOnline,
        });
        break;
      }
    }
  }
}

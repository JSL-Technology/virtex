
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UserCacheService } from '../auth/modules/user-cache.service';

@WebSocketGateway({
  cors: {
    origin: 'http://localhost:4200',
    credentials: true,
  },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private connectedUsers = new Map<string, string>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookies = client.handshake.headers.cookie?.split('; ') || [];
      const token = cookies
        .find((row) => row.startsWith('access_token=') || row.startsWith('__Host-access_token='))
        ?.split('=')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<{ id: string; tokenVersion: number }>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
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

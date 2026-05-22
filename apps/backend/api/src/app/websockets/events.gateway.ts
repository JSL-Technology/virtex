
import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
  SubscribeMessage,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { SessionService } from '../auth/services/session.service';

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
      private readonly sessionService: SessionService
  ) {}

  async handleConnection(client: Socket) {
    try {
      const token = client.handshake.headers.cookie
        ?.split('; ')
        .find((row) => row.startsWith('access_token='))
        ?.split('=')[1];

      if (!token) {
           client.disconnect();
           return;
      }

      // Use SessionService for robust validation (checks revocation, version, etc.)
      const user = await this.sessionService.verifyUserFromToken(token);

      if (!user) {
          client.disconnect();
          return;
      }

      this.connectedUsers.set(user.id, client.id);
      
      this.server.emit('user-status-update', {
        userId: user.id,
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

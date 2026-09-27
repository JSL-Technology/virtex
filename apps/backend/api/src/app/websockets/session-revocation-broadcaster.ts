import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { redisConnectionOptions } from '../cache/redis.config';

export interface SessionsRevokedMessage {
  userId: string;
  sessionIds: string[];
}

const CHANNEL = 'ws:sessions-revoked';

/**
 * Carries a session revocation from the replica that handled it to every replica that might be
 * holding an open socket for it.
 *
 * `SessionService.announceRevocation` fires an in-process `EventEmitter2` event, which is right
 * for the HTTP path — `UserIdentityService` re-checks the shared Redis-backed denylist on every
 * request, regardless of which replica serves it. A WebSocket authenticates once and never makes
 * another authenticated request, so an in-process-only event reaches only the sockets connected
 * to the SAME replica that handled the logout. Behind more than one replica, a revoked socket
 * connected to any OTHER replica kept receiving the tenant's events until its access token
 * expired on its own — up to the full access-token lifetime.
 *
 * This republishes the same event over Redis — already a hard requirement for this deployment
 * (see `CacheModule`) — so every replica's `EventsGateway` learns of it and can disconnect the
 * sockets it is actually holding, regardless of which replica the logout request landed on.
 * `EventsGateway` publishes on receipt of the local event and reacts only to this channel, so the
 * same code path runs identically on every replica, including the one that originated it.
 */
@Injectable()
export class SessionRevocationBroadcaster implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionRevocationBroadcaster.name);
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private handler: ((message: SessionsRevokedMessage) => void) | null = null;

  constructor(private readonly configService: ConfigService) {
    const options = redisConnectionOptions(this.configService);
    // Two connections, not one: a client subscribed to a channel can only (p)subscribe/unsubscribe
    // until it unsubscribes from everything, so the same connection cannot also publish.
    this.publisher = new Redis(options);
    this.subscriber = new Redis(options);
  }

  async onModuleInit(): Promise<void> {
    await this.subscriber.subscribe(CHANNEL);
    this.subscriber.on('message', (channel, raw) => {
      if (channel !== CHANNEL || !this.handler) return;
      try {
        this.handler(JSON.parse(raw) as SessionsRevokedMessage);
      } catch (error) {
        this.logger.warn(
          { event: 'ws_revocation_message_malformed' },
          `Discarded an unreadable session-revocation broadcast: ${(error as Error).message}`,
        );
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.publisher.quit(), this.subscriber.quit()]);
  }

  /** The one handler that reacts to a revocation, whether it originated on this replica or another. */
  onRevoked(handler: (message: SessionsRevokedMessage) => void): void {
    this.handler = handler;
  }

  /** Fire-and-forget by design, the same as the in-process event it rides alongside. */
  async publish(message: SessionsRevokedMessage): Promise<void> {
    try {
      await this.publisher.publish(CHANNEL, JSON.stringify(message));
    } catch (error) {
      this.logger.warn(
        { event: 'ws_revocation_publish_failed', userId: message.userId },
        `Could not publish a session revocation to other replicas: ${(error as Error).message}`,
      );
    }
  }
}

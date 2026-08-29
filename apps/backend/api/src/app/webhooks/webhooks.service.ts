import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookSubscription, WebhookEvent } from './entities/webhook-subscription.entity';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  /**
   * A customer's endpoint is not this application's event loop.
   *
   * Without a timeout, a subscriber that accepts the connection and never answers holds this
   * handler open indefinitely — and it runs inline on the event emitter, so one unresponsive
   * customer endpoint stalls delivery for every other subscriber to the same event.
   */
  private static readonly DELIVERY_TIMEOUT_MS = 10_000;

  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,
  ) {}

  @OnEvent('**')
  async handleEvent(event: string, payload: unknown) {
    const subscriptions = await this.subscriptionRepository.find({
      where: { event: event as WebhookEvent },
    });
    if (subscriptions.length === 0) return;

    const body = JSON.stringify(payload);

    for (const sub of subscriptions) {
      const signature = crypto.createHmac('sha256', sub.secret).update(body).digest('hex');

      try {
        await axios.post(sub.targetUrl, payload, {
          headers: { 'X-Signature': signature },
          timeout: WebhookService.DELIVERY_TIMEOUT_MS,
          // A subscriber that answers 4xx or 5xx has failed; axios must not treat it as success.
          validateStatus: (status) => status >= 200 && status < 300,
        });
      } catch (error) {
        // The catch was empty. Every outbound delivery failure — a customer endpoint down, a
        // certificate expired, a URL that moved — vanished without a log line, so nobody could
        // tell a working integration from a silently broken one.
        //
        // The failure is recorded and delivery continues to the remaining subscribers: one
        // customer's endpoint being down must not stop the others from being notified. What this
        // still does NOT do is retry, and it says so rather than implying durability it lacks —
        // durable delivery needs a queue with backoff and a dead-letter, which is a different
        // change from making the failure visible.
        this.logger.error(
          {
            event: 'webhook_delivery_failed',
            subscriptionId: sub.id,
            webhookEvent: event,
            host: WebhookService.hostOf(sub.targetUrl),
            reason: (error as Error).message,
          },
          '[WEBHOOK] Delivery failed and will not be retried.',
        );
      }
    }
  }

  /** Log the host, never the full URL: a target URL can carry a token in its path or query. */
  private static hostOf(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return 'invalid-url';
    }
  }
}
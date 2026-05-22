import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WebhookSubscription, WebhookEvent } from './entities/webhook-subscription.entity';
import axios from 'axios';
import * as crypto from 'crypto';

@Injectable()
export class WebhookService {
  constructor(
    @InjectRepository(WebhookSubscription)
    private readonly subscriptionRepository: Repository<WebhookSubscription>,
  ) {}

  @OnEvent('**')
  async handleEvent(event: string, payload: any) {
    const subscriptions = await this.subscriptionRepository.find({ where: { event: event as WebhookEvent } });

    for (const sub of subscriptions) {
      const signature = crypto
        .createHmac('sha256', sub.secret)
        .update(JSON.stringify(payload))
        .digest('hex');

      try {
        await axios.post(sub.targetUrl, payload, {
          headers: { 'X-Signature': signature },
        });
      } catch (error) {

      }
    }
  }
}
import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';

@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);

  constructor() {
    webpush.setVapidDetails(
      'mailto:youremail@example.com',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
  }

  async sendPushNotification(subscription: webpush.PushSubscription, payload: any) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      this.logger.error('Error sending push notification', error);
    }
  }
}
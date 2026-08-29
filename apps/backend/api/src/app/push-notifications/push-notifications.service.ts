import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';

/**
 * Web push, configured at startup or disabled at startup — never half-configured.
 *
 * The constructor called `webpush.setVapidDetails` with `process.env.VAPID_PUBLIC_KEY` and no
 * check, and that function throws `No key set vapidDetails.publicKey` when the value is missing.
 * A throw in a constructor fails Nest's instance loader, so the ENTIRE application refused to
 * boot — every module, not just this one — over an optional notification channel. Neither variable
 * was declared in the environment schema, so nothing said this was required, and the failure
 * surfaced as a stack trace from inside `web-push` rather than a configuration error.
 *
 * The subject also had to change: `mailto:youremail@example.com` was sent to every push service as
 * the contact address, so a delivery problem would have been reported to a placeholder.
 */
@Injectable()
export class PushNotificationsService {
  private readonly logger = new Logger(PushNotificationsService.name);
  private readonly enabled: boolean;

  constructor(private readonly config: ConfigService) {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT');

    this.enabled = Boolean(publicKey && privateKey && subject);

    if (!this.enabled) {
      this.logger.warn(
        { event: 'push_notifications_disabled' },
        'VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY or VAPID_SUBJECT is not set; web push is disabled.',
      );
      return;
    }

    webpush.setVapidDetails(subject as string, publicKey as string, privateKey as string);
  }

  async sendPushNotification(subscription: webpush.PushSubscription, payload: unknown) {
    if (!this.enabled) {
      this.logger.debug('Web push is disabled; dropping notification.');
      return;
    }

    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload));
    } catch (error) {
      this.logger.error('Error sending push notification', error);
    }
  }
}

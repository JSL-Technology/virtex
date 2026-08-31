import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { currentLanguage } from '../i18n/request-locale';
import { Notification } from './entities/notification.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { EventsGateway } from '../websockets/events.gateway';
import { PushSubscription } from '../push-notifications/entities/push-subscription.entity';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notificationRepository: Repository<Notification>,
    @InjectRepository(PushSubscription)
    private readonly pushSubscriptionRepository: Repository<PushSubscription>,
    private readonly pushNotificationsService: PushNotificationsService,
    private readonly eventsGateway: EventsGateway,
    private readonly i18n: I18nService,
  ) {}

  /**
   * Create a notification from catalogue keys.
   *
   * The keys are what the message MEANS and are stored; the rendering is made once, in the
   * recipient's language, because a web-push payload leaves the system immediately and cannot be
   * re-rendered later. Reading goes back to the keys, so a reader who changes language sees their
   * whole history change with them.
   *
   * `language` is the RECIPIENT's, resolved by the caller — not the language of whoever triggered
   * the event. A Stripe webhook has no reader at all.
   */
  async createLocalizedNotification(
    userId: string,
    language: LanguageCode,
    message: { titleKey: string; bodyKey: string; params?: Record<string, unknown> },
  ): Promise<Notification> {
    const params = message.params ?? {};
    const title = this.i18n.translate(message.titleKey, language, params);
    const body = this.i18n.translate(message.bodyKey, language, params);

    const savedNotification = await this.notificationRepository.save(
      this.notificationRepository.create({
        userId,
        title,
        body,
        titleKey: message.titleKey,
        bodyKey: message.bodyKey,
        params,
      }),
    );

    this.eventsGateway.sendToUser(userId, 'new_notification', savedNotification);

    const subscriptions = await this.pushSubscriptionRepository.find({ where: { userId } });
    for (const subscription of subscriptions) {
      await this.pushNotificationsService.sendPushNotification(
        subscription.toWebPushSubscription(),
        { title, body },
      );
    }

    return savedNotification;
  }

  /**
   * @deprecated Pass keys through {@link createLocalizedNotification}.
   *
   * Kept for the one caller that genuinely has no key — the manual test endpoint — so that
   * removing it does not become a reason to leave that endpoint writing raw text through the
   * localised path and pretending it was translated.
   */
  async createNotification(userId: string, title: string, body: string): Promise<Notification> {
    const savedNotification = await this.notificationRepository.save(
      this.notificationRepository.create({ userId, title, body }),
    );

    this.eventsGateway.sendToUser(userId, 'new_notification', savedNotification);

    const subscriptions = await this.pushSubscriptionRepository.find({ where: { userId } });
    for (const subscription of subscriptions) {
      await this.pushNotificationsService.sendPushNotification(
        subscription.toWebPushSubscription(),
        { title, body },
      );
    }

    return savedNotification;
  }

  /**
   * The reader's notifications, rendered in the language of THIS request.
   *
   * Re-translated on every read rather than served as stored, so somebody who switches to English
   * sees their notification history in English too — including the ones that arrived while they
   * were reading Spanish. A row with no keys (created before notifications were localised) keeps
   * its stored text, which is all it has.
   */
  async getNotifications(userId: string, language?: LanguageCode): Promise<Notification[]> {
    const target = matchLanguage(language ?? null) ?? currentLanguage();
    const notifications = await this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return notifications.map((notification) => {
      if (!notification.titleKey || !notification.bodyKey) return notification;
      const params = notification.params ?? {};
      notification.title = this.i18n.translate(notification.titleKey, target, params);
      notification.body = this.i18n.translate(notification.bodyKey, target, params);
      return notification;
    });
  }

  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await this.notificationRepository.findOneOrFail({ where: { id: notificationId, userId } });
    notification.read = true;
    return this.notificationRepository.save(notification);
  }

  async markAllAsRead(userId: string): Promise<any> {
    await this.notificationRepository.update({ userId, read: false }, { read: true });
    return { success: true };
  }
}

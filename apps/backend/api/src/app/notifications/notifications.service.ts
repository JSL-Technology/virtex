import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { hasPermission } from '@virteex/shared/util-auth';
import { BadRequestError } from '../i18n/localized.exception';
import { LanguageCode, matchLanguage } from '@virteex/shared/types';
import { I18nService } from '../i18n/i18n.service';
import { currentLanguage } from '../i18n/request-locale';
import { Notification } from './entities/notification.entity';
import { PushNotificationsService } from '../push-notifications/push-notifications.service';
import { EventsGateway } from '../websockets/events.gateway';
import { PushSubscription } from '../push-notifications/entities/push-subscription.entity';

/** How many notices the bell receives: the latest, not the whole history. */
const NOTIFICATION_PAGE = 100;

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
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Ask the tenant's administrators for access to a screen (QA M-09: «Solicitar permiso» opened a
   * `mailto:` with no recipient, which did nothing without a mail client and named nobody).
   *
   * Every active administrator of THIS tenant — a member holding both `users:edit` and
   * `roles:edit` here, the same definition the users service uses for «the last administrator» —
   * gets an in-app notification naming who asked, for what, and why. The requester is told how
   * many received it; with nobody to receive it the request is refused rather than lost.
   */
  async requestAccess(
    requester: { id: string; organizationId: string; firstName?: string | null; lastName?: string | null; email?: string | null },
    request: { path: string; reason?: string | null },
  ): Promise<{ notified: number }> {
    const rows: { id: string; language: string | null; permissions: string | null }[] = await this.dataSource.query(
      `SELECT u.id, u.preferred_language AS language, r.permissions
         FROM users u
         JOIN user_organizations m ON m.user_id = u.id AND m.organization_id = $1 AND m.suspended_at IS NULL
         JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id AND (r.organization_id = $1 OR r.organization_id IS NULL)
        WHERE u.status = 'ACTIVE' AND u.id <> $2`,
      [requester.organizationId, requester.id],
    );
    const permissionsByUser = new Map<string, { language: string | null; permissions: string[] }>();
    for (const row of rows) {
      const entry = permissionsByUser.get(row.id) ?? { language: row.language, permissions: [] };
      entry.permissions.push(...(row.permissions ?? '').split(',').map((p) => p.trim()).filter(Boolean));
      permissionsByUser.set(row.id, entry);
    }
    const administrators = [...permissionsByUser.entries()].filter(([, entry]) =>
      ['users:edit', 'roles:edit'].every((capability) => hasPermission(entry.permissions, [capability])),
    );
    if (administrators.length === 0) {
      throw new BadRequestError('notifications.access_request_no_administrator');
    }

    const name = [requester.firstName, requester.lastName].filter(Boolean).join(' ') || requester.email || '';
    const reason = request.reason?.trim();
    for (const [userId, entry] of administrators) {
      await this.createLocalizedNotification(userId, matchLanguage(entry.language) ?? currentLanguage() ?? 'es', {
        titleKey: 'notifications.access_request.title',
        bodyKey: reason ? 'notifications.access_request.body_with_reason' : 'notifications.access_request.body',
        params: { name, email: requester.email ?? '', path: request.path, reason: reason ?? '' },
        // Members and roles, where the access is granted.
        link: '#settings/users',
        organizationId: requester.organizationId,
      });
    }
    return { notified: administrators.length };
  }

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
    message: {
      titleKey: string;
      bodyKey: string;
      params?: Record<string, unknown>;
      /** Where the notice leads in the client (`/approvals`). */
      link?: string | null;
      /** The company it is about, so a person in two companies sees each one's in its place. */
      organizationId?: string | null;
    },
  ): Promise<Notification> {
    const params = message.params ?? {};
    const rendered = this.renderParams(params, language);
    const title = this.i18n.translate(message.titleKey, language, rendered);
    const body = this.i18n.translate(message.bodyKey, language, rendered);

    const savedNotification = await this.notificationRepository.save(
      this.notificationRepository.create({
        userId,
        title,
        body,
        titleKey: message.titleKey,
        bodyKey: message.bodyKey,
        params,
        link: message.link ?? null,
        organizationId: message.organizationId ?? null,
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
  async getNotifications(userId: string, language?: LanguageCode, organizationId?: string | null): Promise<Notification[]> {
    const target = matchLanguage(language ?? null) ?? currentLanguage();
    // The active company's notices and the person's own; never another company's. Bounded: the
    // bell shows the latest, and a person with years of notices must not download all of them.
    const notifications = await this.notificationRepository.find({
      where: organizationId
        ? [
            { userId, organizationId },
            { userId, organizationId: IsNull() },
          ]
        : { userId },
      order: { createdAt: 'DESC' },
      take: NOTIFICATION_PAGE,
    });

    return notifications.map((notification) => {
      if (!notification.titleKey || !notification.bodyKey) return notification;
      const params = this.renderParams(notification.params ?? {}, target);
      notification.title = this.i18n.translate(notification.titleKey, target, params);
      notification.body = this.i18n.translate(notification.bodyKey, target, params);
      return notification;
    });
  }

  /**
   * A parameter named `…Key` holds a catalogue key — `documentKey: 'approvals.document_type.vendor_bill'`
   * — and is rendered in the reader's language as the parameter without the suffix (`document`).
   * Stored as the key, so the history re-renders with the reader's language like the rest.
   */
  private renderParams(params: Record<string, unknown>, language: LanguageCode): Record<string, unknown> {
    const rendered: Record<string, unknown> = { ...params };
    for (const [name, value] of Object.entries(params)) {
      if (name.endsWith('Key') && name.length > 3 && typeof value === 'string') {
        rendered[name.slice(0, -3)] = this.i18n.translate(value, language);
      }
    }
    return rendered;
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

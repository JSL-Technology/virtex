import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  ) {}

  async createNotification(userId: string, title: string, body: string): Promise<Notification> {
    const notification = this.notificationRepository.create({
      userId,
      title,
      body,
    });
    const savedNotification = await this.notificationRepository.save(notification);


    this.eventsGateway.sendToUser(userId, 'new_notification', savedNotification);


    const subscriptions = await this.pushSubscriptionRepository.find({ where: { userId } });
    for (const subscription of subscriptions) {
      this.pushNotificationsService.sendPushNotification(subscription, { title, body });
    }

    return savedNotification;
  }

  async getNotifications(userId: string): Promise<Notification[]> {
    return this.notificationRepository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
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

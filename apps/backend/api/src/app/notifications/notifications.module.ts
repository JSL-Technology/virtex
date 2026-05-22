import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { PushSubscription } from '../push-notifications/entities/push-subscription.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, PushSubscription]),
    PushNotificationsModule,
    WebsocketsModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

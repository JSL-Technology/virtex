import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Notification } from './entities/notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { WebsocketsModule } from '../websockets/websockets.module';
import { PushSubscription } from '../push-notifications/entities/push-subscription.entity';
import { ApprovalNotificationsListener } from './listeners/approval-notifications.listener';
import { AiNotificationsListener } from './listeners/ai-notifications.listener';
import { OperationsNotificationsListener } from './listeners/operations-notifications.listener';
import { OverdueInvoicesNotifier } from './overdue-invoices.notifier';

@Module({
  imports: [
    TypeOrmModule.forFeature([Notification, PushSubscription]),
    PushNotificationsModule,
    WebsocketsModule,
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    ApprovalNotificationsListener,
    AiNotificationsListener,
    OperationsNotificationsListener,
    OverdueInvoicesNotifier,
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}

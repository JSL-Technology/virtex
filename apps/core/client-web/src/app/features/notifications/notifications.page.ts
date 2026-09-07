import { Component, ChangeDetectionStrategy, computed, inject } from '@angular/core';
import { LucideAngularModule, Check, BellOff } from 'lucide-angular';
import { NotificationCenterService, Notification } from '../../core/services/notification-center.service';
import { TranslateModule } from '@ngx-translate/core';
import { ListShellComponent } from '../../shared/components/gestures';
import { FORMAT_PIPES } from '../../core/i18n/pipes/format.pipes';

interface NotificationGroup {
  /**
   * Clave i18n del tramo temporal.
   *
   * Eran los rótulos «Hoy», «Ayer», «Esta Semana» y «Anteriores» escritos en español y usados a la
   * vez como claves de un diccionario, así que una pantalla en inglés agrupaba sus notificaciones
   * bajo encabezados en español.
   */
  periodKey: string;
  notifications: Notification[];
}

@Component({
  selector: 'app-notifications-page',
  standalone: true,
  imports: [LucideAngularModule, TranslateModule, ...FORMAT_PIPES, ListShellComponent],
  templateUrl: './notifications.page.html',
  styleUrls: ['./notifications.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsPage {
  notificationCenter = inject(NotificationCenterService);

  // Íconos
  protected readonly MarkAllReadIcon = Check;
  protected readonly NoNotificationsIcon = BellOff;

  notifications = this.notificationCenter.notifications;

  notificationGroups = computed(() => this.groupNotificationsByDate(this.notifications()));

  /** Sin leer. Es el número que importa: cuántas quedan por atender, no cuántas hay. */
  readonly unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);

  private groupNotificationsByDate(notifications: Notification[]): NotificationGroup[] {
    const groups: Record<string, Notification[]> = {
      'NOTIFICATIONS.TODAY': [],
      'NOTIFICATIONS.YESTERDAY': [],
      'NOTIFICATIONS.THIS_WEEK': [],
      'NOTIFICATIONS.EARLIER': [],
    };

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const oneWeekAgo = new Date(today);
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    for (const notification of notifications) {
      const notificationDate = new Date(notification.createdAt);
      if (notificationDate.toDateString() === today.toDateString()) {
        groups['NOTIFICATIONS.TODAY'].push(notification);
      } else if (notificationDate.toDateString() === yesterday.toDateString()) {
        groups['NOTIFICATIONS.YESTERDAY'].push(notification);
      } else if (notificationDate > oneWeekAgo) {
        groups['NOTIFICATIONS.THIS_WEEK'].push(notification);
      } else {
        groups['NOTIFICATIONS.EARLIER'].push(notification);
      }
    }

    return Object.keys(groups)
      .map((periodKey) => ({ periodKey, notifications: groups[periodKey] }))
      .filter((group) => group.notifications.length > 0);
  }

  markAsRead(notificationId: string): void {
    this.notificationCenter.markAsRead(notificationId);
  }

  markAllAsRead(): void {
    this.notificationCenter.markAllAsRead();
  }
}
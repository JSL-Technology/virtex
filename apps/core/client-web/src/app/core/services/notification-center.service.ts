import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { WebSocketService } from './websocket.service';
import { PushNotificationService } from './push-notification.service';
import { environment } from '../../../environments/environment';

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationCenterService {
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  notifications = signal<Notification[]>([]);
  unreadCount = signal(0);

  constructor(
    private http: HttpClient,
    private websocketService: WebSocketService,
    private pushNotificationService: PushNotificationService
  ) {
    this.websocketService.connectionReady$.subscribe(() => {
      this.listenForNewNotifications();
    });
  }

  initialize() {
    this.fetchNotifications();
    this.websocketService.connect();
    this.pushNotificationService.subscribeToNotifications();
  }

  fetchNotifications() {
    this.http.get<Notification[]>(this.apiUrl).subscribe(notifications => {
      this.notifications.set(notifications);
      this.updateUnreadCount();
    });
  }

  private listenForNewNotifications() {
    this.websocketService.listen<Notification>('new_notification').subscribe(notification => {
      this.notifications.update(current => [notification, ...current]);
      this.updateUnreadCount();
    });
  }

  markAsRead(notificationId: string) {
    this.http.post(`${this.apiUrl}/${notificationId}/read`, {}).subscribe(() => {
      this.notifications.update(notifications =>
        notifications.map(n => n.id === notificationId ? { ...n, read: true } : n)
      );
      this.updateUnreadCount();
    });
  }

  markAllAsRead() {
    this.http.post(`${this.apiUrl}/read-all`, {}).subscribe(() => {
      this.notifications.update(notifications =>
        notifications.map(n => ({ ...n, read: true }))
      );
      this.updateUnreadCount();
    });
  }

  private updateUnreadCount() {
    const count = this.notifications().filter(n => !n.read).length;
    this.unreadCount.set(count);
  }
}

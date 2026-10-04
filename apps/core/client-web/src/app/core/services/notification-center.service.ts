import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { WebSocketService } from './websocket.service';
import { PushNotificationService } from './push-notification.service';
import { environment } from '../../../environments/environment';

export interface Notification {
  id: string;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** Where the notice leads: an app path (`/approvals`) or a fragment (`#settings/users`). */
  link?: string | null;
  /** The company it is about; null for a notice about the person themselves. */
  organizationId?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class NotificationCenterService {
  private readonly apiUrl = `${environment.apiUrl}/notifications`;

  notifications = signal<Notification[]>([]);
  unreadCount = signal(0);

  private http = inject(HttpClient);
  private router = inject(Router);

  private websocketService = inject(WebSocketService);

  private pushNotificationService = inject(PushNotificationService);


  constructor() {
    this.websocketService.connectionReady$.subscribe(() => {
      this.listenForNewNotifications();
    });
  }

  /** The company the shell is showing; a live notice about another one waits for a switch. */
  private activeOrganizationId: string | null = null;
  private loaded = false;

  /** Called when the active company changes: the list is that company's (QA B-02). */
  setActiveOrganization(organizationId: string | null): void {
    if (this.loaded && organizationId === this.activeOrganizationId) return;
    this.activeOrganizationId = organizationId;
    this.fetchNotifications();
  }

  initialize() {
    // The list itself is fetched by `setActiveOrganization`, which the shell calls with the
    // session's company; fetching here too would ask twice on every start.
    this.websocketService.connect();
    this.pushNotificationService.subscribeToNotifications();
  }

  fetchNotifications() {
    this.http.get<Notification[]>(this.apiUrl).subscribe({
      next: (notifications) => {
        this.loaded = true;
        this.notifications.set(notifications);
        this.updateUnreadCount();
      },
      // The bell is not worth an error banner; it keeps what it had and tries again next time.
      error: () => undefined,
    });
  }

  private listenForNewNotifications() {
    this.websocketService.listen<Notification>('new_notification').subscribe(notification => {
      if (notification.organizationId && this.activeOrganizationId && notification.organizationId !== this.activeOrganizationId) {
        return;
      }
      this.notifications.update(current => [notification, ...current.filter((n) => n.id !== notification.id)]);
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

  /**
   * A notice opens what it is about (QA B-02: the list was text that led nowhere). A path is
   * navigated to; a fragment opens settings over the current screen, as every settings link does.
   */
  open(notification: Notification): void {
    if (!notification.read) this.markAsRead(notification.id);
    const link = notification.link;
    if (!link) return;
    if (link.startsWith('#')) {
      void this.router.navigate([], { fragment: link.slice(1) });
    } else if (link.startsWith('/')) {
      void this.router.navigateByUrl(link);
    }
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

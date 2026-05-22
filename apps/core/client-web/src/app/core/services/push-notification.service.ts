import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { SwPush } from '@angular/service-worker';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  readonly VAPID_PUBLIC_KEY = environment.vapidPublicKey;

  private swPush = inject(SwPush);
  private http = inject(HttpClient);

  subscribeToNotifications() {
    if (!this.swPush.isEnabled) {
      if (environment.production) {
          console.warn('Push notifications are not enabled (Service Worker not active).');
      }
      return;
    }
    this.swPush.requestSubscription({
      serverPublicKey: this.VAPID_PUBLIC_KEY
    })
    .then((sub: PushSubscription) => this.sendToServer(sub))
    .catch((err: unknown) => console.error('Could not subscribe to notifications', err));
  }

  private sendToServer(params: PushSubscription) {
    this.http.post(`${environment.apiUrl}/push/subscribe`, params).subscribe();
  }
}
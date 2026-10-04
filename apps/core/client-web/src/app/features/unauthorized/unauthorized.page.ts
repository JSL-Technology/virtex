import { Component, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { LucideAngularModule, ShieldAlert, Mail } from 'lucide-angular';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { TranslateModule } from '@ngx-translate/core';

@Component({
  selector: 'app-unauthorized-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, RouterLink, TranslateModule],
  templateUrl: './unauthorized.page.html',
  styleUrls: ['./unauthorized.page.scss']
})
export class UnauthorizedPage {
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly MailIcon = Mail;

  private route = inject(ActivatedRoute);

  public attemptedUrl$: Observable<string | null> = this.route.queryParamMap.pipe(
    map(params => params.get('url'))
  );


  private readonly http = inject(HttpClient);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);

  readonly requesting = signal(false);
  readonly requested = signal(false);

  /**
   * Ask this tenant's administrators for access to the screen that was refused (QA M-09).
   *
   * This was a `mailto:` with no recipient: without a mail client it did nothing, and with one it
   * left the reader to work out who their administrator was. The request now reaches every
   * active administrator of the tenant as a notification naming the person, the screen and the
   * reason, and the reader is told how many received it.
   */
  async requestAccess(): Promise<void> {
    const reason = await this.dialog.prompt({
      title: 'unauthorized.request_reason_title',
      message: 'unauthorized.request_reason_message',
      placeholder: 'unauthorized.request_reason_placeholder',
      confirmText: 'unauthorized.request_send',
    });
    if (reason === null) return;
    const path = this.route.snapshot.queryParamMap.get('url') || '/';
    this.requesting.set(true);
    this.http
      .post<{ notified: number }>(`${environment.apiUrl}/notifications/access-request`, {
        path: path.startsWith('/') ? path : `/${path}`,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      .subscribe({
        next: ({ notified }) => {
          this.requesting.set(false);
          this.requested.set(true);
          this.notifications.showSuccess('unauthorized.request_sent', { count: notified });
        },
        error: (error: unknown) => {
          this.requesting.set(false);
          this.notifications.showHttpError(error, 'unauthorized.request_failed');
        },
      });
  }
}
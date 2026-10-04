import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { TranslateModule } from '@ngx-translate/core';
import { environment } from '../../../../../environments/environment';
import { NotificationService } from '../../../../core/services/notification';

export interface MailSettings {
  senderName: string;
  replyTo: string | null;
  copyTo: string | null;
  configured: { senderName: string | null; replyTo: string | null; copyTo: string | null };
  defaults: { senderName: string; replyTo: string | null };
  platformAddress: string | null;
}

interface Draft {
  senderName: string;
  replyTo: string;
  copyTo: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * How the company appears on the documents it e-mails (QA M-09: «Servidor de correo (SMTP)» said
 * «En desarrollo»).
 *
 * An invoice sent to a customer left with the platform's name and no Reply-To, so the customer's
 * answer reached the software vendor. The message keeps leaving from the platform's authenticated
 * domain — what SPF and DKIM vouch for — with the company's name, its reply address and, if it
 * wants one, a blind copy for its records. See `MailSettingsController` for why this is not a
 * per-company SMTP server.
 */
@Component({
  selector: 'app-smtp-settings-page',
  standalone: true,
  imports: [FormsModule, TranslateModule],
  templateUrl: './smtp.page.html',
  styleUrls: ['./smtp.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SmtpSettingsPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly notifications = inject(NotificationService);
  private readonly url = `${environment.apiUrl}/organizations/mail-settings`;

  readonly settings = signal<MailSettings | null>(null);
  readonly loadError = signal<string | null>(null);
  readonly draft = signal<Draft>({ senderName: '', replyTo: '', copyTo: '' });
  readonly saving = signal(false);
  readonly testing = signal(false);

  /** The sender line exactly as the customer's mail program will show it. */
  readonly preview = computed(() => {
    const settings = this.settings();
    if (!settings) return '';
    const name = this.draft().senderName.trim() || settings.defaults.senderName;
    return settings.platformAddress ? `${name} <${settings.platformAddress}>` : name;
  });

  readonly replyPreview = computed(() => this.draft().replyTo.trim() || this.settings()?.defaults.replyTo || null);

  readonly invalid = computed(() => {
    const { replyTo, copyTo } = this.draft();
    return {
      replyTo: !!replyTo.trim() && !EMAIL.test(replyTo.trim()),
      copyTo: !!copyTo.trim() && !EMAIL.test(copyTo.trim()),
    };
  });

  readonly dirty = computed(() => {
    const configured = this.settings()?.configured;
    if (!configured) return false;
    const draft = this.draft();
    return (
      draft.senderName.trim() !== (configured.senderName ?? '') ||
      draft.replyTo.trim().toLowerCase() !== (configured.replyTo ?? '') ||
      draft.copyTo.trim().toLowerCase() !== (configured.copyTo ?? '')
    );
  });

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loadError.set(null);
    this.http.get<MailSettings>(this.url).subscribe({
      next: (settings) => this.apply(settings),
      error: (error: unknown) => this.loadError.set(this.notifications.httpErrorMessage(error, 'settings.mail.load_failed')),
    });
  }

  patch(patch: Partial<Draft>): void {
    this.draft.update((draft) => ({ ...draft, ...patch }));
  }

  save(): void {
    const invalid = this.invalid();
    if (invalid.replyTo || invalid.copyTo) {
      this.notifications.showError('settings.mail.invalid_address');
      return;
    }
    const draft = this.draft();
    this.saving.set(true);
    this.http
      .patch<MailSettings>(this.url, {
        senderName: draft.senderName.trim() || null,
        replyTo: draft.replyTo.trim() || null,
        copyTo: draft.copyTo.trim() || null,
      })
      .subscribe({
        next: (settings) => {
          this.saving.set(false);
          this.apply(settings);
          this.notifications.showSuccess('settings.mail.saved');
        },
        error: (error: unknown) => {
          this.saving.set(false);
          this.notifications.showHttpError(error, 'settings.mail.save_failed');
        },
      });
  }

  sendTest(): void {
    this.testing.set(true);
    this.http.post<{ to: string }>(`${this.url}/test`, {}).subscribe({
      next: ({ to }) => {
        this.testing.set(false);
        this.notifications.showSuccess('settings.mail.test_sent', { to });
      },
      error: (error: unknown) => {
        this.testing.set(false);
        this.notifications.showHttpError(error, 'settings.mail.test_failed');
      },
    });
  }

  private apply(settings: MailSettings): void {
    this.settings.set(settings);
    this.draft.set({
      senderName: settings.configured.senderName ?? '',
      replyTo: settings.configured.replyTo ?? '',
      copyTo: settings.configured.copyTo ?? '',
    });
  }
}

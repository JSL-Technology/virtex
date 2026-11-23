import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { ArrowLeft, CreditCard, LucideAngularModule, Mail, ShieldAlert, Sparkles } from 'lucide-angular';
import { isSaasFeatureKey, planFeatureLabelKey, type SaasFeatureKey } from '@virtex/shared/types';
import { TranslateModule } from '@virtex/shared/ui-i18n';
import { environment } from '../../../environments/environment';
import { DialogService } from '../../core/services/dialog.service';
import { NotificationService } from '../../core/services/notification';
import { AuthService } from '../../core/services/auth';
import { ActiveOrganizationService } from '../../core/tenancy/active-organization.service';

/**
 * Why a screen did not open, and what to do about it.
 *
 * Two different answers. A missing **permission** is the person's: they ask an administrator for
 * access, which reaches every administrator of the company as a notification. A feature the
 * company's **plan** does not include is the company's: no role grants it, so the page says it is
 * not in the plan and leads whoever manages the subscription to the plans (IA-02). It used to answer
 * every refusal as a missing permission, and the screen behind a plan answered 403 on opening.
 */
@Component({
  selector: 'app-unauthorized-page',
  standalone: true,
  imports: [LucideAngularModule, RouterLink, TranslateModule],
  templateUrl: './unauthorized.page.html',
  styleUrls: ['./unauthorized.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UnauthorizedPage {
  protected readonly ShieldAlertIcon = ShieldAlert;
  protected readonly PlanIcon = Sparkles;
  protected readonly MailIcon = Mail;
  protected readonly BackIcon = ArrowLeft;
  protected readonly BillingIcon = CreditCard;

  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);
  private readonly dialog = inject(DialogService);
  private readonly notifications = inject(NotificationService);
  private readonly auth = inject(AuthService);
  private readonly organization = inject(ActiveOrganizationService);

  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  /** The address that was refused, as the person typed or followed it. */
  readonly attemptedUrl = computed(() => this.query().get('url'));

  /** The plan feature the screen needs, when that — not a permission — is why it did not open. */
  readonly feature = computed<SaasFeatureKey | null>(() => {
    const value = this.query().get('feature');
    return isSaasFeatureKey(value) ? value : null;
  });
  readonly featureLabelKey = computed(() => {
    const feature = this.feature();
    return feature ? planFeatureLabelKey(feature) : null;
  });

  /** Whoever may see the subscription is shown the plans; anyone else, who to ask. */
  readonly canSeePlans = computed(() => this.auth.hasPermissions(['billing:view']));

  /** The company's home, with its prefix: the page sits outside the company's routes. */
  readonly home = computed(() => this.organization.urlFor('/overview'));

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
    const path = this.attemptedUrl() || '/';
    this.requesting.set(true);
    this.http
      .post<{ notified: number }>(`${environment.apiUrl}/notifications/access-request`, {
        path: path.startsWith('/') ? path : `/${path}`,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      })
      .pipe(map((response) => response.notified))
      .subscribe({
        next: (notified) => {
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

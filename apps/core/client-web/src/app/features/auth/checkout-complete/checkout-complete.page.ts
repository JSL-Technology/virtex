import { Component, ChangeDetectionStrategy, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, ActivatedRoute } from '@angular/router';
import { LucideAngularModule, CheckCircle, AlertTriangle, Loader } from 'lucide-angular';
import { AuthService, RegistrationConfirmation } from '../../../core/services/auth';
import { LanguageService } from '../../../core/services/language';
import { ActiveOrganizationService } from '../../../core/tenancy/active-organization.service';
import { AuthLayoutComponent } from '../components/auth-layout/auth-layout.component';
import { AuthButtonComponent } from '../components/auth-button/auth-button.component';
import { TranslateModule } from '@virteex/shared/ui-i18n';
import { NotificationService } from '../../../core/services/notification';

type CompleteState = 'verifying' | 'success' | 'error';

@Component({
  selector: 'app-checkout-complete',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, AuthLayoutComponent, AuthButtonComponent, TranslateModule],
  templateUrl: './checkout-complete.page.html',
  styleUrls: ['./checkout-complete.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutCompletePage implements OnInit {
  /** Turns the API's error contract (`code`, `messageKey`, `params`) into the reader's sentence. */
  private readonly errorText = inject(NotificationService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private readonly tenancy = inject(ActiveOrganizationService);

  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly LoaderIcon = Loader;

  private readonly language = inject(LanguageService);

  state = signal<CompleteState>('verifying');

  /**
   * What the signup actually started (QA A-11).
   *
   * The screen said «Payment confirmed.» after a free trial for which no card had been asked —
   * the one sentence most likely to make somebody think they were charged. A trial now says it is
   * active and when the first charge would happen; only a paid first period says "payment".
   */
  readonly trialEndsOn = signal<string | null>(null);
  readonly isTrial = signal(false);
  /** "Your 30-day trial" when the server says how long it is; the plain wording otherwise. */
  readonly trialDays = signal<number | null>(null);
  errorMessage = signal<string | null>(null);

  private sessionId: string | null = null;
  private attempts = 0;
  private readonly maxAttempts = 5;

  ngOnInit(): void {
    this.sessionId = this.route.snapshot.queryParamMap.get('session_id');
    if (!this.sessionId) {
      this.state.set('error');
      this.errorMessage.set('checkout.no_session');
      return;
    }
    this.confirm();
  }

  confirm(): void {
    if (!this.sessionId) return;
    this.state.set('verifying');
    this.errorMessage.set(null);
    this.attempts++;

    this.authService.confirmRegistration(this.sessionId).subscribe({
      next: (response: RegistrationConfirmation) => {
        const user = response.user;
        this.describeSubscription(response.subscription);
        this.state.set('success');
        // Into the company just paid for. For someone adding a company it is not the one they
        // were last in, and `/overview` alone would have taken them back there.
        const slug = user?.organization?.slug;
        if (slug) this.tenancy.remember(slug);
        // A paid confirmation needs only a beat; a trial explains what happens when it ends, so
        // the reader is given time to read it — and a button to go on before then.
        if (!this.isTrial()) {
          setTimeout(() => this.router.navigate(['/overview']), 1500);
        }
      },
      error: (err) => {
        // The webhook may lag a moment; retry a few times before giving up.
        if (this.attempts < this.maxAttempts) {
          setTimeout(() => this.confirm(), 2000);
          return;
        }
        this.state.set('error');
        this.errorMessage.set(
          this.errorText.httpErrorMessage(err, 'checkout.we_couldn_confirm_your_payment_automatically'),
        );
      },
    });
  }

  private describeSubscription(subscription: RegistrationConfirmation['subscription']): void {
    this.isTrial.set(!!subscription?.trial);
    const days = subscription?.trialDays;
    this.trialDays.set(typeof days === 'number' && days > 0 ? days : null);
    const end = subscription?.currentPeriodEnd ? new Date(subscription.currentPeriodEnd) : null;
    this.trialEndsOn.set(
      end && !Number.isNaN(end.getTime())
        ? new Intl.DateTimeFormat(this.language.currentLocale(), { dateStyle: 'long' }).format(end)
        : null,
    );
  }

  enterApp(): void {
    void this.router.navigate(['/overview']);
  }

  goToLogin(): void {
    // With the language: `/auth/login` alone matches no route (see `app.routes.links.spec.ts`).
    this.router.navigate(['/', this.language.currentLang(), 'auth', 'login']);
  }
}

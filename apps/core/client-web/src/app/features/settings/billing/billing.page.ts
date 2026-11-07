import { TranslateModule, FORMAT_PIPES } from '@virteex/shared/ui-i18n';
import { translateOrLiteral, FormatService } from '@virteex/shared/ui-i18n';
import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed, ViewContainerRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, Check, CheckCircle, Download, ExternalLink, Zap } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { BillingService, BillingOverview, BillingInvoice } from '../../../core/services/billing';
import { StepUpService, StepUpScope } from '../../../core/services/step-up.service';
import { minorUnitFactorFor } from '../../../core/models/plan.model';
import { LanguageService } from '../../../core/services/language';
import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virteex/shared/types';
import { VxEmptyStateComponent, VxErrorStateComponent, VxNoticeComponent, VxSpinnerComponent } from '../../../shared/components/feedback';
import { VxPaymentCardComponent } from '../../../shared/components/payment-card';
import { VxBadgeComponent, type VxTone } from '../../../shared/components/badge';
import { SettingsGroupComponent } from '../shared';
import { SettingsShellService } from '../shell';

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [
    CommonModule,
    LucideAngularModule,
    TranslateModule,
    VxSpinnerComponent,
    VxErrorStateComponent,
    VxEmptyStateComponent,
    VxNoticeComponent,
    VxBadgeComponent,
    VxPaymentCardComponent,
    SettingsGroupComponent,
    ...FORMAT_PIPES,
  ],
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingPage implements OnInit {
  private billingService = inject(BillingService);
  private stepUpService = inject(StepUpService);
  private languageService = inject(LanguageService);
  private readonly format = inject(FormatService);
  private readonly translate = inject(TranslateService);
  private viewContainerRef = inject(ViewContainerRef);
  private readonly shell = inject(SettingsShellService, { optional: true });

  protected readonly DownloadIcon = Download;
  protected readonly CheckIcon = Check;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly ZapIcon = Zap;
  protected readonly ExternalLinkIcon = ExternalLink;

  /** Whether the person may change the plan or the card (it takes `billing:manage`). */
  protected readonly canEdit = computed(() => this.shell?.canEdit() ?? true);

  usageMetrics = toSignal(this.billingService.getUsage(), { initialValue: [] as any[] });

  overview = signal<BillingOverview | null>(null);
  /** The subscription is read before anything is said about it: «Sin plan» on a failed request was a lie. */
  overviewState = signal<'loading' | 'error' | 'ready'>('loading');
  invoices = signal<BillingInvoice[]>([]);

  selectedPlan = signal<string | null>(null);
  isRedirecting = signal(false);
  isOpeningPortal = signal(false);
  checkoutError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  availablePlans = this.billingService.plans;
  plansState = this.billingService.plansState;
  /** Both reads still on their way: one spinner for the page, not one per group. */
  readonly pageLoading = computed(() => this.overviewState() === 'loading' && this.plansState() === 'loading');
  /** Both reads failed — a dropped connection: one error and one retry for the whole page. */
  readonly allFailed = computed(() => this.overviewState() === 'error' && this.plansState() === 'error');

  // True once the org has an active/trialing subscription managed by Stripe.
  hasActiveSubscription = computed(() => {
    const sub = this.overview()?.subscription;
    // Only the provider's subscription has a portal and a card behind it; one the platform
    // granted is changed by subscribing, not by managing.
    return !!sub && sub.managedBy !== 'platform' && ['active', 'trialing', 'past_due'].includes(sub.status);
  });

  currentPlanSlug = computed(() => this.overview()?.plan?.slug ?? null);

  /** The chosen plan by its name, as the cards show it; the slug is an identifier, not a name. */
  selectedPlanName = computed(() => {
    const slug = this.selectedPlan();
    return this.availablePlans().find((plan) => plan.slug === slug)?.name ?? slug ?? '';
  });

  ngOnInit(): void {
    // Returning from a successful Stripe Checkout adds ?session_id=...
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    if (sessionId) {
      // Clean the URL so a refresh doesn't re-run the confirmation or re-show the banner.
      window.history.replaceState({}, '', window.location.pathname);
      this.confirmCheckout(sessionId);
      return;
    }

    this.refreshBillingData();
  }

  /**
   * Reconcile a just-completed Checkout instead of waiting for Stripe's webhook.
   *
   * The webhook is the source of truth in production, but in local development it never reaches
   * the backend (no public URL / no `stripe listen`), so the subscription status and the card on
   * file would otherwise never appear — the card entered at Checkout (e.g. 4242…) is charged but
   * the account still shows no payment method. `confirmCheckout` retrieves the paid session from
   * Stripe server-side and syncs the plan, subscription and default payment method, returning the
   * refreshed overview.
   */
  private confirmCheckout(sessionId: string): void {
    this.successMessage.set(this.translate.instant('billing.checkout.activating'));
    this.overviewState.set('loading');
    this.billingService.confirmCheckout(sessionId).subscribe(overview => {
      if (overview) {
        this.overview.set(overview);
        this.overviewState.set('ready');
        this.successMessage.set(this.translate.instant('billing.checkout.active'));
        this.billingService.getInvoices().subscribe(list => this.invoices.set(list));
      } else {
        // Confirmation failed (Stripe unreachable, etc.) — fall back to whatever the API reports.
        this.refreshBillingData();
      }
    });
  }

  refreshBillingData(): void {
    this.overviewState.set('loading');
    this.billingService.getOverview().subscribe(data => {
      // The service turns a failed request into null; an organization always has an overview.
      this.overview.set(data);
      this.overviewState.set(data ? 'ready' : 'error');
    });
    this.billingService.getInvoices().subscribe(list => this.invoices.set(list));
  }

  retryLoadPlans(): void {
    this.billingService.loadPlans();
  }

  /** Retry both reads at once, from the page's single error. */
  retryAll(): void {
    this.refreshBillingData();
    this.retryLoadPlans();
  }

  selectPlan(planSlug: string): void {
    if (planSlug === this.currentPlanSlug() || !this.canEdit()) return;
    this.selectedPlan.set(planSlug);
    this.checkoutError.set(null);
  }

  startCheckout(): void {
    const planSlug = this.selectedPlan();
    if (!planSlug) return;

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    // Existing subscribers manage plan changes through the Stripe portal
    // (proration, downgrades, etc.); new customers go through Checkout.
    this.stepUpService.requireStepUp(StepUpScope.MANAGE_PAYMENT, this.viewContainerRef, () => {
      return this.hasActiveSubscription()
        ? this.billingService.openBillingPortal()
        : this.billingService.startCheckout(planSlug);
    }).subscribe({
      next: (ok) => {
        if (!ok) {
          this.checkoutError.set(this.translate.instant('billing.checkout.start_failed'));
          this.isRedirecting.set(false);
        }
        // On success the browser is redirected away — no need to reset state.
      },
      error: (err) => {
        this.checkoutError.set(err?.message || this.translate.instant('errors.unexpected'));
        this.isRedirecting.set(false);
      }
    });
  }

  manageBilling(): void {
    this.isOpeningPortal.set(true);
    this.checkoutError.set(null);

    this.stepUpService.requireStepUp(StepUpScope.MANAGE_PAYMENT, this.viewContainerRef, () => {
      return this.billingService.openBillingPortal();
    }).subscribe({
      next: (ok) => {
        if (!ok) {
          this.checkoutError.set(this.translate.instant('errors.open_billing_portal'));
          this.isOpeningPortal.set(false);
        }
      },
      error: (err) => {
        this.checkoutError.set(err?.message || this.translate.instant('errors.unexpected'));
        this.isOpeningPortal.set(false);
      }
    });
  }

  /**
   * Render an amount in the currency it is actually billed in.
   *
   * This used to divide by 100 and be prefixed with a hardcoded `$` in the template, which was
   * wrong twice over: wrong symbol for every non-dollar market, and wrong magnitude for CLP and
   * PYG, which have no minor unit at all.
   */
  formatPrice(amount: number | null | undefined, currency?: string, minorUnits?: number): string {
    // The same formatter as every amount in the settings window (FMT-01): «US$199/mes» here and
    // «US$ 0.00» in AI were two formats for one kind of datum. The currency decides the decimals.
    const factor = minorUnits || 100;
    return this.format.money((amount ?? 0) / factor, currency ?? 'USD');
  }

  /**
   * An invoice is rendered in the currency Stripe issued it in, which is authoritative and may
   * differ from the tenant's current plan currency for historical invoices.
   */
  formatInvoiceAmount(invoice: BillingInvoice): string {
    const currency = (invoice.currency || 'usd').toUpperCase();
    return this.formatPrice(invoice.amount, currency, minorUnitFactorFor(currency));
  }

  /**
   * A billing date.
   *
   * Was pinned to `es-MX` — one market's format shown to nineteen — and rendered in the browser's
   * timezone rather than the tenant's. Both come from `FormatService` now.
   */
  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return this.format.date(iso, 'dateLong') || '—';
  }

  /**
   * Stripe's subscription status, in the reader's language.
   *
   * The status values are Stripe's own vocabulary and are stable, so they map to keys rather than
   * being shown raw. An unrecognised one falls back to the code itself: a new Stripe status must
   * be visible as something, and inventing a label for it would be worse than showing what it is.
   */
  statusLabel(status: string | undefined): string {
    if (!status) return '—';
    return translateOrLiteral(
      this.translate,
      composeKey('billing.subscription_status', status),
      undefined,
      status,
    );
  }

  /** A billing-history invoice's Stripe status, in the reader's language; an unknown one as itself. */
  invoiceStatusLabel(status: string | undefined): string {
    if (!status) return '—';
    return translateOrLiteral(this.translate, composeKey('billing.invoice_status', status), undefined, status);
  }

  /**
   * A plan's pitch, in the reader's language.
   *
   * The catalogue endpoint sends a translation key (`billing.plans.pro.description`); a row seeded
   * before that change still carries the old Spanish sentence, and that is printed as it stands
   * rather than as a key nobody can read.
   */
  /**
   * A metered resource in the reader's language. It was the API identifier with its first
   * underscore replaced — «invoices/mes», «journal entries» — in a Spanish screen (QA M-10).
   */
  resourceLabel(resource: string): string {
    const key = `saas.resources.${resource}`;
    const label = this.translate.instant(key);
    return label === key ? resource.replace(/_/g, ' ') : label;
  }

  /** A resource as the name of a row: the label with its first letter in capitals (CONT-04). */
  resourceName(resource: string): string {
    const label = this.resourceLabel(resource);
    return label.charAt(0).toLocaleUpperCase(this.languageService.currentLocale()) + label.slice(1);
  }

  usageRatio(metric: { used: number; limit: number }): number {
    return metric.limit > 0 ? Math.min(metric.used / metric.limit, 1) : 0;
  }

  /** A subscription status by what it means: in force, needs attention, or over. */
  statusTone(status: string | undefined): VxTone {
    switch (status) {
      case 'active':
      case 'trialing':
        return 'ok';
      case 'past_due':
      case 'incomplete':
      case 'paused':
        return 'warning';
      case 'unpaid':
      case 'canceled':
      case 'incomplete_expired':
        return 'danger';
      default:
        return 'neutral';
    }
  }

  /** An invoice status by what it means; the same tones as every invoice in the product. */
  invoiceTone(status: string | undefined): VxTone {
    switch (status) {
      case 'paid':
        return 'ok';
      case 'open':
        return 'warning';
      case 'uncollectible':
        return 'danger';
      case 'draft':
        return 'draft';
      default:
        return 'neutral';
    }
  }

  planDescription(description: string | null | undefined): string {
    return translateOrLiteral(this.translate, description);
  }
}

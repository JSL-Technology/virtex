import { TranslateModule, FORMAT_PIPES } from '@virtex/shared/ui-i18n';
import { translateOrLiteral, FormatService } from '@virtex/shared/ui-i18n';
import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed, ViewContainerRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CreditCard, Download, CheckCircle, Info, Zap, ExternalLink, AlertTriangle, RefreshCw, Settings } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { BillingService, BillingOverview, BillingInvoice, UsageMetric } from '../../../core/services/billing';
import { StepUpService, StepUpScope } from '../../../core/services/step-up.service';
import { formatPlanPrice, minorUnitFactorFor } from '../../../core/models/plan.model';
import { LanguageService } from '../../../core/services/language';
import { TranslateService } from '@ngx-translate/core';
import { composeKey } from '@virtex/shared/types';
import { VxSpinnerComponent } from '../../../shared/components/feedback';
import { VxPaymentCardComponent } from '../../../shared/components/payment-card';

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule, TranslateModule, VxSpinnerComponent, VxPaymentCardComponent, ...FORMAT_PIPES],
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

  protected readonly CreditCardIcon = CreditCard;
  protected readonly DownloadIcon = Download;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;
  protected readonly ZapIcon = Zap;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly SettingsIcon = Settings;

  usageMetrics = toSignal(this.billingService.getUsage(), { initialValue: [] as UsageMetric[] });

  overview = signal<BillingOverview | null>(null);
  overviewLoading = signal(true);
  invoices = signal<BillingInvoice[]>([]);

  selectedPlan = signal<string | null>(null);
  isRedirecting = signal(false);
  isOpeningPortal = signal(false);
  checkoutError = signal<string | null>(null);
  successMessage = signal<string | null>(null);

  availablePlans = this.billingService.plans;
  plansState = this.billingService.plansState;

  /**
   * Whether the organization has a provider subscription in force. Only that one has a portal and a
   * card behind it; one the platform granted is changed by subscribing. It decides the WORDING —
   * «change» or «subscribe» — never the flow: the server picks the flow from the real subscription.
   */
  hasActiveSubscription = computed(() => {
    const sub = this.overview()?.subscription;
    return !!sub && sub.managedBy === 'provider' && ['active', 'trialing', 'past_due'].includes(sub.status);
  });

  /** The company this one is billed through; its plan, card and invoices are managed there. */
  billedThrough = computed(() => this.overview()?.billedThrough ?? null);

  currentPlanSlug = computed(() => this.overview()?.plan?.slug ?? null);

  /** The chosen plan's name, as the reader sees it on its card. */
  selectedPlanName = computed(() => {
    const plan = this.availablePlans().find(p => p.slug === this.selectedPlan());
    return plan ? translateOrLiteral(this.translate, plan.name) : '';
  });

  ngOnInit(): void {
    // The provider sends the browser back with `?session_id=…` after buying a subscription, and
    // with `?plan_change=confirmed` after changing the one in force.
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('session_id');
    const planChanged = params.get('plan_change') === 'confirmed';
    if (sessionId || planChanged) {
      // Clean the URL so a refresh doesn't re-run the confirmation or re-show the banner.
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (sessionId) {
      this.confirmCheckout(sessionId);
      return;
    }
    if (planChanged) {
      this.reconcilePlanChange();
      return;
    }

    this.refreshBillingData();
  }

  /**
   * Record a plan change the customer just confirmed on the provider's page, without waiting for
   * the webhook — the same reason `confirmCheckout` exists for a new subscription.
   */
  private reconcilePlanChange(): void {
    this.overviewLoading.set(true);
    this.billingService.reconcileSubscription().subscribe(overview => {
      if (!overview) {
        this.refreshBillingData();
        return;
      }
      this.overview.set(overview);
      this.overviewLoading.set(false);
      this.successMessage.set(this.translate.instant('billing.plan_change.applied'));
      this.loadInvoices(overview);
    });
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
    this.overviewLoading.set(true);
    this.billingService.confirmCheckout(sessionId).subscribe(overview => {
      if (overview) {
        this.overview.set(overview);
        this.overviewLoading.set(false);
        this.successMessage.set(this.translate.instant('billing.checkout.active'));
        this.loadInvoices(overview);
      } else {
        // Confirmation failed (Stripe unreachable, etc.) — fall back to whatever the API reports.
        this.refreshBillingData();
      }
    });
  }

  refreshBillingData(): void {
    this.overviewLoading.set(true);
    this.billingService.getOverview().subscribe(data => {
      this.overview.set(data);
      this.overviewLoading.set(false);
      this.loadInvoices(data);
    });
  }

  /** The invoices are the paying company's: a company billed through its parent has none to list. */
  private loadInvoices(overview: BillingOverview | null): void {
    if (overview?.billedThrough) {
      this.invoices.set([]);
      return;
    }
    this.billingService.getInvoices().subscribe(list => this.invoices.set(list));
  }

  retryLoadPlans(): void {
    this.billingService.loadPlans();
  }

  selectPlan(planSlug: string): void {
    if (planSlug === this.currentPlanSlug()) return;
    this.selectedPlan.set(planSlug);
    this.checkoutError.set(null);
  }

  /** Move to the selected plan. The server decides whether that changes a subscription or buys one. */
  confirmPlanChange(): void {
    const planSlug = this.selectedPlan();
    if (!planSlug) return;

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    this.stepUpService.requireStepUp(StepUpScope.MANAGE_PAYMENT, this.viewContainerRef, () =>
      this.billingService.changePlan(planSlug),
    ).subscribe({
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
    return formatPlanPrice(
      {
        monthlyPrice: amount ?? 0,
        annualPrice: null,
        currency: currency ?? 'USD',
        minorUnits: minorUnits ?? 100,
      },
      // The REGIONAL locale, not the language. `'es'` alone formats as es-419, which is not what
      // a Mexican or an Argentine tenant reads: the group and decimal separators differ.
      this.languageService.currentLocale(),
    );
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

  /** What an invoice was for: the provider's own description, or the reader's words for one. */
  invoiceDescription(invoice: BillingInvoice): string {
    if (invoice.description) return invoice.description;
    return invoice.number
      ? this.translate.instant('billing.invoice_numbered', { number: invoice.number })
      : this.translate.instant('billing.subscription_invoice');
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

  planDescription(description: string | null | undefined): string {
    return translateOrLiteral(this.translate, description);
  }
}

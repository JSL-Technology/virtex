import { Component, ChangeDetectionStrategy, inject, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { LucideAngularModule, CreditCard, Download, CheckCircle, Info, Zap, ExternalLink, AlertTriangle, RefreshCw, Settings } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { BillingService, BillingOverview, BillingInvoice } from '../../../core/services/billing';
import { StepUpService } from '../../../core/services/step-up.service';

@Component({
  selector: 'app-billing-page',
  standalone: true,
  imports: [CommonModule, LucideAngularModule],
  templateUrl: './billing.page.html',
  styleUrls: ['./billing.page.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillingPage implements OnInit {
  private billingService = inject(BillingService);
  private stepUpService = inject(StepUpService);

  protected readonly CreditCardIcon = CreditCard;
  protected readonly DownloadIcon = Download;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly InfoIcon = Info;
  protected readonly ZapIcon = Zap;
  protected readonly ExternalLinkIcon = ExternalLink;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly RefreshCwIcon = RefreshCw;
  protected readonly SettingsIcon = Settings;

  usageMetrics = toSignal(this.billingService.getUsage(), { initialValue: [] as any[] });

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

  // True once the org has an active/trialing subscription managed by Stripe.
  hasActiveSubscription = computed(() => {
    const sub = this.overview()?.subscription;
    return !!sub && ['active', 'trialing', 'past_due'].includes(sub.status);
  });

  currentPlanSlug = computed(() => this.overview()?.plan?.slug ?? null);

  ngOnInit(): void {
    // Returning from a successful Stripe Checkout adds ?session_id=...
    const params = new URLSearchParams(window.location.search);
    if (params.has('session_id')) {
      this.successMessage.set('¡Pago completado! Tu suscripción se está activando. Puede tardar unos segundos en reflejarse.');
      // Clean the URL so a refresh doesn't re-show the banner.
      window.history.replaceState({}, '', window.location.pathname);
    }

    this.refreshBillingData();
  }

  async refreshBillingData(): Promise<void> {
    try {
        await this.stepUpService.requireStepUp('modify_payment_methods');
    } catch (e) {
        this.overviewLoading.set(false);
        return;
    }

    this.overviewLoading.set(true);
    this.billingService.getOverview().subscribe({
      next: (data) => {
        this.overview.set(data);
        this.overviewLoading.set(false);
      },
      error: () => this.overviewLoading.set(false)
    });
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

  async startCheckout(): Promise<void> {
    const planSlug = this.selectedPlan();
    if (!planSlug) return;

    try {
        await this.stepUpService.requireStepUp('modify_payment_methods');
    } catch (e) {
        return;
    }

    this.isRedirecting.set(true);
    this.checkoutError.set(null);

    // Existing subscribers manage plan changes through the Stripe portal
    // (proration, downgrades, etc.); new customers go through Checkout.
    const action$ = this.hasActiveSubscription()
      ? this.billingService.openBillingPortal()
      : this.billingService.startCheckout(planSlug);

    action$.subscribe({
      next: (ok) => {
        if (!ok) {
          this.checkoutError.set('No se pudo iniciar el proceso. Intenta de nuevo.');
          this.isRedirecting.set(false);
        }
        // On success the browser is redirected away — no need to reset state.
      },
      error: (err) => {
        this.checkoutError.set(err?.message || 'Ocurrió un error. Intenta de nuevo.');
        this.isRedirecting.set(false);
      }
    });
  }

  async manageBilling(): Promise<void> {
    try {
        await this.stepUpService.requireStepUp('modify_payment_methods');
    } catch (e) {
        return;
    }

    this.isOpeningPortal.set(true);
    this.checkoutError.set(null);
    this.billingService.openBillingPortal().subscribe({
      next: (ok) => {
        if (!ok) {
          this.checkoutError.set('No se pudo abrir el portal de facturación. Intenta de nuevo.');
          this.isOpeningPortal.set(false);
        }
      },
      error: (err) => {
        this.checkoutError.set(err?.message || 'Ocurrió un error. Intenta de nuevo.');
        this.isOpeningPortal.set(false);
      }
    });
  }

  formatPrice(cents: number | null | undefined): string {
    return ((cents ?? 0) / 100).toFixed(2);
  }

  formatDate(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  statusLabel(status: string | undefined): string {
    switch (status) {
      case 'active': return 'Activa';
      case 'trialing': return 'Prueba';
      case 'past_due': return 'Pago pendiente';
      case 'canceled': return 'Cancelada';
      case 'unpaid': return 'Sin pagar';
      default: return status || '—';
    }
  }
}

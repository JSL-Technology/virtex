import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpContext } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { Plan } from '../models/plan.model';
import { IS_PUBLIC_API } from '../tokens/http-context.tokens';
import { environment } from '../../../environments/environment';

export interface BillingPaymentMethod {
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface BillingSubscription {
  status: string;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingOverview {
  plan: { slug: string; name: string; monthlyPrice: number | null } | null;
  subscription: BillingSubscription | null;
  paymentMethod: BillingPaymentMethod | null;
}

export interface BillingInvoice {
  id: string;
  number: string | null;
  date: string;
  description: string;
  amount: number;
  currency: string;
  status: string;
  pdfUrl: string | null;
  hostedUrl: string | null;
}

export type PlansLoadState = 'loading' | 'loaded' | 'error';

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private apiUrl = environment.apiUrl;

  readonly plans = signal<Plan[]>([]);
  readonly plansState = signal<PlansLoadState>('loading');

  constructor() {
    this.loadPlans();
  }

  loadPlans(): void {
    this.plansState.set('loading');
    // Public on purpose: plans are shown on the unauthenticated registration page.
    // IS_PUBLIC_API tells the auth interceptor NOT to attempt a token refresh /
    // forced logout if this ever 401s — otherwise an anonymous visitor gets
    // bounced to /auth/login just for viewing plans.
    this.http.get<Plan[]>(`${this.apiUrl}/saas/plans`, {
      context: new HttpContext().set(IS_PUBLIC_API, true),
    }).pipe(
      tap(plans => {
        this.plans.set(plans ?? []);
        this.plansState.set('loaded');
      }),
      catchError(err => {
        console.error('Failed to load plans', err);
        this.plansState.set('error');
        return of([]);
      })
    ).subscribe();
  }

  getUsage(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/saas/usage`).pipe(
      catchError(() => of([]))
    );
  }

  getOverview(): Observable<BillingOverview | null> {
    return this.http.get<BillingOverview>(`${this.apiUrl}/payment/overview`).pipe(
      catchError(err => {
        console.error('Failed to load billing overview', err);
        return of(null);
      })
    );
  }

  /** Reconciles the org's plan after returning from Checkout (no webhook needed). */
  confirmCheckout(sessionId: string): Observable<BillingOverview | null> {
    return this.http.post<BillingOverview>(`${this.apiUrl}/payment/checkout/confirm`, { sessionId }).pipe(
      catchError(err => {
        console.error('Failed to confirm checkout', err);
        return of(null);
      })
    );
  }

  getInvoices(): Observable<BillingInvoice[]> {
    return this.http.get<BillingInvoice[]>(`${this.apiUrl}/payment/invoices`).pipe(
      catchError(err => {
        console.error('Failed to load invoices', err);
        return of([]);
      })
    );
  }

  /**
   * Starts a Stripe Checkout session for a brand-new subscription and redirects
   * the browser to the hosted payment page. Returns false if the response has
   * no URL; throws (with a user-facing message) on backend errors.
   */
  startCheckout(planSlug: string, stepUpToken?: string): Observable<boolean> {
    const plan = this.plans().find(p => p.slug === planSlug || p.id === planSlug);
    if (!plan || !plan.monthlyPriceId) {
      console.error('Plan not found or missing Stripe price ID:', planSlug);
      return throwError(() => new Error('Este plan no está disponible para contratación en este momento.'));
    }

    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};

    return this.http.post<{ sessionId: string; url: string }>(`${this.apiUrl}/payment/checkout-session`, {
      priceId: plan.monthlyPriceId,
      successUrl: `${window.location.origin}/settings/billing?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${window.location.origin}/settings/billing`,
    }, { headers }).pipe(
      map(res => {
        if (res.url) {
          window.location.href = res.url;
          return true;
        }
        return false;
      }),
      catchError(err => {
        console.error('Checkout failed', err);
        const message = err?.error?.message || 'No se pudo iniciar el pago. Intenta de nuevo.';
        return throwError(() => new Error(message));
      })
    );
  }

  /**
   * Opens the Stripe Billing Portal so existing subscribers can change plan,
   * update their payment method or cancel — all handled securely by Stripe.
   */
  openBillingPortal(stepUpToken?: string): Observable<boolean> {
    const headers = stepUpToken ? { 'x-step-up-token': stepUpToken } : {};
    return this.http.post<{ url: string }>(`${this.apiUrl}/payment/portal-session`, {
      returnUrl: `${window.location.origin}/settings/billing`,
    }, { headers }).pipe(
      map(res => {
        if (res.url) {
          window.location.href = res.url;
          return true;
        }
        return false;
      }),
      catchError(err => {
        console.error('Portal session failed', err);
        const message = err?.error?.message || 'No se pudo abrir el portal de facturación. Intenta de nuevo.';
        return throwError(() => new Error(message));
      })
    );
  }
}

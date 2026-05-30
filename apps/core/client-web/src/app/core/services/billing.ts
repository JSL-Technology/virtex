import { Injectable, signal, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { map, catchError, tap } from 'rxjs/operators';
import { Plan } from '../models/plan.model';

export interface Subscription {
  planName: string;
  planId: string;
  status: string;
  price: number;
  billingCycle: 'mensual' | 'anual';
  nextBillingDate: string;
  trialEndsDate?: string;
}

interface SubscriptionApiResponse {
  status: string;
  planId: string;
  periodStart: string;
  periodEnd: string;
  gracePeriodEnd: string | null;
  externalSubscriptionId: string | null;
}

export interface PaymentMethod {
  type: string;
  last4: string;
  expiryDate: string;
}

export interface PaymentHistoryItem {
  id: string;
  date: string;
  description: string;
  amount: number;
}

@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private apiUrl = '/api/v1'; // Assuming global prefix

  // Signals for state
  plans = signal<Plan[]>([]);
  currentSubscription = signal<Subscription | null>(null);

  paymentMethod = signal<PaymentMethod>({
    type: 'Visa',
    last4: '4242',
    expiryDate: '12/27'
  });

  paymentHistory = signal<PaymentHistoryItem[]>([
    { id: 'pay_1', date: '2025-07-20', description: 'Suscripción Mensual - Plan Profesional', amount: 49.00 },
    { id: 'pay_2', date: '2025-06-20', description: 'Suscripción Mensual - Plan Profesional', amount: 49.00 },
  ]);

  constructor() {
    this.loadPlans();
    this.loadSubscription();
  }

  loadPlans() {
    this.http.get<Plan[]>(`${this.apiUrl}/saas/plans`).pipe(
      tap(plans => this.plans.set(plans)),
      catchError(err => {
        console.error('Failed to load plans', err);
        return of([]);
      })
    ).subscribe();
  }

  getUsage(): Observable<any[]> {
    return this.http.get<any[]>(`${this.apiUrl}/saas/usage`).pipe(
        catchError(err => {
            console.error('Failed to load usage', err);
            return of([]);
        })
    );
  }

  loadSubscription(): void {
    this.http.get<SubscriptionApiResponse>(`${this.apiUrl}/payment/subscription`).pipe(
      map(res => this.mapSubscription(res)),
      tap(sub => this.currentSubscription.set(sub)),
      catchError(err => {
        console.error('Failed to load subscription', err);
        return of(null);
      })
    ).subscribe();
  }

  private mapSubscription(res: SubscriptionApiResponse): Subscription {
    const plan = this.plans().find(p => p.id === res.planId || p.slug === res.planId);
    return {
      planId: res.planId || '',
      planName: plan?.name || res.planId || 'Sin plan',
      status: res.status || 'unknown',
      price: plan?.monthlyPrice || 0,
      billingCycle: 'mensual',
      nextBillingDate: res.periodEnd ? new Date(res.periodEnd).toLocaleDateString('es-ES') : '',
      trialEndsDate: res.gracePeriodEnd ? new Date(res.gracePeriodEnd).toLocaleDateString('es-ES') : undefined,
    };
  }

  getSubscription(): Observable<Subscription | null> {
    if (this.currentSubscription()) {
      return of(this.currentSubscription());
    }
    return this.http.get<SubscriptionApiResponse>(`${this.apiUrl}/payment/subscription`).pipe(
      map(res => this.mapSubscription(res)),
      tap(sub => this.currentSubscription.set(sub)),
      catchError(err => {
        console.error('Failed to load subscription', err);
        return of(null);
      })
    );
  }

  getPaymentMethod(): Observable<PaymentMethod> {
    return of(this.paymentMethod());
  }

  getPaymentHistory(): Observable<PaymentHistoryItem[]> {
    return of(this.paymentHistory());
  }

  changePlan(newPlanId: string): Observable<boolean> {
    console.log('Cambiando al plan:', newPlanId);
    // In a real app, this would call POST /payment/checkout-session with the priceId from the plan
    const plan = this.plans().find(p => p.slug === newPlanId || p.id === newPlanId);
    if (!plan) return of(false);

    // We would trigger the checkout flow here
    return this.http.post<{ sessionId: string, url: string }>(`${this.apiUrl}/payment/checkout-session`, {
        priceId: plan.monthlyPriceId, // Defaulting to monthly for now
        successUrl: window.location.href,
        cancelUrl: window.location.href
    }).pipe(
        map(res => {
            if (res.url) {
                window.location.href = res.url;
                return true;
            }
            return false;
        }),
        catchError(err => {
            console.error('Checkout failed', err);
            return of(false);
        })
    );
  }
}

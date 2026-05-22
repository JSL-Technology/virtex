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

  // TODO: Fetch real subscription from Organization details or dedicated endpoint
  // For now, keeping mock structure but ready to integrate
  currentSubscription = signal<Subscription>({
    planName: 'Profesional',
    planId: 'pro',
    status: 'Activo',
    price: 49.00,
    billingCycle: 'mensual',
    nextBillingDate: '2025-08-20',
  });

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

  getSubscription(): Observable<Subscription> {
    return of(this.currentSubscription());
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

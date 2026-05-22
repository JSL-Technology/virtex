import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PaymentService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/payment`; // adjusting based on global prefix api/v1 assumption in environment

  getConfig(): Observable<{ prices: { starter: string; pro: string; enterprise: string } }> {
    return this.http.get<{ prices: { starter: string; pro: string; enterprise: string } }>(`${this.apiUrl}/config`);
  }

  createCheckoutSession(priceId: string): Observable<{ sessionId: string; url: string }> {
    return this.http.post<{ sessionId: string; url: string }>(`${this.apiUrl}/checkout-session`, {
      priceId,
      successUrl: window.location.origin + '/payment/success',
      cancelUrl: window.location.origin + '/payment/cancel'
    });
  }
}

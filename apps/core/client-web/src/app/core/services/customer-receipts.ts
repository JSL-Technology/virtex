import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export interface CustomerReceipt {
  id: string;
  receiptNumber: string;
  customerName: string;
  paymentDate: string;
  amount: number;
}

@Injectable({ providedIn: 'root' })
export class CustomerReceiptsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/customer-payments`; // Assuming this is the new endpoint

  // Placeholder methods
  getReceipts(): Observable<CustomerReceipt[]> {
    return this.http.get<CustomerReceipt[]>(this.apiUrl);
  }
}

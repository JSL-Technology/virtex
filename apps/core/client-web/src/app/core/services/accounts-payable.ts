import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

// Interfaces based on backend entities (simplified for now)
export interface VendorBill {
  id: string;
  vendorName: string;
  billNumber: string;
  issueDate: string;
  dueDate: string;
  total: number;
  balance: number;
  status: 'Draft' | 'Submitted' | 'Approved' | 'Paid' | 'Void';
  // Add other fields as needed
}

export interface CreateVendorBillDto {
  supplierId: string;
  billNumber: string;
  issueDate: string;
  dueDate: string;
  lineItems: {
    description: string;
    quantity: number;
    price: number;
    costCenterId?: string;
    expenseAccountId: string;
  }[];
  notes?: string;
}

export type UpdateVendorBillDto = Partial<CreateVendorBillDto>

@Injectable({ providedIn: 'root' })
export class AccountsPayableService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/accounts-payable`;

  getVendorBills(): Observable<VendorBill[]> {
    return this.http.get<VendorBill[]>(this.apiUrl);
  }

  getVendorBillById(id: string): Observable<VendorBill> {
    return this.http.get<VendorBill>(`${this.apiUrl}/${id}`);
  }

  createVendorBill(dto: CreateVendorBillDto): Observable<VendorBill> {
    return this.http.post<VendorBill>(this.apiUrl, dto);
  }

  updateVendorBill(id: string, dto: UpdateVendorBillDto): Observable<VendorBill> {
    return this.http.patch<VendorBill>(`${this.apiUrl}/${id}`, dto);
  }

  voidBill(id: string, reason: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${id}/void`, { reason });
  }

  submitForApproval(id: string): Observable<void> {
    return this.http.post<void>(`${this.apiUrl}/${id}/submit-for-approval`, {});
  }
}

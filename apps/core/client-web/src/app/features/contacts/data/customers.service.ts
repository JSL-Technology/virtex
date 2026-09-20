// app/core/api/customers.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Customer } from '../../../core/models/customer.model';

export type CreateCustomerDto = Omit<Customer, 'id' | 'organizationId' | 'createdAt' | 'updatedAt' | 'totalBilled'>;
export type UpdateCustomerDto = Partial<CreateCustomerDto>;

@Injectable({ providedIn: 'root' })
export class CustomersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/customers`;

  getCustomers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(this.apiUrl);
  }

  /**
   * The customers matching `search`, at most `limit` of them.
   *
   * For the entity pickers. `getCustomers()` above downloads the tenant's whole book, which is the
   * right call for a page that lists them and the wrong one for a field that shows ten at a time —
   * the difference stops being academic somewhere around the first tenant with five thousand
   * customers.
   *
   * An empty term is a real request: it means "the first page", which is what a picker shows the
   * moment it opens and before anything has been typed.
   */
  searchCustomers(search: string, limit: number): Observable<Customer[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Customer[]>(this.apiUrl, { params });
  }

  getCustomerById(id: string): Observable<Customer> {
    return this.http.get<Customer>(`${this.apiUrl}/${id}`);
  }

  createCustomer(customer: CreateCustomerDto): Observable<Customer> {
    return this.http.post<Customer>(this.apiUrl, customer);
  }

  updateCustomer(id: string, customer: UpdateCustomerDto): Observable<Customer> {
    return this.http.patch<Customer>(`${this.apiUrl}/${id}`, customer);
  }

  deleteCustomer(id: string): Observable<void> {
    return this.http.delete<void>(`${this.apiUrl}/${id}`);
  }
}
// app/core/api/accounting.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { Account } from '../../../core/models/account.model';

@Injectable({
  providedIn: 'root'
})
export class AccountingService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/chart-of-accounts`;

  getAccounts(): Observable<Account[]> {
    return this.http.get<Account[]>(this.apiUrl);
  }
  /**
   * Los cuentas que coinciden con `search`, como mucho `limit`.
   *
   * Para los selectores de entidad. `getAccounts()` de arriba se trae el catálogo entero, que es lo
   * correcto para una pantalla que los LISTA y lo que no escala para un campo que enseña diez a la
   * vez. Un término vacío es una petición real: significa «la primera página», que es lo que el
   * campo muestra al abrirse y antes de que nadie teclee.
   */
  searchAccounts(search: string, limit: number): Observable<Account[]> {
    let params = new HttpParams().set('limit', limit);
    if (search.trim()) params = params.set('search', search.trim());
    return this.http.get<Account[]>(this.apiUrl, { params });
  }
}
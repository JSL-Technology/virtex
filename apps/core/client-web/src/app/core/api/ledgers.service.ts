// app/core/api/ledgers.service.ts
import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { GeneralLedger } from '../models/general-ledger.model';
import { Ledger } from '../models/ledger.model';

// FIX: Definir y exportar los DTOs para la creación y actualización.
// Se basan en la entidad Ledger, pero como Partial para permitir campos opcionales.
export type CreateLedgerDto = Partial<Ledger>;
export type UpdateLedgerDto = Partial<Ledger>;

@Injectable({
  providedIn: 'root'
})
export class LedgersService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/accounting/ledgers`;

  /**
   * Obtiene el reporte del Libro Mayor para una cuenta específica.
   */
  getGeneralLedger(accountId: string, startDate: string, endDate: string): Observable<GeneralLedger> {
    const params = new HttpParams()
      .set('accountId', accountId)
      .set('startDate', startDate)
      .set('endDate', endDate);
    return this.http.get<GeneralLedger>(`${this.apiUrl}/general-ledger`, { params });
  }

  /**
   * Obtiene todos los libros contables de la organización.
   */
  getLedgers(): Observable<Ledger[]> {
    return this.http.get<Ledger[]>(this.apiUrl);
  }

  /**
   * Obtiene un libro contable por su ID.
   * FIX: Se ha renombrado 'getLedgerById' a 'getLedger' para coincidir con el uso en el componente.
   */
  getLedger(id: string): Observable<Ledger> {
    return this.http.get<Ledger>(`${this.apiUrl}/${id}`);
  }

  /**
   * Crea un nuevo libro contable.
   */
  createLedger(ledger: CreateLedgerDto): Observable<Ledger> {
    return this.http.post<Ledger>(this.apiUrl, ledger);
  }

  /**
   * Actualiza un libro contable existente.
   * FIX: El ID debe ser un string (UUID), no un número.
   */
  updateLedger(id: string, ledger: UpdateLedgerDto): Observable<Ledger> {
    return this.http.patch<Ledger>(`${this.apiUrl}/${id}`, ledger);
  }
}
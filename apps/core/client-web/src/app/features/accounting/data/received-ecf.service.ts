import { inject, Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../environments/environment';

export type ReceivedEcfStatus = 'RECEIVED' | 'APPROVED' | 'REJECTED';

/** A comprobante a supplier sent to this company's e-CF reception service. */
export interface ReceivedEcf {
  id: string;
  issuerRnc: string;
  issuerName: string | null;
  ncf: string;
  ecfType: string;
  issueDate: string | null;
  total: number;
  itbis: number;
  currencyCode: string;
  signatureValid: boolean;
  status: ReceivedEcfStatus;
  rejectionReason: string | null;
  vendorBillId: string | null;
  receivedAt: string;
}

/** `/einvoicing/received` — the inbox of comprobantes received from suppliers. */
@Injectable({ providedIn: 'root' })
export class ReceivedEcfService {
  private readonly http = inject(HttpClient);
  private readonly api = `${environment.apiUrl}/einvoicing/received`;

  list(status?: ReceivedEcfStatus): Observable<ReceivedEcf[]> {
    const params = status ? new HttpParams().set('status', status) : undefined;
    return this.http.get<ReceivedEcf[]>(this.api, { params });
  }

  /** `1` approves, `2` rejects — the DGII's codes. A rejection carries its reason. */
  answer(id: string, verdict: '1' | '2', rejectionReason?: string): Observable<ReceivedEcf> {
    return this.http.post<ReceivedEcf>(`${this.api}/${id}/answer`, {
      verdict,
      ...(rejectionReason ? { rejectionReason } : {}),
    });
  }

  xml(id: string): Observable<Blob> {
    return this.http.get(`${this.api}/${id}/xml`, { responseType: 'blob' });
  }
}

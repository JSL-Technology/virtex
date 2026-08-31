import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

export type EcfStatus =
  | 'PENDING'
  | 'SIGNED'
  | 'SENT'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_OBSERVATIONS'
  | 'REJECTED'
  | 'CONTINGENCY'
  | 'ERROR';

export interface EcfSubmissionView {
  ncf: string;
  ecfType: string;
  status: EcfStatus;
  trackId: string | null;
  securityCode: string | null;
  qrUrl: string | null;
  messages: string[];
  sentAt: string | null;
  respondedAt: string | null;
}

export interface EcfCertificateView {
  id: string;
  alias: string;
  subjectCommonName?: string;
  serialNumber?: string;
  notBefore?: string;
  notAfter?: string;
  isActive: boolean;
  expired: boolean;
  createdAt: string;
}

export type NcfType =
  | 'B01' | 'B02' | 'B03' | 'B04' | 'B11' | 'B15'
  | 'E31' | 'E32' | 'E33' | 'E34' | 'E41' | 'E43' | 'E44' | 'E45' | 'E46' | 'E47';

export interface NcfSequenceView {
  id: string;
  type: NcfType;
  prefix: string;
  startsAt: number;
  endsAt: number;
  currentSequence: number;
  isActive: boolean;
  expiresAt?: string | null;
}

export interface ProvisionNcfSequenceInput {
  type: NcfType;
  prefix: string;
  startsAt: number;
  endsAt: number;
}

/**
 * Client for the Dominican Republic electronic-invoicing (e-CF) API: certificate management, e-NCF
 * range provisioning, per-invoice e-CF status, and the DGII 606/607 report downloads.
 */
@Injectable({ providedIn: 'root' })
export class EinvoicingService {
  private http = inject(HttpClient);
  private ecfUrl = `${environment.apiUrl}/einvoicing`;
  private complianceUrl = `${environment.apiUrl}/compliance`;

  // ── Certificates ──────────────────────────────────────────────────────────
  listCertificates(): Observable<EcfCertificateView[]> {
    return this.http.get<EcfCertificateView[]>(`${this.ecfUrl}/certificates`);
  }

  uploadCertificate(file: File, password: string, alias: string): Observable<EcfCertificateView> {
    const form = new FormData();
    form.append('file', file);
    form.append('password', password);
    form.append('alias', alias);
    return this.http.post<EcfCertificateView>(`${this.ecfUrl}/certificates`, form);
  }

  deactivateCertificate(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.ecfUrl}/certificates/${id}`);
  }

  // ── Per-invoice e-CF ──────────────────────────────────────────────────────
  getInvoiceStatus(invoiceId: string): Observable<EcfSubmissionView> {
    return this.http.get<EcfSubmissionView>(`${this.ecfUrl}/invoices/${invoiceId}/status`);
  }

  submitInvoice(invoiceId: string): Observable<EcfSubmissionView> {
    return this.http.post<EcfSubmissionView>(`${this.ecfUrl}/invoices/${invoiceId}/submit`, {});
  }

  downloadXml(invoiceId: string): Observable<Blob> {
    return this.http.get(`${this.ecfUrl}/invoices/${invoiceId}/xml`, { responseType: 'blob' });
  }

  // ── e-NCF sequences ───────────────────────────────────────────────────────
  listSequences(): Observable<NcfSequenceView[]> {
    return this.http.get<NcfSequenceView[]>(`${this.complianceUrl}/ncf-sequences`);
  }

  provisionSequence(input: ProvisionNcfSequenceInput): Observable<NcfSequenceView> {
    return this.http.post<NcfSequenceView>(`${this.complianceUrl}/ncf-sequences`, input);
  }

  // ── DGII reports (606/607) ────────────────────────────────────────────────
  downloadReport(kind: '606' | '607', year: number, month: number): Observable<Blob> {
    return this.http.get(`${this.complianceUrl}/reports/${kind}`, {
      params: { year, month },
      responseType: 'blob',
    });
  }
}

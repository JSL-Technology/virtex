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
  /** The regime it signs for (`DGII`, `CFDI`, `DIAN`…): one active certificate per regime. */
  regime?: string;
  /** The identifier the certificate was issued to, without separators. */
  holderTaxId?: string | null;
  /** `company`: issued to the company's identifier. `person`: to a natural person's. */
  holderKind?: 'company' | 'person' | null;
  /** The name of that identifier in the regime's market: `RNC`, `Cédula`, `RFC`, `NIT`… */
  holderIdLabel?: string | null;
  /** The tax authority the certificate signs for: `DGII`, `SAT`, `DIAN`… */
  authority?: string | null;
  issuerCommonName?: string | null;
  /** Self-signed test certificate, accepted only in development. */
  isTest?: boolean;
  isActive: boolean;
  expired: boolean;
  createdAt: string;
}

/**
 * Client for the electronic-invoicing API: certificate management and per-invoice transmission
 * status. The authorised ranges are every market's (`FiscalSettingsService.ranges`); the periodic
 * returns are `FiscalReturnsService`'s.
 */
/** One document's transmission to its authority, for every regime but the Dominican one. */
export interface RegimeSubmissionView {
  id: string;
  invoiceId: string;
  countryCode: string;
  regime: string;
  fiscalNumber: string | null;
  status: 'PENDING' | 'NOT_CONFIGURED' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'ERROR';
  documentKey: string | null;
  trackingId: string | null;
  messages: string[];
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  respondedAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class EinvoicingService {
  private http = inject(HttpClient);
  private ecfUrl = `${environment.apiUrl}/einvoicing`;

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
  /**
   * What the DGII knows about this invoice, or `null` when it has never been transmitted.
   *
   * `null` is an ordinary answer, not a failure: a tenant with no certificate has no submission
   * for any invoice, and this is asked on every document open. The endpoint used to answer `404`,
   * so the browser logged a failed request each time and the caller had to catch an error to
   * learn something normal.
   */
  /** Where an invoice's electronic document stands outside DO (CFDI, DIAN, SUNAT, SRI, SII, NF-e, AFIP). */
  getRegimeSubmission(invoiceId: string): Observable<RegimeSubmissionView | null> {
    return this.http.get<RegimeSubmissionView | null>(`${this.ecfUrl}/regime/submissions/invoice/${invoiceId}`);
  }

  retryRegimeSubmission(submissionId: string): Observable<RegimeSubmissionView> {
    return this.http.post<RegimeSubmissionView>(`${this.ecfUrl}/regime/submissions/${submissionId}/retry`, {});
  }

  getInvoiceStatus(invoiceId: string): Observable<EcfSubmissionView | null> {
    return this.http.get<EcfSubmissionView | null>(`${this.ecfUrl}/invoices/${invoiceId}/status`);
  }

  submitInvoice(invoiceId: string): Observable<EcfSubmissionView> {
    return this.http.post<EcfSubmissionView>(`${this.ecfUrl}/invoices/${invoiceId}/submit`, {});
  }

  downloadXml(invoiceId: string): Observable<Blob> {
    return this.http.get(`${this.ecfUrl}/invoices/${invoiceId}/xml`, { responseType: 'blob' });
  }
}

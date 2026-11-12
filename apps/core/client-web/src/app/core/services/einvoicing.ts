import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

/**
 * Where a document stands with its authority. One vocabulary for every market: the Dominican e-CF
 * had states of its own while six other regimes shared another set.
 *
 * `CONTINGENCY` is a document issued while the authority could not be reached — the sale happened
 * and the number is spent, so it is owed and retried. `ACCEPTED_WITH_OBSERVATIONS` is an
 * authority's own third verdict («Aceptado Condicional»): the document stands and the observations
 * are the taxpayer's to read.
 */
export type FiscalSubmissionStatus =
  | 'PENDING'
  | 'NOT_CONFIGURED'
  | 'SENT'
  | 'CONTINGENCY'
  | 'ACCEPTED'
  | 'ACCEPTED_WITH_OBSERVATIONS'
  | 'REJECTED'
  | 'ERROR';

/**
 * One document's transmission to its authority, in any market with a regime.
 *
 * `fiscalNumber` is the number that authority gave it (an e-NCF, a folio, a CAE); `documentKey` the
 * identifier it recomputes from the document itself (the Dominican código de seguridad, a CUFE, a
 * clave de acceso); `verificationUrl` where its portal resolves the document, which is what the QR
 * of the printed representation encodes. The sealed document is not here: it is downloaded from its
 * own route by whoever may read it.
 */
export interface FiscalSubmissionView {
  id: string;
  invoiceId: string;
  countryCode: string;
  regime: string;
  fiscalNumber: string | null;
  documentType: string | null;
  status: FiscalSubmissionStatus;
  documentKey: string | null;
  trackingId: string | null;
  verificationUrl: string | null;
  authorization: string | null;
  messages: string[];
  attempts: number;
  nextAttemptAt: string | null;
  lastError: string | null;
  sentAt: string | null;
  respondedAt: string | null;
}

/**
 * A signing certificate as the settings screen shows it.
 *
 * Named for what it is rather than for one authority's document: the type was `EcfCertificateView`
 * and this service `ecfUrl`, which is the Dominican e-CF in a screen eight markets use.
 */
export interface FiscalCertificateView {
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
 * status, in every market with a regime. The authorised ranges are every market's
 * (`FiscalSettingsService.ranges`); the periodic returns are `FiscalReturnsService`'s.
 */
@Injectable({ providedIn: 'root' })
export class EinvoicingService {
  private http = inject(HttpClient);
  private baseUrl = `${environment.apiUrl}/einvoicing`;

  // ── Certificates ──────────────────────────────────────────────────────────
  listCertificates(): Observable<FiscalCertificateView[]> {
    return this.http.get<FiscalCertificateView[]>(`${this.baseUrl}/certificates`);
  }

  uploadCertificate(file: File, password: string, alias: string): Observable<FiscalCertificateView> {
    const form = new FormData();
    form.append('file', file);
    form.append('password', password);
    form.append('alias', alias);
    return this.http.post<FiscalCertificateView>(`${this.baseUrl}/certificates`, form);
  }

  deactivateCertificate(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(`${this.baseUrl}/certificates/${id}`);
  }

  // ── Per-invoice e-CF ──────────────────────────────────────────────────────
  /**
   * Where this invoice's document stands with its authority, or `null` when it owes none.
   *
   * `null` is an ordinary answer, not a failure: a tenant with no certificate has no submission
   * for any invoice, and this is asked on every document open. The endpoint used to answer `404`,
   * so the browser logged a failed request each time and the caller had to catch an error to
   * learn something normal.
   */
  getInvoiceStatus(invoiceId: string): Observable<FiscalSubmissionView | null> {
    return this.http.get<FiscalSubmissionView | null>(`${this.baseUrl}/invoices/${invoiceId}/status`);
  }

  /** Transmit it now, or ask the authority again about one already sent. */
  submitInvoice(invoiceId: string): Observable<FiscalSubmissionView> {
    return this.http.post<FiscalSubmissionView>(`${this.baseUrl}/invoices/${invoiceId}/submit`, {});
  }

  /** The same, from the fiscal-settings screen, where a submission is known by its own id. */
  retrySubmission(submissionId: string): Observable<FiscalSubmissionView> {
    return this.http.post<FiscalSubmissionView>(`${this.baseUrl}/regime/submissions/${submissionId}/retry`, {});
  }

  downloadXml(invoiceId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/invoices/${invoiceId}/xml`, { responseType: 'blob' });
  }
}

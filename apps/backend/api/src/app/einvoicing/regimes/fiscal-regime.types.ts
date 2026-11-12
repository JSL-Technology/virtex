import { EntityManager } from 'typeorm';
import { Invoice } from '../../invoices/entities/invoice.entity';
import { LoadedCertificate } from '../services/certificate-vault.service';

/**
 * One country's electronic invoicing regime, from the document to the authority's verdict.
 *
 * ## Why a second interface beside `FiscalAdapter`
 *
 * `FiscalAdapter` answers one question — what fiscal number does this document get — and the audit
 * found the interface adequate for it. It says nothing about the rest of the regime: building the
 * document in the authority's schema, sealing it with the taxpayer's certificate, transmitting it,
 * and reconciling the verdict that comes back hours later. The Dominican implementation does all
 * four, spread across `ecf-xml-builder`, `ecf-signer`, `dgii-transport` and `ecf-reconciler`, with
 * no shape naming what they collectively are. Six more regimes each reimplementing that shape
 * differently is how a module becomes unmaintainable.
 *
 * ## The honest boundary, stated once
 *
 * Every step this product controls is implemented and tested: the document, the seal, the shape of
 * the request. The last step — the exchange with the authority or its authorised agent — needs the
 * taxpayer's own certificate and, in several markets, a commercial contract and a homologation
 * process. Those are configured per tenant, and the transport calls the real endpoint when they
 * are present. No step is simulated, and no response is fabricated: a regime with no credentials
 * configured refuses to transmit and says so, which is what `GenericFiscalAdapter` has always done
 * for a market with no regime at all.
 */

/** A document built and sealed, ready to transmit. */
export interface SealedFiscalDocument {
  /** The serialised document, in whatever the regime's schema is. */
  payload: string;
  /** `application/xml`, `application/json` — what the transport must declare. */
  contentType: string;
  /**
   * The regime's own identifier for the document, computed at build time.
   *
   * The CUFE in Colombia, the clave de acceso in Ecuador, the chave de acesso in Brazil: a hash or
   * a check-digited string derived from the document's own fields, which the authority recomputes
   * and compares. Null in a regime that assigns the identifier itself on acceptance.
   *
   * A regime that derives it from the SEAL rather than from the document fills it in `seal`: the
   * Dominican código de seguridad is the first characters of the signature's own digest.
   */
  documentKey: string | null;
  /**
   * Where the authority's portal verifies this document, as printed on it — the Dominican QR of
   * the representación impresa, the NFC-e QR, the SRI's «consulta por clave de acceso». Absent in a
   * regime that prints no such link.
   */
  verificationUrl?: string | null;
  /**
   * The number the AUTHORITY settles when the document is transmitted, where its regime assigns it
   * then rather than from a range the taxpayer draws (`AUTHORITY_ON_TRANSMISSION`).
   *
   * AFIP is the case: the taxpayer asks for the next number of a punto de venta and AFIP authorises
   * that number together with the CAE, so the document HAS no number until the exchange succeeds.
   * The regime reports it here and the outbox records it on acceptance, which is what makes the
   * number available to the printed document and to the notes that later refer to it — without it,
   * the product never learns which number the authority authorised for its own document.
   */
  assignedNumber?: AuthorityAssignedNumber | null;
}

/** A number the authority itself assigned, in the three forms everything downstream needs. */
export interface AuthorityAssignedNumber {
  /** As a person reads it on the document: AFIP's `0004-00000123`. */
  fiscalNumber: string;
  /** The consecutive the authority counts, bare. */
  sequence: number;
  /** The series it belongs to: AFIP's punto de venta, an establishment's point. */
  series: string;
}

/** What the authority answered, or what stopped us asking. */
export interface FiscalTransmissionResult {
  /**
   * How the submission ended.
   *
   * `NOT_CONFIGURED` is not a failure of the document: it means the tenant has not supplied the
   * certificate or the endpoint credentials this regime needs. The document is valid and stored;
   * it simply has not been sent. Distinguishing it from `REJECTED` matters because one is fixed in
   * settings and the other by correcting the invoice.
   *
   * `ACCEPTED_WITH_OBSERVATIONS` is the authority's own third verdict where it has one — «Aceptado
   * Condicional» at the DGII, an accepted CDR carrying observations at SUNAT. The document stands;
   * the observations are the taxpayer's to read, and flattening them into `ACCEPTED` loses them.
   *
   * `CONTINGENCY` is the document issued while the authority could not be reached. The sale
   * happened and the number is spent, so it is owed to the authority and retried — never confused
   * with a document nobody tried to send (`PENDING`) or one we failed to build (`ERROR`).
   */
  status: 'ACCEPTED' | 'ACCEPTED_WITH_OBSERVATIONS' | 'PENDING' | 'REJECTED' | 'NOT_CONFIGURED' | 'CONTINGENCY';
  /** The authority's tracking handle: trackId, CAE, número de autorización, protocolo. */
  trackingId?: string | null;
  /** The stamp the authority returned, where it returns one to keep. */
  authorization?: string | null;
  /** Every message the authority sent, verbatim. Never summarised: they are the audit evidence. */
  messages: string[];
  /** The raw response, stored so a rejection can be diagnosed without re-sending. */
  raw?: unknown;
}

export interface FiscalRegimeContext {
  invoice: Invoice;
  organizationId: string;
  manager: EntityManager;
  /**
   * Which attempt this is, counting from 1.
   *
   * A regime that can ask the authority whether it already holds the document does so from the
   * second attempt onwards: a retry after a dropped connection must not transmit a second time
   * what the authority already accepted, which is how one sale ends with two fiscal documents.
   */
  attempt: number;
}

/**
 * The four steps every regime performs, in order.
 *
 * Split rather than folded into one `submit()` because they fail differently and are diagnosed
 * differently: a build failure is a document the tenant must correct, a seal failure is a
 * certificate problem, a transmit failure is usually the authority being down, and a status check
 * is something a scheduler repeats for hours afterwards.
 */
export interface FiscalRegimeAdapter {
  /** ISO 3166-1 alpha-2 of the market this implements. */
  readonly countryCode: string;
  /** The regime's own name, as the authority calls it: `DGII e-CF`, `CFDI 4.0`, `NFe 4.0`. */
  readonly regime: string;

  /** The document in the authority's schema, with its computed key. Unsigned. */
  build(context: FiscalRegimeContext): Promise<SealedFiscalDocument>;

  /**
   * The taxpayer's active certificate for this regime, decrypted for the length of one signature.
   *
   * Part of the interface rather than each adapter's private business because `seal` takes the
   * certificate as an argument, so whoever orchestrates the four steps has to obtain it — and the
   * only thing that knows which stored certificate belongs to this regime is the regime. Throws
   * `RegimeNotConfigured` when the tenant has not uploaded one, which is a settings problem and
   * not a defective document.
   */
  loadCertificate(context: FiscalRegimeContext): Promise<LoadedCertificate>;

  /**
   * The same document, sealed with the taxpayer's certificate.
   *
   * It takes the context, and may answer asynchronously, because sealing is where a regime learns
   * things that depend on the signature itself: the Dominican código de seguridad is derived from
   * it, and the QR printed on the document quotes both that code and the tenant's own timbre
   * endpoint. A regime whose seal needs neither simply ignores them.
   */
  seal(
    document: SealedFiscalDocument,
    certificate: LoadedCertificate,
    context: FiscalRegimeContext,
  ): SealedFiscalDocument | Promise<SealedFiscalDocument>;

  /**
   * Send it. Returns `NOT_CONFIGURED` rather than throwing when the tenant has not supplied
   * credentials, because that is a settings problem and not a defective document.
   */
  transmit(
    document: SealedFiscalDocument,
    context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult>;

  /** Ask again about a document already sent. Regimes that answer synchronously return it as-is. */
  checkStatus(
    trackingId: string,
    context: FiscalRegimeContext,
  ): Promise<FiscalTransmissionResult>;

  /**
   * Whether this tenant can actually transmit — asked BEFORE a document is issued, because a
   * number spent on a document the authority never receives cannot be unspent.
   *
   * Optional, and what it means differs by regime: most need an endpoint and a credential the
   * tenant configures (`TransmissionConfigService`), which is what the caller falls back to. The
   * DGII publishes its own endpoints and authenticates with the taxpayer's certificate, so its
   * channel IS that certificate and asking for a configured endpoint would block every Dominican
   * e-CF.
   */
  isTransmissionConfigured?(context: Pick<FiscalRegimeContext, 'organizationId' | 'manager'>): Promise<boolean>;
}

/** Thrown by a regime when the tenant has not configured what it needs. Never a 500. */
export class RegimeNotConfigured extends Error {
  constructor(
    readonly regime: string,
    readonly missing: string,
  ) {
    super(`${regime}: falta configurar ${missing}`);
  }
}

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
   */
  documentKey: string | null;
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
   */
  status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'NOT_CONFIGURED';
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

  /** The same document, sealed with the taxpayer's certificate. */
  seal(document: SealedFiscalDocument, certificate: LoadedCertificate): SealedFiscalDocument;

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

import { fiscalDocumentTypesFor } from './fiscal-document-type-catalogue';
import { findCountryProfile } from './country-profiles';

/**
 * How an issued sales document is cancelled in each market (audit 2026-11-07, FAC-INV-05).
 *
 * There is no single answer, so there is no single rule in the core. What the authority allows:
 *
 *  - `VOID`             — the document carries no fiscal number: it is a commercial document the
 *                         authority never saw, voided if nothing touched it (the United States, and
 *                         every market where the product does not issue the authority's documents).
 *  - `REPORT`           — annulled by the issuer and declared in a periodic return, with a reason
 *                         from the authority's catalogue: the Dominican pre-printed series (608).
 *  - `CREDIT_NOTE_ONLY` — an issued fiscal document is never annulled: it is reversed with a credit
 *                         note (Colombia, Chile, Argentina, a Dominican e-CF).
 *  - `AUTHORITY_EVENT`  — a cancellation the authority registers, within its window and with its
 *                         reasons (Mexico's CFDI cancellation, Brazil's NF-e cancelamento, Peru's
 *                         comunicación de baja, Ecuador's anulación). No regime of the product sends
 *                         that event yet, so these markets are told so and offered the credit note.
 *
 * A market whose rule is not stated here never voids a fiscal document: a credit note is always a
 * lawful way back, an annulment the authority does not recognise is not. Rules per market are a
 * starting point to confirm with a local accountant.
 */
export type CancellationRoute =
  | { kind: 'VOID' }
  | { kind: 'REPORT'; reasonCatalogue: 'INVOICE_CANCELLATION' }
  | { kind: 'CREDIT_NOTE_ONLY' }
  | { kind: 'AUTHORITY_EVENT'; implemented: false };

export interface CancellableDocument {
  fiscalNumber?: string | null;
  fiscalDocumentType?: string | null;
}

const VOID: CancellationRoute = { kind: 'VOID' };
const REPORT: CancellationRoute = { kind: 'REPORT', reasonCatalogue: 'INVOICE_CANCELLATION' };
const CREDIT_NOTE_ONLY: CancellationRoute = { kind: 'CREDIT_NOTE_ONLY' };
const AUTHORITY_EVENT: CancellationRoute = { kind: 'AUTHORITY_EVENT', implemented: false };

/** The rule for a document that DOES carry the authority's number, by market. */
const FISCAL_RULES: Readonly<Record<string, (electronic: boolean) => CancellationRoute>> = {
  // Serie B is annulled and reported in the 608; an e-CF the DGII received is reversed with an E34.
  DO: (electronic) => (electronic ? CREDIT_NOTE_ONLY : REPORT),
  CO: () => CREDIT_NOTE_ONLY,
  CL: () => CREDIT_NOTE_ONLY,
  AR: () => CREDIT_NOTE_ONLY,
  MX: () => AUTHORITY_EVENT,
  BR: () => AUTHORITY_EVENT,
  PE: () => AUTHORITY_EVENT,
  EC: () => AUTHORITY_EVENT,
};

/** Whether the market's catalogue marks the document's type as signed and transmitted. */
export function isElectronicDocumentType(countryCode: string | null | undefined, documentType: string | null | undefined): boolean {
  if (!countryCode || !documentType) return false;
  return fiscalDocumentTypesFor(countryCode).find((spec) => spec.code === documentType.toUpperCase())?.isElectronic ?? false;
}

export function cancellationRouteFor(countryCode: string | null | undefined, document: CancellableDocument): CancellationRoute {
  if (!document.fiscalNumber) return VOID;
  const rule = FISCAL_RULES[(countryCode ?? '').toUpperCase()];
  if (!rule) return CREDIT_NOTE_ONLY;
  return rule(isElectronicDocumentType(countryCode, document.fiscalDocumentType));
}

/**
 * The route a market applies to the fiscal documents it issues, for coverage: whether cancelling
 * one is something the product can do there. The most demanding of the market's routes counts.
 */
export function cancellationCoverageFor(countryCode: string | null | undefined): { implemented: boolean; detail: string } {
  const country = (countryCode ?? '').toUpperCase();
  const rule = FISCAL_RULES[country];
  const authority = findCountryProfile(country)?.fiscalAuthority ?? country;
  if (!rule) return { implemented: true, detail: 'VOID' };
  const routes = [rule(false), rule(true)];
  if (routes.some((route) => route.kind === 'AUTHORITY_EVENT')) return { implemented: false, detail: authority };
  return { implemented: true, detail: routes.map((route) => route.kind).join(' / ') };
}

/** The authority's name, for messages: `DGII`, `SAT`, `DIAN`. */
export function fiscalAuthorityOf(countryCode: string | null | undefined): string {
  return findCountryProfile((countryCode ?? '').toUpperCase())?.fiscalAuthority ?? (countryCode ?? '').toUpperCase();
}

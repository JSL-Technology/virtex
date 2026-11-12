import type {
  AdjustmentReason,
  CancellationRoute,
  CounterpartyVerdictValue,
  FiscalDocumentTypeSpec,
} from '../contracts';
import { CREDIT_NOTE_ONLY, VOID } from '../kit/documents';
import { allMarkets, knownMarket, marketFor, normalizeMarketCode } from '../registry';

/**
 * The sales documents across the catalogue, and what may be done with one once issued.
 */

/** Every document type every market declares, as `fiscal_document_type_definitions` is seeded. */
export const FISCAL_DOCUMENT_TYPES: readonly FiscalDocumentTypeSpec[] = Object.freeze(
  allMarkets().flatMap((market) =>
    market.documents.types.map(
      (type): FiscalDocumentTypeSpec => ({ countryCode: market.code, ...type, isCreditNote: type.purpose === 'CREDIT_NOTE' }),
    ),
  ),
);

/** Every declared type for a country, in the order a form should offer them. */
export function fiscalDocumentTypesFor(countryCode: string): FiscalDocumentTypeSpec[] {
  const country = normalizeMarketCode(countryCode);
  return FISCAL_DOCUMENT_TYPES.filter((spec) => spec.countryCode === country).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** A document whose cancellation is asked about: whether it carries the authority's number, and its type. */
export interface CancellableDocument {
  fiscalNumber?: string | null;
  fiscalDocumentType?: string | null;
}

/**
 * Whether the market's catalogue marks the document's type as signed and transmitted. A document
 * whose type was not recorded is recognised by its number, against the mask the catalogue gives each
 * type: the market's data, not a pattern written for one country. A document neither identifies is
 * treated as electronic — the safer reading, since an electronic document is only ever reversed.
 */
export function isElectronicDocumentType(
  countryCode: string | null | undefined,
  documentType: string | null | undefined,
  fiscalNumber?: string | null,
): boolean {
  if (!countryCode) return false;
  const types = fiscalDocumentTypesFor(countryCode);
  const byCode = documentType ? types.find((spec) => spec.code === documentType.toUpperCase()) : undefined;
  if (byCode) return byCode.isElectronic;
  const number = (fiscalNumber ?? '').toUpperCase();
  const byMask = number
    ? types.find((spec) => {
        const prefix = spec.sequenceFormat?.replace(/#+$/, '') ?? '';
        return prefix.length > 0 && number.startsWith(prefix) && number.length === (spec.sequenceFormat?.length ?? 0);
      })
    : undefined;
  if (byMask) return byMask.isElectronic;
  return Boolean(documentType || number);
}

/**
 * How an issued document is cancelled in its market. A document with no fiscal number is a
 * commercial document the authority never saw: voided. One that carries the authority's number
 * follows the market's policy; a market whose policy is not stated never voids a fiscal document —
 * a credit note is always a lawful way back, an annulment the authority does not recognise is not.
 */
export function cancellationRouteFor(countryCode: string | null | undefined, document: CancellableDocument): CancellationRoute {
  if (!document.fiscalNumber) return VOID;
  const policy = marketFor(countryCode).documents.cancellation;
  if (!policy) return CREDIT_NOTE_ONLY;
  return isElectronicDocumentType(countryCode, document.fiscalDocumentType, document.fiscalNumber)
    ? policy.electronic
    : policy.traditional;
}

/**
 * Whether cancelling the market's fiscal documents is something the product can do there, for
 * coverage. The most demanding of the market's routes counts.
 */
export function cancellationCoverageFor(countryCode: string | null | undefined): { implemented: boolean; detail: string } {
  const policy = marketFor(countryCode).documents.cancellation;
  if (!policy) return { implemented: true, detail: 'VOID' };
  const routes = [policy.traditional, policy.electronic];
  if (routes.some((route) => route.kind === 'AUTHORITY_EVENT')) return { implemented: false, detail: fiscalAuthorityOf(countryCode) };
  return { implemented: true, detail: routes.map((route) => route.kind).join(' / ') };
}

/**
 * The authority's code for the reason a note carries — the DGII's `CodigoModificacion`, and each
 * other authority's own — or null where the market writes none on a note. The document stores the
 * canonical reason; this is the only place it becomes one market's code.
 */
export function adjustmentCodeFor(
  countryCode: string | null | undefined,
  reason: AdjustmentReason | null | undefined,
  purpose: 'CREDIT_NOTE' | 'DEBIT_NOTE',
): string | null {
  if (!reason) return null;
  const codes = marketFor(countryCode).documents.adjustmentCodes;
  const catalogue = purpose === 'CREDIT_NOTE' ? codes?.creditNote : codes?.debitNote;
  // Indexed as a plain record because the reason is canonical and the catalogue is per kind: a
  // reason that belongs to the other kind of note has no code here, and answering null is how the
  // regime comes to refuse it rather than write a code from the wrong catalogue.
  return (catalogue as Readonly<Record<string, string | undefined>> | null | undefined)?.[reason] ?? null;
}

/**
 * The authority's code for what the receiver of a document answered about it, or null where this
 * market's authority asks the receiver nothing.
 */
export function counterpartyVerdictCodeFor(
  countryCode: string | null | undefined,
  verdict: CounterpartyVerdictValue | null | undefined,
): string | null {
  if (!verdict) return null;
  return marketFor(countryCode).documents.counterpartyVerdictCodes?.[verdict] ?? null;
}

/** The authority's name, for messages: the market's own (`fiscalAuthority`), or the code itself. */
export function fiscalAuthorityOf(countryCode: string | null | undefined): string {
  return knownMarket(countryCode)?.profile.fiscalAuthority ?? normalizeMarketCode(countryCode);
}

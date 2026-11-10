import type { CancellationRoute, DrawnSequence, MarketFiscalDocumentType, MarketNumbering } from '../contracts';

export const VOID: CancellationRoute = { kind: 'VOID' };
export const REPORT_IN_RETURN: CancellationRoute = { kind: 'REPORT', reasonCatalogue: 'INVOICE_CANCELLATION' };
export const CREDIT_NOTE_ONLY: CancellationRoute = { kind: 'CREDIT_NOTE_ONLY' };
export const AUTHORITY_EVENT: CancellationRoute = { kind: 'AUTHORITY_EVENT', implemented: false };

/**
 * Writes a drawn number by its type's mask (`B01########` → `B01` and eight digits): the shape the
 * authority fixes for the type, from the market's own catalogue. A type with no mask is written bare.
 */
export function formatByMask(types: readonly MarketFiscalDocumentType[]): (drawn: DrawnSequence) => string {
  return (drawn) => {
    const mask = types.find((type) => type.code === drawn.documentType)?.sequenceFormat ?? null;
    if (!mask) return String(drawn.sequence);
    const width = (mask.match(/#/g) ?? []).length;
    return `${mask.replace(/#+$/, '')}${String(drawn.sequence).padStart(width, '0')}`;
  };
}

/** A market whose authority documents the product does not issue: the commercial number is the only one. */
export const NO_FISCAL_NUMBERING: MarketNumbering = {
  source: 'NONE',
  emissionKinds: [],
  requestedType: 'CONFIRM',
  typeOf: () => null,
};

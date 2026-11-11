import type { ReceivedDocumentCheck } from '../contracts';

/** A check result, completed with what an ordinary outcome leaves out. */
export function receivedDocumentResult(kind: string, partial: Partial<ReceivedDocumentCheck>): ReceivedDocumentCheck {
  return { status: 'ok', kind, normalized: null, type: null, error: null, warnings: [], requiresSupplierTaxId: false, ...partial };
}

/**
 * A number with no published shape the product checks: kept as printed and flagged as not verified.
 * An empty one is missing.
 */
export function unverifiedNumber(kind: string): (raw: string) => ReceivedDocumentCheck {
  return (raw) => {
    const text = (raw ?? '').trim();
    if (!text) return receivedDocumentResult(kind, { status: 'missing' });
    return receivedDocumentResult(kind, { status: 'unverified', normalized: text.slice(0, 64) });
  };
}

/** The number on a document no authority numbers: the supplier's own invoice number. */
export const SUPPLIER_INVOICE_NUMBER = {
  kind: 'INVOICE_NUMBER',
  labelKey: 'localization.country_pack.supplier_document.invoice_number',
  description: "the supplier's own invoice number",
  example: 'INV-000123',
  check: unverifiedNumber('INVOICE_NUMBER'),
} as const;

/** The number an authority assigned to the supplier's document, in a market whose shape is not checked. */
export const AUTHORITY_FISCAL_NUMBER = {
  kind: 'FISCAL_NUMBER',
  labelKey: 'localization.country_pack.supplier_document.fiscal_number',
  description: "the fiscal document number the tax authority assigned to the supplier's invoice",
  check: unverifiedNumber('FISCAL_NUMBER'),
} as const;

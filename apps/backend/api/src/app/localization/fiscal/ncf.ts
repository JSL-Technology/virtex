import { fiscalDocumentTypesFor } from './fiscal-document-type-catalogue';

/**
 * A comprobante fiscal (NCF or e-CF) as received on a purchase, checked against the DGII's rules.
 *
 * The shape is fixed by the DGII: a series letter, the two-digit document type, then the sequence —
 * eight digits for a traditional `B` comprobante (11 characters), ten for an electronic `E` one
 * (13). The type must be one the DGII defines (the catalogue in `fiscal-document-type-catalogue`).
 *
 * What is WRONG blocks: a malformed number or an unknown type cannot be filed in the 606. What is
 * merely UNUSUAL warns, because it can be right: a consumer invoice (B02/E32) is a valid purchase
 * document, it just carries no ITBIS credit; a credit note belongs on a debit note, not on a bill.
 */
export interface ReceivedNcf {
  /** Upper-cased, without spaces or dashes. */
  normalized: string;
  /** `B01`, `E31`… */
  type: string;
  electronic: boolean;
  /**
   * Issued by the company itself as the buyer (B11/B13/B17, E41/E43/E47): to an informal supplier,
   * for minor expenses, for a payment abroad. Such a purchase need not name a supplier with an RNC.
   */
  selfIssued: boolean;
  /** True when the 606 needs the supplier's RNC or cédula for this purchase. */
  requiresSupplierTaxId: boolean;
  warnings: ReceivedNcfWarning[];
}

export type ReceivedNcfWarning = 'no_tax_credit' | 'credit_note_on_bill' | 'sales_only_type';

export type ReceivedNcfError = 'format' | 'unknown_type';

export type ReceivedNcfCheck = { ok: true; ncf: ReceivedNcf } | { ok: false; error: ReceivedNcfError; normalized: string };

const SHAPE = /^(?:B(\d{2})\d{8}|E(\d{2})\d{10})$/;

/** Types a supplier issues to the buyer that give the buyer no ITBIS credit. */
const NO_CREDIT = new Set(['B02', 'E32']);
/** Self-issued types for purchases where the counterparty has no Dominican tax id. */
const NO_SUPPLIER_TAX_ID = new Set(['B13', 'E43', 'B17', 'E47']);
/**
 * Types that are not a purchase document: a seller's export or a government invoice issued BY the
 * company. Received from a supplier they are almost certainly misread.
 */
const NOT_RECEIVED = new Set(['B16', 'E46']);

export function normalizeNcf(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[\s-]/g, '');
}

export function checkReceivedNcf(raw: string): ReceivedNcfCheck {
  const normalized = normalizeNcf(raw);
  const match = SHAPE.exec(normalized);
  if (!match) return { ok: false, error: 'format', normalized };
  const type = normalized.slice(0, 3);
  const spec = fiscalDocumentTypesFor('DO').find((entry) => entry.code === type);
  if (!spec) return { ok: false, error: 'unknown_type', normalized };

  const warnings: ReceivedNcfWarning[] = [];
  if (NO_CREDIT.has(type)) warnings.push('no_tax_credit');
  if (spec.isCreditNote) warnings.push('credit_note_on_bill');
  if (NOT_RECEIVED.has(type)) warnings.push('sales_only_type');

  const selfIssued = spec.side === 'purchase';
  return {
    ok: true,
    ncf: {
      normalized,
      type,
      electronic: spec.isElectronic,
      selfIssued,
      requiresSupplierTaxId: !NO_SUPPLIER_TAX_ID.has(type),
      warnings,
    },
  };
}

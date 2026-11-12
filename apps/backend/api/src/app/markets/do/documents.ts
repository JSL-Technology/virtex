// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { DocumentToNumber, MarketAdjustmentCodes, MarketCounterpartyVerdictCodes, MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { CREDIT_NOTE_ONLY, REPORT_IN_RETURN, formatByMask } from '../kit/documents';
import { isValidDominicanTaxId } from './identity';

/**
 * Dominican Republic — DGII.
 *
 * `B*` are the traditional comprobantes (NCF): numbered from a range the DGII authorises and
 * printed by the issuer, with nothing transmitted at issue. `E*` are the e-CF series — signed with
 * a digital certificate and sent to the DGII — whose two trailing digits are its document-type
 * code. A company may issue either, or both while it moves from one to the other.
 *
 * B11, B13 and B17 are issued by the company as the BUYER (to an informal supplier, for minor
 * expenses, for payments abroad), like their electronic E41, E43 and E47: purchase side.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: 'B01', labelKey: 'fiscal.do.B01', name: 'Factura de Crédito Fiscal', sequenceFormat: 'B01########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 10 },
  { code: 'B02', labelKey: 'fiscal.do.B02', name: 'Factura de Consumo', sequenceFormat: 'B02########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 20 },
  { code: 'B03', labelKey: 'fiscal.do.B03', name: 'Nota de Débito', sequenceFormat: 'B03########', expirationRequired: true, isElectronic: false, side: 'either', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 30 },
  { code: 'B04', labelKey: 'fiscal.do.B04', name: 'Nota de Crédito', sequenceFormat: 'B04########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 40 },
  { code: 'B11', labelKey: 'fiscal.do.B11', name: 'Comprobante de Compras', sequenceFormat: 'B11########', expirationRequired: true, isElectronic: false, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 50 },
  { code: 'B13', labelKey: 'fiscal.do.B13', name: 'Comprobante para Gastos Menores', sequenceFormat: 'B13########', expirationRequired: true, isElectronic: false, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 52 },
  { code: 'B14', labelKey: 'fiscal.do.B14', name: 'Comprobante para Regímenes Especiales', sequenceFormat: 'B14########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 54 },
  { code: 'B15', labelKey: 'fiscal.do.B15', name: 'Comprobante Gubernamental', sequenceFormat: 'B15########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 60 },
  { code: 'B16', labelKey: 'fiscal.do.B16', name: 'Comprobante para Exportaciones', sequenceFormat: 'B16########', expirationRequired: true, isElectronic: false, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 62 },
  { code: 'B17', labelKey: 'fiscal.do.B17', name: 'Comprobante para Pagos al Exterior', sequenceFormat: 'B17########', expirationRequired: true, isElectronic: false, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 64 },

  { code: 'E31', labelKey: 'fiscal.do.E31', name: 'Factura de Crédito Fiscal Electrónica', sequenceFormat: 'E31##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 110 },
  { code: 'E32', labelKey: 'fiscal.do.E32', name: 'Factura de Consumo Electrónica', sequenceFormat: 'E32##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 120 },
  { code: 'E33', labelKey: 'fiscal.do.E33', name: 'Nota de Débito Electrónica', sequenceFormat: 'E33##########', expirationRequired: true, isElectronic: true, side: 'either', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 130 },
  { code: 'E34', labelKey: 'fiscal.do.E34', name: 'Nota de Crédito Electrónica', sequenceFormat: 'E34##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 140 },
  // Self-issued against a supplier, and therefore Accounts Payable's rather than invoicing's.
  // Offering them on a sales document produces a comprobante the DGII rejects.
  { code: 'E41', labelKey: 'fiscal.do.E41', name: 'Compras Electrónico', sequenceFormat: 'E41##########', expirationRequired: true, isElectronic: true, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 150 },
  { code: 'E43', labelKey: 'fiscal.do.E43', name: 'Gastos Menores Electrónico', sequenceFormat: 'E43##########', expirationRequired: true, isElectronic: true, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 160 },
  { code: 'E44', labelKey: 'fiscal.do.E44', name: 'Regímenes Especiales Electrónico', sequenceFormat: 'E44##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 170 },
  { code: 'E45', labelKey: 'fiscal.do.E45', name: 'Gubernamental Electrónico', sequenceFormat: 'E45##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 180 },
  { code: 'E46', labelKey: 'fiscal.do.E46', name: 'Exportaciones Electrónico', sequenceFormat: 'E46##########', expirationRequired: true, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 190 },
  { code: 'E47', labelKey: 'fiscal.do.E47', name: 'Pagos al Exterior Electrónico', sequenceFormat: 'E47##########', expirationRequired: true, isElectronic: true, side: 'purchase', purpose: 'PURCHASE_RECORD', requiresBuyerTaxId: false, sortOrder: 200 },
];

/**
 * A buyer the DGII recognises as a taxpayer: an RNC (9 digits) or a cédula (11 digits) that passes its
 * own check digit. Both entitle the holder to the ITBIS credit, so both warrant a crédito fiscal; a
 * number of the right length that no taxpayer holds does not.
 */
function buyerIsTaxpayer(document: DocumentToNumber): boolean {
  const digits = (document.buyer.taxId ?? '').replace(/\D/g, '');
  return (digits.length === 9 || digits.length === 11) && isValidDominicanTaxId(digits);
}

/** A note is drawn from the series of the document it modifies: pre-printed (`B`) or electronic (`E`). */
function originalIsTraditional(document: DocumentToNumber): boolean {
  return (document.original?.fiscalNumber ?? '').toUpperCase().startsWith('B');
}

/**
 * NCF and e-NCF, drawn from the ranges the DGII authorises. A company may issue either kind, or both
 * while it moves from one to the other; absent a request, a sale is a crédito fiscal for a taxpayer
 * buyer and a consumo otherwise, in the kind the company chose. Exports (E46), government sales
 * (E45) and special regimes (E44) are the issuer's to choose.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC', 'TRADITIONAL'],
  requestedType: 'CHOOSE',
  automaticTypes: { TRADITIONAL: ['B01', 'B02'], ELECTRONIC: ['E31', 'E32'] },
  typeOf(document) {
    switch (document.purpose) {
      case 'CREDIT_NOTE':
        return originalIsTraditional(document) ? 'B04' : 'E34';
      case 'DEBIT_NOTE':
        return originalIsTraditional(document) ? 'B03' : 'E33';
      default: {
        const taxpayer = buyerIsTaxpayer(document);
        if (document.emissionKind === 'TRADITIONAL') return taxpayer ? 'B01' : 'B02';
        return taxpayer ? 'E31' : 'E32';
      }
    }
  },
  // An NCF range carries no series: the type is the number's own prefix.
  acceptsSeries: (_type, series) => series === '',
  format: formatByMask(DOCUMENT_TYPES),
  // The till hands the consumer a consumo receipt from the company's pre-printed range.
  tillReceiptType: 'B02',
};

/**
 * The DGII's `CodigoModificacion`, mandatory on an e-CF that modifies another: `1` annuls the
 * referenced document, `2` corrects its text with the amounts unchanged, `3` corrects amounts.
 *
 * Codes `4` (replaces a document issued under contingency) and `5` (consumption reference, purely
 * informative) answer no commercial reason an issuer states on a note, and the product issues
 * neither, so nothing maps to them.
 *
 * *Verificar con contabilidad/legal*: Norma General 01-2020 and the e-CF technical annexes.
 */
const ADJUSTMENT_CODES: MarketAdjustmentCodes = {
  // `CodigoModificacion`: 1 anulación total, 2 corrección de texto, 3 corrección de montos. The
  // DGII publishes one catalogue for both kinds of note, so both records carry the same codes.
  creditNote: { ANNULMENT: '1', DETAIL_CORRECTION: '2', GOODS_RETURN: '3', PRICE_REDUCTION: '3', OTHER: '3' },
  debitNote: { LATE_PAYMENT_INTEREST: '3', ADDITIONAL_CHARGES: '3', PRICE_INCREASE: '3', PENALTY: '3', OTHER: '3' },
};

/**
 * The DGII's codes for the aprobación comercial (ACECF): what the BUYER answers about a comprobante
 * their supplier issued to them.
 *
 * *Verificar con contabilidad/legal*: Norma General 01-2020 and the ACECF technical annex.
 */
const COUNTERPARTY_VERDICT_CODES: MarketCounterpartyVerdictCodes = {
  ACCEPTED: '1',
  REJECTED: '2',
};

/** Dominican Republic: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * Serie B is annulled and reported in the authority's cancelled-documents return; an e-CF the
   * DGII received is reversed with a credit note (E34).
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: REPORT_IN_RETURN },
  adjustmentCodes: ADJUSTMENT_CODES,
  counterpartyVerdictCodes: COUNTERPARTY_VERDICT_CODES,
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};

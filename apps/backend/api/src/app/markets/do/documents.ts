// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType } from '../contracts';
import { CREDIT_NOTE_ONLY, REPORT_IN_RETURN } from '../kit/documents';

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
  { code: 'B01', labelKey: 'fiscal.do.B01', name: 'Factura de Crédito Fiscal', sequenceFormat: 'B01########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 10 },
  { code: 'B02', labelKey: 'fiscal.do.B02', name: 'Factura de Consumo', sequenceFormat: 'B02########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 20 },
  { code: 'B03', labelKey: 'fiscal.do.B03', name: 'Nota de Débito', sequenceFormat: 'B03########', expirationRequired: true, isElectronic: false, side: 'either', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 30 },
  { code: 'B04', labelKey: 'fiscal.do.B04', name: 'Nota de Crédito', sequenceFormat: 'B04########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 40 },
  { code: 'B11', labelKey: 'fiscal.do.B11', name: 'Comprobante de Compras', sequenceFormat: 'B11########', expirationRequired: true, isElectronic: false, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 50 },
  { code: 'B13', labelKey: 'fiscal.do.B13', name: 'Comprobante para Gastos Menores', sequenceFormat: 'B13########', expirationRequired: true, isElectronic: false, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 52 },
  { code: 'B14', labelKey: 'fiscal.do.B14', name: 'Comprobante para Regímenes Especiales', sequenceFormat: 'B14########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 54 },
  { code: 'B15', labelKey: 'fiscal.do.B15', name: 'Comprobante Gubernamental', sequenceFormat: 'B15########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 60 },
  { code: 'B16', labelKey: 'fiscal.do.B16', name: 'Comprobante para Exportaciones', sequenceFormat: 'B16########', expirationRequired: true, isElectronic: false, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 62 },
  { code: 'B17', labelKey: 'fiscal.do.B17', name: 'Comprobante para Pagos al Exterior', sequenceFormat: 'B17########', expirationRequired: true, isElectronic: false, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 64 },

  { code: 'E31', labelKey: 'fiscal.do.E31', name: 'Factura de Crédito Fiscal Electrónica', sequenceFormat: 'E31##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 110 },
  { code: 'E32', labelKey: 'fiscal.do.E32', name: 'Factura de Consumo Electrónica', sequenceFormat: 'E32##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 120 },
  { code: 'E33', labelKey: 'fiscal.do.E33', name: 'Nota de Débito Electrónica', sequenceFormat: 'E33##########', expirationRequired: true, isElectronic: true, side: 'either', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 130 },
  { code: 'E34', labelKey: 'fiscal.do.E34', name: 'Nota de Crédito Electrónica', sequenceFormat: 'E34##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: true, requiresBuyerTaxId: false, sortOrder: 140 },
  // Self-issued against a supplier, and therefore Accounts Payable's rather than invoicing's.
  // Offering them on a sales document produces a comprobante the DGII rejects.
  { code: 'E41', labelKey: 'fiscal.do.E41', name: 'Compras Electrónico', sequenceFormat: 'E41##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 150 },
  { code: 'E43', labelKey: 'fiscal.do.E43', name: 'Gastos Menores Electrónico', sequenceFormat: 'E43##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 160 },
  { code: 'E44', labelKey: 'fiscal.do.E44', name: 'Regímenes Especiales Electrónico', sequenceFormat: 'E44##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 170 },
  { code: 'E45', labelKey: 'fiscal.do.E45', name: 'Gubernamental Electrónico', sequenceFormat: 'E45##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: true, sortOrder: 180 },
  { code: 'E46', labelKey: 'fiscal.do.E46', name: 'Exportaciones Electrónico', sequenceFormat: 'E46##########', expirationRequired: true, isElectronic: true, side: 'sales', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 190 },
  { code: 'E47', labelKey: 'fiscal.do.E47', name: 'Pagos al Exterior Electrónico', sequenceFormat: 'E47##########', expirationRequired: true, isElectronic: true, side: 'purchase', isCreditNote: false, requiresBuyerTaxId: false, sortOrder: 200 },
];

/** Dominican Republic: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * Serie B is annulled and reported in the authority's cancelled-documents return; an e-CF the
   * DGII received is reversed with a credit note (E34).
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: REPORT_IN_RETURN },
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
};

// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { CREDIT_NOTE_ONLY } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '1', labelKey: 'fiscal.ar.1', name: 'Factura A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 10 },
  { code: '2', labelKey: 'fiscal.ar.2', name: 'Nota de Débito A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: true, sortOrder: 15 },
  { code: '3', labelKey: 'fiscal.ar.3', name: 'Nota de Crédito A', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: true, sortOrder: 20 },
  { code: '6', labelKey: 'fiscal.ar.6', name: 'Factura B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 30 },
  { code: '7', labelKey: 'fiscal.ar.7', name: 'Nota de Débito B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 35 },
  { code: '8', labelKey: 'fiscal.ar.8', name: 'Nota de Crédito B', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 40 },
  { code: '11', labelKey: 'fiscal.ar.11', name: 'Factura C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: false, sortOrder: 50 },
  { code: '12', labelKey: 'fiscal.ar.12', name: 'Nota de Débito C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'DEBIT_NOTE', requiresBuyerTaxId: false, sortOrder: 55 },
  { code: '13', labelKey: 'fiscal.ar.13', name: 'Nota de Crédito C', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'CREDIT_NOTE', requiresBuyerTaxId: false, sortOrder: 60 },
];

/**
 * The issuer's VAT condition, as AFIP codes it and as the signup records it (`condicionIva`): a
 * responsable inscripto issues A or B; an exempt or monotributo taxpayer issues C. A consumidor final
 * issues no invoice, and an unknown code decides nothing.
 */
const ISSUER_CLASS: Readonly<Record<string, 'A_OR_B' | 'C'>> = {
  '1': 'A_OR_B',
  '4': 'C',
  '6': 'C',
  '13': 'C',
  '16': 'C',
};

/** The comprobante codes of each class, by purpose (AFIP `CbteTipo`). */
const CODES: Readonly<Record<'A' | 'B' | 'C', Readonly<Record<'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE', string>>>> = {
  A: { INVOICE: '1', DEBIT_NOTE: '2', CREDIT_NOTE: '3' },
  B: { INVOICE: '6', DEBIT_NOTE: '7', CREDIT_NOTE: '8' },
  C: { INVOICE: '11', DEBIT_NOTE: '12', CREDIT_NOTE: '13' },
};

/**
 * AFIP: the number is AFIP's own (`FECompUltimoAutorizado` + 1), read at transmission, so nothing is
 * stored to drift from it. The class — A, B or C — follows from both parties' VAT condition: A only
 * between a responsable inscripto and a buyer registered as one; B from a responsable inscripto to
 * anybody else; C from an exempt or monotributo issuer. A note takes the class of the document it
 * modifies.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_ON_TRANSMISSION',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  typeOf(document) {
    const original = document.original?.documentType ?? null;
    const originalClass = original
      ? (Object.entries(CODES).find(([, byPurpose]) => Object.values(byPurpose).includes(original))?.[0] as 'A' | 'B' | 'C' | undefined)
      : undefined;
    const issuer = ISSUER_CLASS[document.issuerFiscalProfile['condicionIva'] ?? ''];
    if (!issuer) return null;
    const buyerRegistered = document.buyer.fiscalAttributes?.['condicionIva'] === '1';
    const cls = originalClass ?? (issuer === 'C' ? 'C' : buyerRegistered ? 'A' : 'B');
    return CODES[cls][document.purpose];
  },
};

/** Argentina: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * A document AFIP authorised is never annulled: it is reversed with a credit note.
   */
  cancellation: { electronic: CREDIT_NOTE_ONLY, traditional: CREDIT_NOTE_ONLY },
  debitNotes: false,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};

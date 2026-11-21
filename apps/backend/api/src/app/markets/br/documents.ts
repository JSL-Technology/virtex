// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketDocuments, MarketFiscalDocumentType, MarketNumbering } from '../contracts';
import { AUTHORITY_EVENT } from '../kit/documents';

/**
 * The codes the regime's builder already emits, transcribed as data (C-04). `sequenceFormat` and
 * `expirationRequired` are left unconfirmed: the mask a series takes and whether the authorisation
 * is time-boxed are facts to confirm with the authority, and inventing them is worse than leaving
 * them open.
 */
export const DOCUMENT_TYPES: readonly MarketFiscalDocumentType[] = [
  { code: '55', labelKey: 'fiscal.br.55', name: 'Nota Fiscal Eletrônica (NF-e)', sequenceFormat: null, expirationRequired: false, isElectronic: true, side: 'sales', purpose: 'INVOICE', requiresBuyerTaxId: true, sortOrder: 10 },
];

/**
 * SEFAZ: the `nNF`, bare, within a série the establishment runs. Every NF-e is model 55: a return or
 * a complement is the same model, told apart by its purpose (`finNFe`) in the document itself.
 */
const NUMBERING: MarketNumbering = {
  source: 'AUTHORITY_RANGE',
  emissionKinds: ['ELECTRONIC'],
  requestedType: 'CONFIRM',
  typeOf: () => '55',
  // The NF-e série: a number from 0 to 999.
  acceptsSeries: (_type, series) => /^\d{1,3}$/.test(series),
  format: (drawn) => String(drawn.sequence),
};

/** Brazil: the sales documents the authority defines, and how an issued one is undone. */
export const documents: MarketDocuments = {
  fiscalNumbering: true,
  types: DOCUMENT_TYPES,
  /**
   * An NF-e is cancelled with the SEFAZ (cancelamento), within its window. The regime does not send
   * that event yet, so the market is told so and offered the credit note.
   */
  cancellation: { electronic: AUTHORITY_EVENT, traditional: AUTHORITY_EVENT },
  /**
   * Null on purpose: an NF-e carries its purpose in `finNFe` — 4 devolução, 2 complementar — and
   * the SEFAZ publishes no catalogue of reasons beside it. What it does require is the NF-e being
   * corrected, by its chave de acesso, which the regime writes in `NFref/refNFe`.
   */
  adjustmentCodes: null,
  // The authority asks the receiver of a document for no verdict of its own here.
  counterpartyVerdictCodes: null,
  // A Brazilian debit note is an NF-e complementar (`finNFe` 2) referring to the NF-e whose value
  // it completes. The regime writes both it and the devolução now.
  debitNotes: true,
  defaultCustomer: { nameKey: 'ledger.provisioning.final_consumer' },
  numbering: NUMBERING,
};

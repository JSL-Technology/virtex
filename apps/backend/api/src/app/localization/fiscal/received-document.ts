/**
 * The number on a supplier's document, as each market defines it (`markets/<cc>/purchases.ts`), read
 * through the catalogue.
 */
export { checkReceivedDocument, receivedDocumentKind, type ReceivedDocumentCheck } from '../../markets';

/** Which number a supplier's document carries: the market's own name for it (`NCF`, `CFDI_UUID`…). */
export type ReceivedDocumentKind = string;

// The NF-e access-key check, for the capture of a Brazilian bill. Moves with the purchases phase of
// docs/ARQUITECTURA_MERCADOS.md.
export { nfeCheckDigitOk } from '../../markets/br/purchases';

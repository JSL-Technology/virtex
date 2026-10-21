/**
 * Reading a supplier's document, market by market, as other modules may do it: what the document
 * carries in this market (identifier, fiscal number, payment forms, classification) and the checks
 * that market applies. Accounts payable's bill capture reads the company's own market through here
 * instead of assuming the Dominican one.
 */
export {
  purchaseCaptureProfile,
  checkSupplierTaxId,
  type PurchaseCaptureProfile,
} from '../fiscal/purchase-capture-profile';
export {
  checkReceivedDocument,
  receivedDocumentKind,
  type ReceivedDocumentCheck,
  type ReceivedDocumentKind,
} from '../fiscal/received-document';

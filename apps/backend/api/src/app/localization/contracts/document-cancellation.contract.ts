/** How each market lets an issued sales document be cancelled (FAC-INV-05). */
export {
  cancellationRouteFor,
  cancellationCoverageFor,
  fiscalAuthorityOf,
  isElectronicDocumentType,
  type CancellationRoute,
  type CancellableDocument,
} from '../fiscal/document-cancellation';
export { fiscalReasonsOn, type FiscalReason } from '../fiscal/fiscal-reason-codes';

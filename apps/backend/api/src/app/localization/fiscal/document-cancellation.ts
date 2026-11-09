/**
 * How an issued sales document is cancelled in each market (audit 2026-11-07, FAC-INV-05) — the
 * market's own policy (`markets/<cc>/documents.ts`), read through the catalogue queries.
 */
export {
  cancellationCoverageFor,
  cancellationRouteFor,
  fiscalAuthorityOf,
  isElectronicDocumentType,
  type CancellableDocument,
  type CancellationRoute,
} from '../../markets';

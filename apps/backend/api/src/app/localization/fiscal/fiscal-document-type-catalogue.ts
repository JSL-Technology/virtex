/**
 * The fiscal document types each authority publishes, as data — declared by each market in
 * `markets/<cc>/documents.ts` and projected onto `fiscal_document_type_definitions` at boot. This
 * module re-exports the catalogue for the consumers written against it.
 */
export { FISCAL_DOCUMENT_TYPES, fiscalDocumentTypesFor, type FiscalDocumentSide, type FiscalDocumentTypeSpec } from '../../markets';

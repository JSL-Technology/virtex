/**
 * The fiscal document-type catalogue, as other modules may read it.
 *
 * What each comprobante requires — of the buyer, of the range — is a fact about the market and
 * lives with the rest of the country catalogue in `fiscal/`; a market's numbering adapter reads it
 * through here rather than through localization's insides.
 */
export {
  fiscalDocumentTypesFor,
  type FiscalDocumentTypeSpec,
} from '../fiscal/fiscal-document-type-catalogue';

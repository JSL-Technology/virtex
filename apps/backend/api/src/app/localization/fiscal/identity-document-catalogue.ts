/**
 * The identity documents each market issues, as data — declared by each market in
 * `markets/<cc>/identity.ts`, queried through the catalogue (`markets/queries/identity.ts`) and
 * projected onto `identity_document_types` at boot. This module re-exports both for the consumers
 * written against it.
 */
export {
  IDENTITY_DOCUMENT_TYPES,
  MARKETS_REQUIRING_DOCUMENTS,
  SUPRANATIONAL_COUNTRY,
  TAX_ID_VALIDATORS,
  canonicalize,
  canonicalizeTaxId,
  catalogueForCountry,
  findIdentityDocumentSpec,
  fiscalIdentifierFor,
  fiscalIdentifierLabel,
  identityDocumentLabel,
  isSupportedFiscalCountry,
  registrationDocumentsFor,
  regimeDocumentCode,
  taxpayerKindAffectsValidation,
  validateTaxId,
  type CanonicalForm,
  type DocumentAppliesTo,
  type DocumentContext,
  type DocumentRequirement,
  type IdentityDocumentTypeSpec,
} from '../../markets';

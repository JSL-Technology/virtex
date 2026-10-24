import { countryPackFor } from '../../contracts/country-pack/country-pack';
import { findCountryProfile, serviceChargeRateFor } from './country-profiles';
import { principalTaxName } from './country-tax-schemes';
import { canonicalize, fiscalIdentifierFor, registrationDocumentsFor, validateTaxId } from './identity-document-catalogue';
import { ReceivedDocumentKind, receivedDocumentKind } from './received-document';

/**
 * What a supplier's document looks like in one market — everything reading one needs to know, and
 * nothing borrowed from another market.
 *
 * Built from the country catalogue the rest of the product already validates against: the
 * registration identifiers (`identity_document_types`), the country pack (which number a supplier's
 * document carries, the authority's payment-form codes, whether purchases are classified for a
 * return), the tax scheme (what the tax is called) and the profile (date order, the legal service
 * charge). A company whose country this product has no pack for gets `generic: true`: identifiers
 * and document numbers are kept as printed and NOT checked, and the screen says so — it never falls
 * back to the Dominican rules, which is what it did before.
 */
export interface PurchaseCaptureProfile {
  countryCode: string | null;
  generic: boolean;
  fiscalAuthority: string | null;
  /** The issuer identifiers this market prints, e.g. `RNC (131-12345-7)`, `EIN (12-3456789)`. */
  issuerIdentifiers: Array<{ label: string; example: string | null }>;
  documentKind: ReceivedDocumentKind;
  /** What the supplier's document number is, in English, for a reader of the document. */
  documentNumberDescription: string;
  taxName: string;
  /** How dates are written on this market's documents. */
  dateOrder: 'DMY' | 'MDY';
  /** The authority's payment-form codes, where it has a catalogue (DGII, SAT); empty otherwise. */
  paymentForms: Array<{ code: string; description: string }>;
  /** Whether purchases are classified for a return (the DGII 606 "tipo de bienes y servicios"). */
  purchaseClassification: boolean;
  /** Whether a legal service charge (the Dominican "10 % de ley") appears on bills. */
  serviceCharge: boolean;
}

const DOCUMENT_DESCRIPTIONS: Record<ReceivedDocumentKind, string> = {
  NCF: 'the NCF / e-NCF: B + 2 digits + 8 digits (11 characters) or E + 2 digits + 10 digits (13 characters), often labelled "NCF", "e-NCF" or "Comprobante"',
  CFDI_UUID: 'the CFDI "folio fiscal" (UUID, 8-4-4-4-12 hexadecimal characters) stamped by the SAT',
  NFE_KEY: 'the NF-e "chave de acesso": 44 digits, often printed in groups of four',
  CUFE: 'the CUFE: 96 hexadecimal characters printed on the electronic invoice',
  FISCAL_NUMBER: "the fiscal document number the tax authority assigned to the supplier's invoice",
  INVOICE_NUMBER: "the supplier's own invoice number",
};

export function purchaseCaptureProfile(countryCode: string | null | undefined): PurchaseCaptureProfile {
  const code = (countryCode ?? '').trim().toUpperCase() || null;
  const pack = countryPackFor(code);
  const profile = code ? findCountryProfile(code) : undefined;
  const documentKind = receivedDocumentKind(code);
  const authorityForms = pack.paymentMethods.authority
    ? pack.paymentMethods.defaults
        .filter((method) => method.fiscalCode)
        .map((method) => ({
          code: method.fiscalCode as string,
          description: (method.nameKey.split('.').pop() ?? method.code).replace(/^(dgii|sat|dian|sefaz)_/, '').replace(/_/g, ' '),
        }))
    : [];
  return {
    countryCode: code,
    generic: !profile,
    fiscalAuthority: profile?.fiscalAuthority ?? null,
    issuerIdentifiers: code ? registrationDocumentsFor(code) : [],
    documentKind,
    documentNumberDescription: DOCUMENT_DESCRIPTIONS[documentKind],
    taxName: code ? principalTaxName(code) : 'tax',
    dateOrder: profile?.locale === 'en-US' ? 'MDY' : 'DMY',
    // Only codes a two-character payment-form field can hold (the 606's and the CFDI's both fit).
    paymentForms: authorityForms.filter((form) => form.code.length <= 2),
    purchaseClassification: pack.documents.purchaseClassification,
    serviceCharge: serviceChargeRateFor(code) > 0,
  };
}

/**
 * A supplier identifier read from a document, checked by its market's rule: `true`/`false` where the
 * market has registration documents this product validates, `null` where it has none (generic).
 */
export function checkSupplierTaxId(countryCode: string | null | undefined, raw: string | null | undefined): {
  canonical: string | null;
  valid: boolean | null;
} {
  const text = (raw ?? '').trim();
  if (!text) return { canonical: null, valid: null };
  const code = (countryCode ?? '').trim().toUpperCase();
  const spec = code ? fiscalIdentifierFor(code) : null;
  if (!spec) return { canonical: text.slice(0, 32), valid: null };
  const canonical = canonicalize(spec.canonicalForm, text).slice(0, 32);
  // Printed identifiers carry decoration the pattern does not expect ("1-31-24675-3"): the
  // canonical form is checked too, so only the digits and letters that carry meaning decide.
  return { canonical, valid: validateTaxId(code, text) || validateTaxId(code, canonical) };
}

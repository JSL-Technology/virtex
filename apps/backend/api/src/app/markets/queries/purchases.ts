import type { ReceivedDocumentCheck } from '../contracts';
import { canonicalize, fiscalIdentifierFor, registrationDocumentsFor, validateTaxId } from './identity';
import { knownMarket, marketFor, normalizeMarketCode } from '../registry';

/**
 * Purchases across the catalogue: what a supplier's document carries in a market, checked by that
 * market's rule and by no other.
 */

/** Which number a supplier's document carries in the market. */
export function receivedDocumentKind(countryCode: string | null | undefined): string {
  return marketFor(countryCode).purchases.receivedDocument.kind;
}

/** The number on a supplier's document, checked by its market's own rule. */
export function checkReceivedDocument(countryCode: string | null | undefined, raw: string | null | undefined): ReceivedDocumentCheck {
  return marketFor(countryCode).purchases.receivedDocument.check(raw ?? '');
}

/**
 * What a supplier's document looks like in one market — everything reading one needs to know, and
 * nothing borrowed from another market. A company whose country the product is not sold in gets
 * `generic: true`: identifiers and document numbers are kept as printed and not checked, and the
 * screen says so.
 */
export interface PurchaseCaptureProfile {
  countryCode: string | null;
  generic: boolean;
  fiscalAuthority: string | null;
  /** The issuer identifiers the market prints, e.g. `RNC (131-12345-7)`, `EIN (12-3456789)`. */
  issuerIdentifiers: Array<{ label: string; example: string | null }>;
  documentKind: string;
  /** What the supplier's document number is, in English, for a reader of the document. */
  documentNumberDescription: string;
  taxName: string;
  /** How dates are written on the market's documents. */
  dateOrder: 'DMY' | 'MDY';
  /** The authority's payment-form codes, where it has a catalogue; empty otherwise. */
  paymentForms: Array<{ code: string; description: string }>;
  /** Whether purchases are classified for a return. */
  purchaseClassification: boolean;
  /** Whether a legal service charge appears on bills. */
  serviceCharge: boolean;
}

/** `MM/dd/yyyy` is month-first; every other market format the catalogue declares is day-first. */
function dateOrderOf(format: string | undefined): 'DMY' | 'MDY' {
  return format && /^M/i.test(format) ? 'MDY' : 'DMY';
}

export function purchaseCaptureProfile(countryCode: string | null | undefined): PurchaseCaptureProfile {
  const code = normalizeMarketCode(countryCode) || null;
  const market = marketFor(code);
  const known = knownMarket(code);
  const received = market.purchases.receivedDocument;
  // The method's name in its catalogue key, readable: `…payment_methods.<authority>_cash` → `cash`.
  const authorityPrefix = market.payments.authority ? `${market.payments.authority.toLowerCase()}_` : null;
  const authorityForms = authorityPrefix
    ? market.payments.defaults
        .filter((method) => method.fiscalCode)
        .map((method) => {
          const name = method.nameKey.split('.').pop() ?? method.code;
          const bare = name.startsWith(authorityPrefix) ? name.slice(authorityPrefix.length) : name;
          return { code: method.fiscalCode as string, description: bare.replace(/_/g, ' ') };
        })
    : [];
  return {
    countryCode: code,
    generic: !known,
    fiscalAuthority: known?.profile.fiscalAuthority ?? null,
    issuerIdentifiers: code ? registrationDocumentsFor(code) : [],
    documentKind: received.kind,
    documentNumberDescription: received.description,
    taxName: code ? market.taxes.principalTaxName : 'tax',
    dateOrder: dateOrderOf(known?.profile.formats.date),
    // Only codes a two-character payment-form field can hold.
    paymentForms: authorityForms.filter((form) => form.code.length <= 2),
    purchaseClassification: market.purchases.purchaseClassification,
    serviceCharge: market.taxes.serviceChargeRate > 0,
  };
}

/**
 * A supplier identifier read from a document, checked by its market's rule: `true`/`false` where the
 * market has registration documents the product validates, `null` where it has none (generic).
 */
export function checkSupplierTaxId(countryCode: string | null | undefined, raw: string | null | undefined): {
  canonical: string | null;
  valid: boolean | null;
} {
  const text = (raw ?? '').trim();
  if (!text) return { canonical: null, valid: null };
  const code = normalizeMarketCode(countryCode);
  const spec = code ? fiscalIdentifierFor(code) : null;
  if (!spec) return { canonical: text.slice(0, 32), valid: null };
  const canonical = canonicalize(spec.canonicalForm, text).slice(0, 32);
  // Printed identifiers carry decoration the pattern does not expect ("1-31-24675-3"): the canonical
  // form is checked too, so only the digits and letters that carry meaning decide.
  return { canonical, valid: validateTaxId(code, text) || validateTaxId(code, canonical) };
}


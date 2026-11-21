// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * United States: the identity documents the market issues, and the arithmetic that checks them.
 */

// United States — EIN (companies) and SSN/ITIN (sole proprietors), IRS
/**
 * An EIN has no check digit, so the only structural signal is the two-digit prefix: the IRS
 * publishes the set it assigns, and the unassigned values are the ones a typo or a placeholder
 * produces. Rejecting them catches the common cases without pretending to more certainty than
 * the format allows.
 */
const IRS_ASSIGNED_PREFIXES = new Set([
  '01','02','03','04','05','06','10','11','12','13','14','15','16','20','21','22','23','24','25',
  '26','27','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46',
  '47','48','50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66',
  '67','68','71','72','73','74','75','76','77','80','81','82','83','84','85','86','87','88','90',
  '91','92','93','94','95','98','99',
]);

/** Strict EIN check. Used when the caller knows the taxpayer is a company. */
export function isValidUsEinStrict(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 9) return false;
  // 00-, 07-, 08-, 09-, 17-, 18-, 19-, 28-, 29-, 49-, 69-, 70-, 78-, 79-, 89-, 96-, 97- are unassigned.
  return IRS_ASSIGNED_PREFIXES.has(digits.slice(0, 2));
}

/**
 * SSN (natural person) and ITIN (resident alien without an SSN).
 *
 * Both are nine digits in `AAA-GG-SSSS` form. The rules that make a value un-issuable are
 * published by the SSA and the IRS:
 *   - area 000, 666 and 900-999 are never issued as an SSN; 900-999 IS the ITIN range, so an
 *     ITIN is recognised by its area plus its group, which the IRS restricts to 50-65, 70-88,
 *     90-92 and 94-99;
 *   - group 00 and serial 0000 are never issued in either scheme.
 *
 * This matters commercially: a US sole proprietor files under an SSN or ITIN, not an EIN, and
 * they are a large share of the small-business market the product sells into.
 */
export function isValidUsSsnOrItin(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 9) return false;

  const area = Number(digits.slice(0, 3));
  const group = Number(digits.slice(3, 5));
  const serial = Number(digits.slice(5));

  if (group === 0 || serial === 0) return false;

  // ITIN: area 900-999 with an IRS-assigned group range.
  if (area >= 900 && area <= 999) {
    return (
      (group >= 50 && group <= 65) ||
      (group >= 70 && group <= 88) ||
      (group >= 90 && group <= 92) ||
      (group >= 94 && group <= 99)
    );
  }

  // SSN: any area except 000 and 666.
  return area !== 0 && area !== 666;
}

/**
 * A United States taxpayer identifier, of either kind.
 *
 * The country profile has always advertised `individualDocument: { code: 'SSN', label:
 * 'SSN / ITIN' }` and the comment beside it says rejecting that shape "would lock out a whole
 * class of customer" — and then `validateTaxId` only ever ran the company validator, so it locked
 * them out. Any SSN whose first two digits fall outside the IRS's EIN prefix list was refused:
 * `078-05-1120` among them.
 */
export function isValidUsTaxId(value: string): boolean {
  return isValidUsEinStrict(value) || isValidUsSsnOrItin(value);
}

/** @deprecated Use {@link isValidUsTaxId} for registration, or {@link isValidUsEinStrict} when the taxpayer is known to be a company. */
export const isValidUsEin = isValidUsEinStrict;

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'SSN', labelKey: 'identity_document.us.ssn', labelVerbatim: 'SSN / ITIN',
    example: '123-45-6789', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', checksum: 'us_ssn_itin',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true, issuingAuthority: 'SSA / IRS', sortOrder: 10,
  },
  {
    code: 'EIN', labelKey: 'identity_document.us.ein', labelVerbatim: 'EIN',
    example: '12-3456789', pattern: '^\\d{2}-?\\d{7}$', checksum: 'us_ein_prefix',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'IRS', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    us_ein_prefix: isValidUsEinStrict,
    us_ssn_itin: isValidUsSsnOrItin,
  },
  structuralChecks: ['us_ein_prefix'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

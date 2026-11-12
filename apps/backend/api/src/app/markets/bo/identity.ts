// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Bolivia: the identity documents the market issues, and the arithmetic that checks them.
 */

/** Bolivia — NIT, SIN. 7–12 digits, no public check digit. */
export function isValidBolivianNit(value: string): boolean {
  const digits = numericOnly(value);
  return digits !== null && digits.length >= 7 && digits.length <= 12;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The NIT is a taxpayer identifier; a worker holds a cédula de identidad issued by SEGIP — a
  // numeric base with an optional department/expedition complement (e.g. `-1K`). Kept deliberately
  // wide and pattern-only: SEGIP publishes no check digit this repository can assert.
  {
    code: 'CI', labelKey: 'identity_document.bo.ci', labelVerbatim: 'Cédula de identidad',
    example: '1234567', pattern: '^\\d{4,10}(-?[A-Za-z0-9]{1,3})?$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'SEGIP', sortOrder: 10,
  },
  {
    code: 'NIT', labelKey: 'identity_document.bo.nit', labelVerbatim: 'NIT',
    example: '1234567890', pattern: '^\\d{7,12}$', checksum: 'bo_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SIN', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    bo_nit: isValidBolivianNit,
  },
  structuralChecks: ['bo_nit'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Uruguay: the identity documents the market issues, and the arithmetic that checks them.
 */

// Uruguay — RUT, DGI. 12 digits, modulus 11.
export function isValidUruguayanRut(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;
  if (digits.length !== 12) return false;

  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(digits[i]) * weights[i];
  const remainder = sum % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === Number(digits[11]);
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The RUT (12 digits) belongs to a taxpayer; a worker holds a cédula de identidad — seven digits
  // and a mod-10 check digit written `1.234.567-8`. The check algorithm is published (weights
  // 2,9,8,7,6,3,4) but is left unimplemented for now, so the row validates by pattern alone and the
  // separators are canonicalised away.
  {
    code: 'CEDULA', labelKey: 'identity_document.uy.cedula', labelVerbatim: 'Cédula de identidad',
    example: '12345672', pattern: '^\\d{6,8}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'DNIC', sortOrder: 10,
  },
  {
    code: 'RUT', labelKey: 'identity_document.uy.rut', labelVerbatim: 'RUT',
    example: '211003420017', pattern: '^\\d{12}$', checksum: 'uy_rut_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    uy_rut_mod11: isValidUruguayanRut,
  },
  structuralChecks: [],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

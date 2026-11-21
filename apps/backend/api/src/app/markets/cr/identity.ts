// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { ChecksumAlgorithm, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Costa Rica: the identity documents the market issues, and the arithmetic that checks them.
 */

/** Costa Rica — cédula jurídica (10) / física (9); structural only. */
export function isValidCostaRicanId(value: string): boolean {
  const digits = numericOnly(value);
  return digits !== null && digits.length >= 9 && digits.length <= 12;
}

/** The cédula jurídica is 10 digits, the física 9: one structural rule, two lengths. */
const costaRicanOfLength = (length: number): ChecksumAlgorithm =>
  (value) => (numericOnly(value) ?? '').length === length && isValidCostaRicanId(value);

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'CEDULA_FISICA', labelKey: 'identity_document.cr.cedula_fisica',
    labelVerbatim: 'Cédula física', example: '112345678', pattern: '^\\d{9}$',
    checksum: 'cr_cedula_fisica', canonicalForm: 'digits', appliesTo: 'individual',
    requirement: 'required', usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'TSE', sortOrder: 10,
  },
  {
    code: 'CEDULA_JURIDICA', labelKey: 'identity_document.cr.cedula_juridica',
    labelVerbatim: 'Cédula jurídica', example: '3101123456', pattern: '^\\d{10}$',
    checksum: 'cr_cedula_juridica', canonicalForm: 'digits', appliesTo: 'company',
    requirement: 'required', usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Registro Nacional', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    cr_cedula_juridica: costaRicanOfLength(10),
    cr_cedula_fisica: costaRicanOfLength(9),
  },
  structuralChecks: ['cr_cedula_fisica', 'cr_cedula_juridica'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

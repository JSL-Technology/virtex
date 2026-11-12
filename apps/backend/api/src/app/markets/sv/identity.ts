// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * El Salvador: the identity documents the market issues, and the arithmetic that checks them.
 */

/** El Salvador — NIT, 14 digits, structural. */
export function isValidSalvadoranNit(value: string): boolean {
  return numericOnly(value)?.length === 14;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The NIT is the tax number; a worker holds a DUI — eight digits and a check digit, `########-#`.
  // The check algorithm is not implemented here yet, so it validates by pattern alone.
  {
    code: 'DUI', labelKey: 'identity_document.sv.dui', labelVerbatim: 'DUI',
    example: '01234567-8', pattern: '^\\d{8}-?\\d$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RNPN', sortOrder: 10,
  },
  {
    code: 'NIT', labelKey: 'identity_document.sv.nit', labelVerbatim: 'NIT',
    example: '0614-123456-001-2', pattern: '^\\d{4}-?\\d{6}-?\\d{3}-?\\d$', checksum: 'sv_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Ministerio de Hacienda', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    sv_nit: isValidSalvadoranNit,
  },
  structuralChecks: ['sv_nit'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

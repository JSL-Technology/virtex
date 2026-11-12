// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Honduras: the identity documents the market issues, and the arithmetic that checks them.
 */

/** Honduras — RTN, 14 digits, structural. */
export function isValidHonduranRtn(value: string): boolean {
  return numericOnly(value)?.length === 14;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The RTN is the tax number; a worker holds the Documento Nacional de Identificación — 13 digits
  // (4-digit municipality, 4-digit birth year, 5 correlative). Pattern-only for now.
  {
    code: 'DNI', labelKey: 'identity_document.hn.dni', labelVerbatim: 'Identidad',
    example: '0801199012345', pattern: '^\\d{13}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RNP', sortOrder: 10,
  },
  {
    code: 'RTN', labelKey: 'identity_document.hn.rtn', labelVerbatim: 'RTN',
    example: '08019012345678', pattern: '^\\d{14}$', checksum: 'hn_rtn',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAR', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    hn_rtn: isValidHonduranRtn,
  },
  structuralChecks: ['hn_rtn'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

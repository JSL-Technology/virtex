// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';

/**
 * Nicaragua: the identity documents the market issues, and the arithmetic that checks them.
 */

/** Nicaragua — RUC, 14 characters, structural. */
export function isValidNicaraguanRuc(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return cleaned.length === 14;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The RUC is the tax number; a worker holds a cédula: `###-######-####A` — municipality, birth
  // date, correlative and a Module-23 check letter. The letter check is not implemented here yet.
  {
    code: 'CI', labelKey: 'identity_document.ni.ci', labelVerbatim: 'Cédula de identidad',
    example: '001-230592-1002X', pattern: '^\\d{3}-?\\d{6}-?\\d{4}[A-Za-z]$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'CSE', sortOrder: 10,
  },
  {
    code: 'RUC', labelKey: 'identity_document.ni.ruc', labelVerbatim: 'RUC',
    example: 'J0310000012345', pattern: '^[A-Za-z0-9]{14}$', checksum: 'ni_ruc',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    ni_ruc: isValidNicaraguanRuc,
  },
  structuralChecks: ['ni_ruc'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

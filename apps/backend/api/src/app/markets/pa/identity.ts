// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';

/**
 * Panama: the identity documents the market issues, and the arithmetic that checks them.
 */

/** Panama — RUC, DGI. Composite, hyphen-separated; no published check-digit rule. */
export function isValidPanamanianRuc(value: string): boolean {
  return /^\d{1,10}(-[A-Z0-9]{1,6}){1,4}$/i.test(value.trim());
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // A worker holds a cédula: `provincia-tomo-asiento` (`8-430-70`), with letter prefixes for those
  // born abroad (PE), naturalised (N) or foreign residents (E). Composite like the RUC, so it takes
  // the same segmented canonical form. No published check digit.
  {
    code: 'CEDULA', labelKey: 'identity_document.pa.cedula', labelVerbatim: 'Cédula de identidad',
    example: '8-430-70', pattern: '^[A-Za-z0-9]+(-[A-Za-z0-9]+){1,3}$', checksum: null,
    canonicalForm: 'segmented', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Tribunal Electoral', sortOrder: 10,
  },
  {
    code: 'RUC', labelKey: 'identity_document.pa.ruc', labelVerbatim: 'RUC',
    example: '15512345-2-2018', pattern: '^[\\dA-Za-z]+(-[\\dA-Za-z]+){1,4}$', checksum: 'pa_ruc',
    canonicalForm: 'segmented', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    pa_ruc: isValidPanamanianRuc,
  },
  structuralChecks: ['pa_ruc'],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

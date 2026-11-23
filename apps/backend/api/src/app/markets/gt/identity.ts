// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';

/**
 * Guatemala: the identity documents the market issues, and the arithmetic that checks them.
 */

// Guatemala — NIT, SAT. Body plus a check character that may be 'K'.
export function isValidGuatemalanNit(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9K]/g, '');
  if (cleaned.length < 2 || cleaned.length > 13) return false;

  const body = cleaned.slice(0, -1);
  const provided = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * (body.length + 1 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  const expected = remainder === 10 ? 'K' : String(remainder);
  return expected === provided;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The NIT is the tax number; a worker is identified by the DPI, whose number is the CUI — 13
  // digits (8 correlative, a verifier, then the 4-digit municipality). Pattern-only for now.
  {
    code: 'CUI', labelKey: 'identity_document.gt.cui', labelVerbatim: 'CUI (DPI)',
    example: '1234567890101', pattern: '^\\d{13}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RENAP', sortOrder: 10,
  },
  {
    code: 'NIT', labelKey: 'identity_document.gt.nit', labelVerbatim: 'NIT',
    example: '1234567-9', pattern: '^\\d{2,12}-?[0-9Kk]$', checksum: 'gt_nit_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAT', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    gt_nit_mod11: isValidGuatemalanNit,
  },
  structuralChecks: [],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

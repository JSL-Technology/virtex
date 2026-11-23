// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Paraguay: the identity documents the market issues, and the arithmetic that checks them.
 */

// Paraguay — RUC, SET. Body plus a check digit, modulus 11 base 11.
export function isValidParaguayanRuc(value: string): boolean {
  const cleaned = numericOnly(value);
  if (cleaned === null) return false;
  if (cleaned.length < 6 || cleaned.length > 9) return false;

  const body = cleaned.slice(0, -1);
  const provided = Number(cleaned.slice(-1));

  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 11 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const expected = remainder > 1 ? 11 - remainder : 0;
  return expected === provided;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // A worker holds a cédula de identidad civil (a correlative number, no published check digit); the
  // RUC is that number plus a mod-11 check and identifies a taxpayer. Pattern-only for the cédula.
  {
    code: 'CEDULA', labelKey: 'identity_document.py.cedula', labelVerbatim: 'Cédula de identidad',
    example: '1234567', pattern: '^\\d{4,8}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Departamento de Identificaciones', sortOrder: 10,
  },
  {
    code: 'RUC', labelKey: 'identity_document.py.ruc', labelVerbatim: 'RUC',
    example: '80012345-0', pattern: '^\\d{5,8}-?\\d$', checksum: 'py_ruc_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SET', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    py_ruc_mod11: isValidParaguayanRuc,
  },
  structuralChecks: [],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

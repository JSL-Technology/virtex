// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';
import { digitPrefix, numericOnly } from '../kit/check-digits';

/**
 * Peru: the identity documents the market issues, and the arithmetic that checks them.
 */

// Peru — RUC, SUNAT. 11 digits, modulus 11.
export function isValidPeruvianRuc(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 11) return false;
  // 10 = natural person, 15/17 = legacy, 20 = company.
  if (!['10', '15', '17', '20'].includes(digits.slice(0, 2))) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * weights[i];
  const remainder = 11 - (sum % 11);
  const expected = String(remainder === 10 ? 0 : remainder === 11 ? 1 : remainder);
  return expected === digits[10];
}

/** RUC assigned to a company: prefix 20. */
export function isValidPeruvianRucCompany(value: string): boolean {
  return isValidPeruvianRuc(value) && digitPrefix(value) === '20';
}

/** RUC assigned to a natural person: prefix 10, plus the 15/17 legacy ranges. */
export function isValidPeruvianRucIndividual(value: string): boolean {
  return isValidPeruvianRuc(value) && ['10', '15', '17'].includes(digitPrefix(value));
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'DNI', labelKey: 'identity_document.pe.dni', labelVerbatim: 'DNI',
    example: '12345678',
    // RENIEC prints a verification character beside the eight digits, but it is not part of the
    // number as it is transcribed into a payroll system. Pattern-only until that is confirmed.
    // `sunat: '1'` is SUNAT's catálogo 06 code for a DNI (tipo de documento del adquirente).
    pattern: '^\\d{8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENIEC', sortOrder: 10, regimeCodes: { sunat: '1' },
  },
  {
    code: 'RUC', labelKey: 'identity_document.pe.ruc', labelVerbatim: 'RUC',
    example: '20123456786', pattern: '^(10|15|17|20)\\d{9}$', checksum: 'pe_ruc_mod11',
    kindChecksums: { company: 'pe_ruc_company', individual: 'pe_ruc_individual' },
    // `sunat: '6'` is SUNAT's catálogo 06 code for a RUC.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SUNAT', sortOrder: 20,
    regimeCodes: { sunat: '6' },
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    pe_ruc_mod11: isValidPeruvianRuc,
    pe_ruc_company: isValidPeruvianRucCompany,
    pe_ruc_individual: isValidPeruvianRucIndividual,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'ubigeo',
      label: 'Ubigeo',
      required: true,
      type: 'text',
      pattern: '^\\d{6}$',
      example: '150101',
      help: 'Código de distrito del INEI. SUNAT lo exige en el comprobante electrónico.',
      helpKey: 'fiscal.help.pe_ubigeo',
    },
  ],
  supranationalRegimeCodes: {},
};

// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';

/**
 * Venezuela: the identity documents the market issues, and the arithmetic that checks them.
 */

// Venezuela — RIF, SENIAT. A type letter plus 9 digits.
const RIF_TYPE_WEIGHT: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 };

/**
 * SENIAT's weight series: 4 for the type letter, then 3,2,7,6,5,4,3,2 across the eight body
 * digits.
 *
 * The previous implementation shifted the series one position onto the digits — 4,3,2,7,6,5,4,3 —
 * so the first body digit was weighted 4 instead of 3 and every subsequent one was wrong too. It
 * rejected real RIFs: `J-00123072-6` (PDVSA) and `J-00002950-4` among them. The one value it
 * accepted was the example in the country profile, `J-30599168-5`, and that is a coincidence —
 * for those particular digits the difference between the two sums happens to be exactly 11, so
 * both series land on the same residue. The unit test used that same value, so the defect was
 * invisible from inside the suite.
 */
const RIF_DIGIT_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

export function isValidVenezuelanRif(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[VEJPG]\d{9}$/.test(cleaned)) return false;

  const typeWeight = RIF_TYPE_WEIGHT[cleaned[0]];
  const digits = cleaned.slice(1);

  let sum = typeWeight * 4;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * RIF_DIGIT_WEIGHTS[i];

  const remainder = 11 - (sum % 11);
  const expected = remainder >= 10 ? 0 : remainder;
  return expected === Number(digits[8]);
}

/** RIF of a company: type letter J (company), G (public) or P (partnership). */
export function isValidVenezuelanRifCompany(value: string): boolean {
  if (!isValidVenezuelanRif(value)) return false;
  const type = value.trim().toUpperCase().replace(/[^A-Z]/g, '')[0];
  return type === 'J' || type === 'G' || type === 'P';
}

/** RIF of a natural person: type letter V (Venezuelan) or E (foreign resident). */
export function isValidVenezuelanRifIndividual(value: string): boolean {
  if (!isValidVenezuelanRif(value)) return false;
  const type = value.trim().toUpperCase().replace(/[^A-Z]/g, '')[0];
  return type === 'V' || type === 'E';
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The RIF is the tax identifier (its leading letter carries the kind: V/E a natural person,
  // J/G/P a company). The document a worker is enrolled with is the cédula de identidad — the same
  // number that seeds a V-RIF, written on its own without the type letter. Pattern-only.
  {
    code: 'CI', labelKey: 'identity_document.ve.ci', labelVerbatim: 'Cédula de identidad',
    example: 'V-12345678', pattern: '^[VEve]?-?\\d{5,9}$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'SAIME', sortOrder: 10,
  },
  {
    code: 'RIF', labelKey: 'identity_document.ve.rif', labelVerbatim: 'RIF',
    example: 'J-30599168-5', pattern: '^[VEJPGvejpg]-?\\d{8}-?\\d$', checksum: 've_rif_mod11',
    kindChecksums: { company: 've_rif_company', individual: 've_rif_individual' },
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SENIAT', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    ve_rif_mod11: isValidVenezuelanRif,
    ve_rif_company: isValidVenezuelanRifCompany,
    ve_rif_individual: isValidVenezuelanRifIndividual,
  },
  structuralChecks: [],
  fiscalFields: [],
  supranationalRegimeCodes: {},
};

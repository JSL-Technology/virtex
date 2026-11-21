// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { FiscalFieldOption, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Ecuador: the identity documents the market issues, and the arithmetic that checks them.
 */

// Ecuador — RUC, SRI. 13 digits; the rule depends on the third digit.
export function isValidEcuadorianRuc(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;
  if (digits.length !== 13) return false;

  // Provinces 1-24, plus 30 for Ecuadorians registered abroad. Rejecting 30 turned every RUC
  // issued to a non-resident taxpayer into a "bad check digit" error.
  const province = Number(digits.slice(0, 2));
  if ((province < 1 || province > 24) && province !== 30) return false;

  // The trailing three digits are the establishment code, and SRI's published rule for the RUC
  // itself is that they are 001: branch codes (002, 003…) belong to the `estab` field of an
  // electronic document, not to the taxpayer's RUC. Kept strict deliberately — for a fiscal
  // validator, widening acceptance on a rule that is not published is the wrong direction.
  if (!digits.endsWith('001')) return false;

  const thirdDigit = Number(digits[2]);

  // Natural person: the RUC is the 10-digit cédula plus the establishment code, so the cédula's
  // own check digit is the TENTH digit, computed over the first nine with coefficients
  // 2,1,2,1,2,1,2,1,2.
  //
  // This previously ran eight coefficients over the first eight digits and compared the result
  // against digits[8] — the ninth. Off by one in both the body and the target, so it rejected
  // every valid natural-person RUC in the country. `1710034065001` is a worked example: the
  // published rule yields check digit 5 and matches; the old code computed 8 against digits[8]=6.
  if (thirdDigit < 6) {
    const weights = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let product = Number(digits[i]) * weights[i];
      if (product > 9) product -= 9;
      sum += product;
    }
    const expected = (10 - (sum % 10)) % 10;
    return expected === Number(digits[9]);
  }

  // Public entity (6) and private company (9) use modulus 11 with different weights and lengths.
  const isPublic = thirdDigit === 6;
  const weights = isPublic ? [3, 2, 7, 6, 5, 4, 3, 2] : [4, 3, 2, 7, 6, 5, 4, 3, 2];
  const bodyLength = isPublic ? 8 : 9;
  let sum = 0;
  for (let i = 0; i < bodyLength; i++) sum += Number(digits[i]) * weights[i];
  const remainder = sum % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === Number(digits[bodyLength]);
}

/** RUC of a company (third digit 9) or public entity (6). */
export function isValidEcuadorianRucCompany(value: string): boolean {
  if (!isValidEcuadorianRuc(value)) return false;
  return Number((numericOnly(value) ?? '')[2]) >= 6;
}

/** RUC of a natural person (third digit below 6). */
export function isValidEcuadorianRucIndividual(value: string): boolean {
  if (!isValidEcuadorianRuc(value)) return false;
  return Number((numericOnly(value) ?? '')[2]) < 6;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // A worker holds a cédula; the RUC identifies whoever carries on economic activity, so the RUC is
  // no longer offered for payroll (it would ask an employee for a company identifier). The 10-digit
  // cédula is the first nine digits of a natural person's RUC plus a mod-10 check whose algorithm
  // this repository has not confirmed, so it validates by pattern alone for now — weaker than the
  // check digit, far stronger than offering only a passport.
  {
    code: 'CEDULA', labelKey: 'identity_document.ec.cedula', labelVerbatim: 'Cédula de identidad',
    example: '1710034065', pattern: '^\\d{10}$', checksum: null,
    // `sri: '05'` is the SRI's tipo de identificación del comprador for a cédula.
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Registro Civil', sortOrder: 10,
    regimeCodes: { sri: '05' },
  },
  {
    code: 'RUC', labelKey: 'identity_document.ec.ruc', labelVerbatim: 'RUC',
    example: '1790123456001', pattern: '^\\d{13}$', checksum: 'ec_ruc',
    kindChecksums: { company: 'ec_ruc_company', individual: 'ec_ruc_individual' },
    // `sri: '04'` is the SRI's tipo de identificación del comprador for a RUC.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SRI', sortOrder: 20, regimeCodes: { sri: '04' },
  },
];

/** SRI — whether the taxpayer is required to keep formal accounting books. */
const YES_NO: readonly FiscalFieldOption[] = [
  { code: 'SI', label: 'Sí' },
  { code: 'NO', label: 'No' },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    ec_ruc: isValidEcuadorianRuc,
    ec_ruc_company: isValidEcuadorianRucCompany,
    ec_ruc_individual: isValidEcuadorianRucIndividual,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'obligadoContabilidad',
      label: 'Obligado a llevar contabilidad',
      labelKey: 'fiscal.labels.required_to_keep_books',
      required: true,
      type: 'select',
      options: YES_NO,
      help: 'El SRI lo exige como campo del comprobante electrónico.',
      helpKey: 'fiscal.help.ec_accounting',
    },
    {
      key: 'contribuyenteEspecial',
      label: 'N.º de resolución de contribuyente especial',
      labelKey: 'fiscal.labels.special_taxpayer_resolution',
      required: false,
      type: 'text',
      pattern: '^[0-9A-Za-z\\-]{1,20}$',
      example: '12345',
    },
  ],
  supranationalRegimeCodes: { PASSPORT: { sri: '06' } },
};

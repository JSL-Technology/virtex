// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { ChecksumAlgorithm, FiscalFieldOption, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { alphanumeric } from '../kit/check-digits';

/**
 * Mexico: the identity documents the market issues, and the arithmetic that checks them.
 */

// Mexico — RFC, SAT. 12 characters for a company, 13 for a person, last is a check digit.
const RFC_ALPHABET = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';

export function isValidMexicanRfc(value: string): boolean {
  const rfc = alphanumeric(value);
  if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z\d]{3}$/.test(rfc)) return false;

  // The date embedded in positions 4–9 (or 5–10) must be a real one; a great many typos are
  // caught here rather than by the check digit.
  const isCompany = rfc.length === 12;
  const datePart = rfc.slice(isCompany ? 3 : 4, isCompany ? 9 : 10);
  const year = Number(datePart.slice(0, 2));
  const month = Number(datePart.slice(2, 4));
  const day = Number(datePart.slice(4, 6));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  // A month/day combination that cannot exist (31 April, 30 February) is also a typo.
  const daysInMonth = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day > daysInMonth) return false;
  void year;

  // SAT check digit: positions weighted descending, modulus 11 over an alphabet where the
  // 12-character company form is left-padded with a space.
  const padded = isCompany ? ` ${rfc}` : rfc;
  const body = padded.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const index = RFC_ALPHABET.indexOf(body[i]);
    if (index === -1) return false;
    sum += index * (13 - i);
  }
  const remainder = sum % 11;
  const expected = remainder === 0 ? '0' : remainder === 1 ? 'A' : String(11 - remainder);
  return expected === rfc[rfc.length - 1];
}

/**
 * The RFC is 12 characters for a persona moral and 13 for a persona física; the check pair is
 * computed the same way for both.
 */
const rfcOfLength = (length: number): ChecksumAlgorithm =>
  (value) => alphanumeric(value).length === length && isValidMexicanRfc(value);

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // The CURP identifies the person and the RFC the taxpayer. Payroll needs the first, the CFDI the
  // second, and neither substitutes for the other — which is why `usedFor` exists.
  {
    code: 'CURP', labelKey: 'identity_document.mx.curp', labelVerbatim: 'CURP',
    example: 'DEMS010203HDFLRL09',
    // 18 characters: 4 letters, 6 date digits, sex, 2-letter state, 3 consonants, homoclave, check.
    // `checksum` is null: the CURP does carry a published check digit, and tightening this entry
    // means adding that algorithm to `checksums` below and naming it here. Nothing else.
    pattern: '^[A-Z][AEIOUX][A-Z]{2}\\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d$',
    checksum: null, canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RENAPO', sortOrder: 10,
  },
  {
    code: 'RFC', labelKey: 'identity_document.mx.rfc', labelVerbatim: 'RFC',
    example: 'DEM010203AB5', pattern: '^[A-ZÑ&]{3,4}\\d{6}[A-Z\\d]{3}$', checksum: 'mx_rfc',
    kindChecksums: { company: 'mx_rfc_company', individual: 'mx_rfc_individual' },
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SAT', sortOrder: 20,
  },
];

/** SAT `c_RegimenFiscal`, CFDI 4.0. Required on every issued document. */
const TAX_REGIMES: readonly FiscalFieldOption[] = [
  { code: '601', label: 'General de Ley Personas Morales', appliesTo: ['company'] },
  { code: '603', label: 'Personas Morales con Fines no Lucrativos', appliesTo: ['company'] },
  { code: '605', label: 'Sueldos y Salarios e Ingresos Asimilados a Salarios', appliesTo: ['individual'] },
  { code: '606', label: 'Arrendamiento', appliesTo: ['individual'] },
  { code: '607', label: 'Régimen de Enajenación o Adquisición de Bienes', appliesTo: ['individual'] },
  { code: '608', label: 'Demás ingresos', appliesTo: ['individual'] },
  { code: '610', label: 'Residentes en el Extranjero sin Establecimiento Permanente en México' },
  { code: '611', label: 'Ingresos por Dividendos (socios y accionistas)', appliesTo: ['individual'] },
  { code: '612', label: 'Personas Físicas con Actividades Empresariales y Profesionales', appliesTo: ['individual'] },
  { code: '614', label: 'Ingresos por intereses', appliesTo: ['individual'] },
  { code: '615', label: 'Régimen de los ingresos por obtención de premios', appliesTo: ['individual'] },
  { code: '616', label: 'Sin obligaciones fiscales', appliesTo: ['individual'] },
  { code: '620', label: 'Sociedades Cooperativas de Producción que optan por diferir sus ingresos', appliesTo: ['company'] },
  { code: '621', label: 'Incorporación Fiscal', appliesTo: ['individual'] },
  { code: '622', label: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras', appliesTo: ['company'] },
  { code: '623', label: 'Opcional para Grupos de Sociedades', appliesTo: ['company'] },
  { code: '624', label: 'Coordinados', appliesTo: ['company'] },
  { code: '625', label: 'Actividades Empresariales con ingresos a través de Plataformas Tecnológicas', appliesTo: ['individual'] },
  { code: '626', label: 'Régimen Simplificado de Confianza (RESICO)' },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    mx_rfc: isValidMexicanRfc,
    mx_rfc_company: rfcOfLength(12),
    mx_rfc_individual: rfcOfLength(13),
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'regimenFiscal',
      label: 'Régimen fiscal',
      labelKey: 'fiscal.labels.tax_regime',
      required: true,
      type: 'select',
      options: TAX_REGIMES,
      help: 'El SAT lo exige en cada CFDI 4.0. Aparece en tu Constancia de Situación Fiscal.',
      helpKey: 'fiscal.help.mx_tax_regime',
    },
  ],
  supranationalRegimeCodes: {},
};

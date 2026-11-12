// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { FiscalFieldOption, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Colombia: the identity documents the market issues, and the arithmetic that checks them.
 */

// Colombia — NIT, DIAN. 9 digits plus a verification digit (DV).
/**
 * DIAN's published weight series, right-aligned to the body.
 *
 * The table previously stopped at nine entries while the length guard admitted an eleven-digit
 * value, so the ten-digit branch was unreachable: `body.length > NIT_WEIGHTS.length` rejected it
 * before any arithmetic ran. Ten-digit NITs are ordinary — they are the ones derived from a
 * cédula, which is what every Colombian sole trader and most small companies file under — so the
 * validator refused a whole class of legitimate taxpayer while reporting a bad check digit.
 */
const NIT_WEIGHTS = [71, 67, 59, 53, 47, 43, 41, 37, 29, 23, 19, 17, 13, 7, 3];

export function isValidColombianNit(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;

  // The verification digit is required, not optional.
  //
  // This used to accept a bare NIT on the grounds that it is "sometimes quoted without the DV" —
  // which meant a 9-digit NIT passed with no arithmetic check performed at all, and the DV is the
  // only integrity check a NIT has. DIAN issues the NIT together with its DV and every electronic
  // invoice carries both, so requiring it costs a customer nothing and is the difference between
  // validating and pretending to.
  //
  // Body length 5..15 covers everything DIAN issues: legacy short NITs, the 9-digit company form
  // and the 10-digit cédula-derived form.
  const body = digits.slice(0, -1);
  const provided = digits.slice(-1);
  if (body.length < 5 || body.length > NIT_WEIGHTS.length) return false;

  // Weights align to the RIGHT of the body.
  const weights = NIT_WEIGHTS.slice(NIT_WEIGHTS.length - body.length);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * weights[i];

  const remainder = sum % 11;
  const expected = String(remainder > 1 ? 11 - remainder : remainder);

  return expected === provided;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'CC', labelKey: 'identity_document.co.cc', labelVerbatim: 'Cédula de ciudadanía',
    example: '1020304050',
    // No published check digit: the DIAN's modulus-11 rule applies to the NIT, not to the cédula.
    // Tightening this means confirming with the Registraduría whether one exists, not guessing.
    pattern: '^\\d{6,10}$', checksum: null, canonicalForm: 'digits',
    // Also `invoicing`: a Colombian factura electrónica identifies a natural-person buyer by their
    // cédula (DIAN tipo de documento `13`), so the customer form must offer it — otherwise the only
    // recordable option is a NIT and every buyer is declared a company, which is the H-06 defect.
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll', 'invoicing'], isDefault: true,
    issuingAuthority: 'Registraduría Nacional', sortOrder: 10, regimeCodes: { dian: '13' },
  },
  {
    code: 'NIT', labelKey: 'identity_document.co.nit', labelVerbatim: 'NIT',
    example: '900123456-8', pattern: '^\\d{9,10}-?\\d$', checksum: 'co_nit_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    // `dian: '31'` is the DIAN's tipo de documento for a NIT (persona jurídica y asimiladas).
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'DIAN', sortOrder: 20,
    regimeCodes: { dian: '31' },
  },
];

/** DIAN — responsabilidades fiscales, as printed on the RUT and carried in the invoice XML. */
const FISCAL_RESPONSIBILITIES: readonly FiscalFieldOption[] = [
  { code: 'O-13', label: 'Gran contribuyente' },
  { code: 'O-15', label: 'Autorretenedor' },
  { code: 'O-23', label: 'Agente de retención IVA' },
  { code: 'O-47', label: 'Régimen simple de tributación' },
  { code: 'R-99-PN', label: 'No responsable de IVA' },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    co_nit_mod11: isValidColombianNit,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'responsabilidadesFiscales',
      label: 'Responsabilidades fiscales',
      labelKey: 'fiscal.labels.tax_responsibilities',
      required: true,
      type: 'select',
      multiple: true,
      options: FISCAL_RESPONSIBILITIES,
      help: 'Selecciona todas las que figuren en tu RUT. Viajan como lista en el XML de la factura electrónica.',
      helpKey: 'fiscal.help.co_responsibilities',
    },
  ],
  supranationalRegimeCodes: { PASSPORT: { dian: '41' } },
};

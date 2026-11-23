// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { FiscalFieldOption, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { digitPrefix, modulus11, numericOnly } from '../kit/check-digits';

/**
 * Argentina: the identity documents the market issues, and the arithmetic that checks them.
 */

// Argentina — CUIT/CUIL, AFIP. 11 digits, modulus 11.
export function isValidArgentineCuit(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 11) return false;

  // Valid entity prefixes: 20/23/24/27 (people), 30/33/34 (companies), 50/51/55 (others).
  if (!['20', '23', '24', '27', '30', '33', '34', '50', '51', '55'].includes(digits.slice(0, 2))) {
    return false;
  }

  const expected = modulus11(
    digits.slice(0, 10),
    [5, 4, 3, 2, 7, 6, 5, 4, 3, 2],
    (remainder) => {
      const digit = 11 - remainder;
      if (digit === 11) return '0';
      if (digit === 10) return null; // Not issued: AFIP re-assigns the prefix instead.
      return String(digit);
    },
  );
  return expected !== null && expected === digits[10];
}

/** CUIT assigned to a legal entity: prefixes 30/33/34 and the 50/51/55 "other" range. */
export function isValidArgentineCuitCompany(value: string): boolean {
  return isValidArgentineCuit(value) && ['30', '33', '34', '50', '51', '55'].includes(digitPrefix(value));
}

/** CUIT/CUIL assigned to a natural person: prefixes 20/23/24/27. */
export function isValidArgentineCuitIndividual(value: string): boolean {
  return isValidArgentineCuit(value) && ['20', '23', '24', '27'].includes(digitPrefix(value));
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'DNI', labelKey: 'identity_document.ar.dni', labelVerbatim: 'DNI',
    example: '12345678',
    // No check digit. The CUIL that wraps it does carry one, and is the separate row below.
    // `afip: '96'` is AFIP's DocTipo for a DNI (catálogo tipo de documento del comprador).
    pattern: '^\\d{7,8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENAPER', sortOrder: 10, regimeCodes: { afip: '96' },
  },
  {
    code: 'CUIT', labelKey: 'identity_document.ar.cuit', labelVerbatim: 'CUIT / CUIL',
    example: '30-71234567-1', pattern: '^\\d{2}-?\\d{8}-?\\d$', checksum: 'ar_cuit_mod11',
    kindChecksums: { company: 'ar_cuit_company', individual: 'ar_cuit_individual' },
    // `afip: '80'` is AFIP's DocTipo for a CUIT.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], issuingAuthority: 'AFIP', sortOrder: 20,
    regimeCodes: { afip: '80' },
  },
];

/** AFIP — condición del emisor frente al IVA. Determines which invoice class may be issued. */
const VAT_CONDITIONS: readonly FiscalFieldOption[] = [
  { code: '1', label: 'IVA Responsable Inscripto' },
  { code: '4', label: 'IVA Sujeto Exento' },
  { code: '5', label: 'Consumidor Final' },
  { code: '6', label: 'Responsable Monotributo' },
  { code: '13', label: 'Monotributista Social' },
  { code: '16', label: 'Monotributo Trabajador Independiente Promovido' },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    ar_cuit_mod11: isValidArgentineCuit,
    ar_cuit_company: isValidArgentineCuitCompany,
    ar_cuit_individual: isValidArgentineCuitIndividual,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'condicionIva',
      label: 'Condición frente al IVA',
      labelKey: 'fiscal.labels.vat_condition',
      required: true,
      type: 'select',
      options: VAT_CONDITIONS,
      help: 'Determina qué clase de comprobante (A, B, C) podés emitir.',
      helpKey: 'fiscal.help.ar_vat_condition',
    },
    {
      key: 'puntoVenta',
      label: 'Punto de venta',
      labelKey: 'fiscal.labels.point_of_sale',
      required: true,
      type: 'text',
      pattern: '^\\d{1,5}$',
      example: '0001',
      help: 'El punto de venta habilitado en AFIP para facturación electrónica.',
      helpKey: 'fiscal.help.ar_point_of_sale',
    },
  ],
  supranationalRegimeCodes: {},
};

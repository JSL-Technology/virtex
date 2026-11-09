// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { ChecksumAlgorithm, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { luhnCheckDigit, modulus11, numericOnly } from '../kit/check-digits';

/**
 * Dominican Republic: the identity documents the market issues, and the arithmetic that checks them.
 */

// Dominican Republic — RNC (9 digits) and Cédula (11 digits), DGII
export function isValidDominicanTaxId(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;

  if (digits.length === 9) {
    const expected = modulus11(digits.slice(0, 8), [7, 9, 8, 6, 5, 4, 3, 2], (remainder) => {
      if (remainder === 0) return '2';
      if (remainder === 1) return '1';
      return String(11 - remainder);
    });
    return expected !== null && expected === digits[8];
  }

  if (digits.length === 11) {
    return luhnCheckDigit(digits.slice(0, 10)) === digits[10];
  }

  return false;
}

/**
 * The Dominican identifier is one algorithm over two lengths — 9 digits weighted mod-11 for an RNC,
 * 11 digits Luhn for a cédula — and `isValidDominicanTaxId` dispatches on length. The catalogue
 * needs them apart, because a cédula in the RNC field is an error even though the combined function
 * accepts both.
 */
const dominicanOfLength = (length: number): ChecksumAlgorithm =>
  (value) => (numericOnly(value) ?? '').length === length && isValidDominicanTaxId(value);

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'CEDULA', labelKey: 'identity_document.do.cedula', labelVerbatim: 'Cédula',
    example: '001-1234567-3', pattern: '^\\d{3}-?\\d{7}-?\\d$|^\\d{11}$', checksum: 'do_cedula_luhn10',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true, issuingAuthority: 'JCE', sortOrder: 10,
  },
  {
    code: 'RNC', labelKey: 'identity_document.do.rnc', labelVerbatim: 'RNC',
    example: '131-12345-7', pattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{9}$', checksum: 'do_rnc_mod11',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'DGII', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    do_rnc_mod11: dominicanOfLength(9),
    do_cedula_luhn10: dominicanOfLength(11),
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'tipoIngreso',
      label: 'Tipo de ingreso',
      labelKey: 'fiscal.labels.income_type',
      required: true,
      type: 'select',
      options: [
        { code: '01', label: 'Ingresos por operaciones (no financieros)', labelKey: 'fiscal.do.income_type.operations' },
        { code: '02', label: 'Ingresos financieros', labelKey: 'fiscal.do.income_type.financial' },
        { code: '03', label: 'Ingresos extraordinarios', labelKey: 'fiscal.do.income_type.extraordinary' },
        { code: '04', label: 'Ingresos por arrendamientos', labelKey: 'fiscal.do.income_type.leasing' },
        { code: '05', label: 'Ingresos por venta de activo depreciable', labelKey: 'fiscal.do.income_type.depreciable_asset_sale' },
        { code: '06', label: 'Otros ingresos', labelKey: 'fiscal.do.income_type.other' },
      ],
      help: 'La DGII lo requiere en el e-CF y en el reporte 607.',
      helpKey: 'fiscal.help.do_income_type',
    },
  ],
  supranationalRegimeCodes: {},
};

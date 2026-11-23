// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { MarketIdentity, MarketIdentityDocument } from '../contracts';

/**
 * Chile: the identity documents the market issues, and the arithmetic that checks them.
 */

// Chile — RUT, SII. Body plus a check character that may be 'K'.
export function isValidChileanRut(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9K]/g, '');
  if (cleaned.length < 8 || cleaned.length > 9) return false;

  const body = cleaned.slice(0, -1);
  const provided = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  // Weights cycle 2..7 from the right.
  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 7 ? 2 : weight + 1;
  }
  const remainder = 11 - (sum % 11);
  const expected = remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
  return expected === provided;
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  // RUN and RUT are the same number under two names — the person's RUN is their RUT once they hold
  // a taxpayer role — so they share `cl_rut_mod11`. Kept as two rows because a Chilean payroll form
  // says RUN and a Chilean invoice says RUT, and the catalogue should say what the user is told.
  {
    code: 'RUN', labelKey: 'identity_document.cl.run', labelVerbatim: 'RUN',
    example: '12.345.678-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', checksum: 'cl_rut_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Registro Civil', sortOrder: 10,
  },
  {
    code: 'RUT', labelKey: 'identity_document.cl.rut', labelVerbatim: 'RUT',
    example: '76.086.428-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', checksum: 'cl_rut_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SII', sortOrder: 20,
  },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    cl_rut_mod11: isValidChileanRut,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'giro',
      label: 'Giro comercial',
      labelKey: 'fiscal.labels.line_of_business',
      required: true,
      type: 'text',
      pattern: '^.{3,80}$',
      example: 'Servicios de software',
      help: 'El SII lo imprime en cada documento tributario electrónico.',
      helpKey: 'fiscal.help.cl_line_of_business',
    },
    {
      key: 'codigoActividadEconomica',
      label: 'Código de actividad económica',
      labelKey: 'fiscal.labels.economic_activity_code',
      required: true,
      type: 'text',
      pattern: '^\\d{6}$',
      example: '620100',
    },
  ],
  supranationalRegimeCodes: {},
};

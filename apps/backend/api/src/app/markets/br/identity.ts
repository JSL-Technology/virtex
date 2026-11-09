// Market package — see docs/ARQUITECTURA_MERCADOS.md. Every market has these same files.
import type { FiscalFieldOption, MarketIdentity, MarketIdentityDocument } from '../contracts';
import { numericOnly } from '../kit/check-digits';

/**
 * Brazil: the identity documents the market issues, and the arithmetic that checks them.
 */

// Brazil — CPF (natural person), Receita Federal. 11 digits, two check digits.
/**
 * A Brazilian natural person files under a CPF, not a CNPJ. An ERP sold to Brazilian sole traders
 * has to accept one, and NF-e carries whichever the issuer holds.
 */
export function isValidBrazilianCpf(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const checkDigit = (body: string): string => {
    const start = body.length + 1;
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum += Number(body[i]) * (start - i);
    const remainder = (sum * 10) % 11;
    return String(remainder === 10 ? 0 : remainder);
  };

  return checkDigit(digits.slice(0, 9)) === digits[9] && checkDigit(digits.slice(0, 10)) === digits[10];
}

// Brazil — CNPJ, Receita Federal. 14 digits, two check digits.
export function isValidBrazilianCnpj(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 14) return false;
  // All-identical digits pass the arithmetic but are never issued.
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const checkDigit = (body: string): string => {
    const weights =
      body.length === 12
        ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
        : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < body.length; i++) sum += Number(body[i]) * weights[i];
    const remainder = sum % 11;
    return String(remainder < 2 ? 0 : 11 - remainder);
  };

  const first = checkDigit(digits.slice(0, 12));
  const second = checkDigit(digits.slice(0, 13));
  return first === digits[12] && second === digits[13];
}

const DOCUMENTS: readonly MarketIdentityDocument[] = [
  {
    code: 'CPF', labelKey: 'identity_document.br.cpf', labelVerbatim: 'CPF',
    example: '123.456.789-09', pattern: '^\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}$', checksum: 'br_cpf',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 10, regimeCodes: { nfe: 'CPF' },
  },
  {
    code: 'CNPJ', labelKey: 'identity_document.br.cnpj', labelVerbatim: 'CNPJ',
    example: '11.222.333/0001-81',
    pattern: '^\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}$', checksum: 'br_cnpj',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 20, regimeCodes: { nfe: 'CNPJ' },
  },
];

/** Receita Federal — Código de Regime Tributário, mandatory on every NF-e. */
const TAX_REGIMES: readonly FiscalFieldOption[] = [
  { code: '1', label: 'Simples Nacional' },
  { code: '2', label: 'Simples Nacional — excesso de sublimite de receita bruta' },
  { code: '3', label: 'Regime Normal' },
  { code: '4', label: 'Simples Nacional — Microempreendedor Individual (MEI)' },
];

export const identity: MarketIdentity = {
  documents: DOCUMENTS,
  checksums: {
    br_cpf: isValidBrazilianCpf,
    br_cnpj: isValidBrazilianCnpj,
  },
  structuralChecks: [],
  fiscalFields: [
    {
      key: 'regimeTributario',
      label: 'Regime tributário (CRT)',
      required: true,
      type: 'select',
      options: TAX_REGIMES,
      help: 'Obrigatório em toda NF-e.',
      helpKey: 'fiscal.help.br_tax_regime',
    },
    {
      key: 'inscricaoEstadual',
      label: 'Inscrição Estadual',
      required: true,
      type: 'text',
      pattern: '^(ISENTO|[0-9.\\-/]{2,20})$',
      example: '123.456.789.110',
      help: 'Informe ISENTO se não for contribuinte de ICMS.',
      helpKey: 'fiscal.help.br_state_registration',
    },
    {
      key: 'cnae',
      label: 'CNAE principal',
      required: false,
      type: 'text',
      pattern: '^\\d{7}$',
      example: '6201501',
    },
  ],
  supranationalRegimeCodes: {},
};

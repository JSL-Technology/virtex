/**
 * The identity documents each market issues, as data.
 *
 * ## What this replaces
 *
 * `employees.identity_document_type` was a PostgreSQL `ENUM` holding `CEDULA`, `PASSPORT` and
 * `RNC` — two Dominican documents and a passport — on a table shared by nineteen markets. Adding
 * Colombia meant `ALTER TYPE … ADD VALUE`, which is a schema migration and a deploy per country,
 * and which PostgreSQL cannot undo: there is no `DROP VALUE`. The enum only ever grows.
 *
 * Worse than the rigidity was what sat on top of it. The regional translation patches renamed the
 * SAME enum value per locale — `document_type.cedula` read "SSN" in `en-US`, "RUN" in `es-CL`,
 * "DNI" in `es-PE`, "CPF" in `pt-BR` — while the server went on validating every one of them with
 * the Dominican JCE modulus-10 rule. The interface asked a US employer for a nine-digit SSN and
 * the server rejected it for not being an eleven-digit Dominican cédula. Seven markets could not
 * store an employee's identity document at all, and the remaining eleven had no regional patch, so
 * they met two generic labels with the same Dominican arithmetic behind them.
 *
 * ## The shape, and why each field is here
 *
 * A document type is `(country, code)`. Everything else — what it is called, what shape it takes,
 * whether it carries a check digit, who it identifies, where it is used — is an attribute of that
 * pair, not of the code alone. A "cédula" is not one thing: the Dominican one is eleven digits with
 * a Luhn check, the Colombian one is six to ten digits with none, and the Costa Rican one is a tax
 * identifier. Keying on the code alone is what made them look interchangeable.
 *
 * `checksum` holds the NAME of an algorithm, resolved through `document-checksums.ts`. A row cannot
 * carry a modulus-11 sum, but it can carry `'cl_rut_mod11'`, and a new country that reuses an
 * existing algorithm then costs a row and no code.
 *
 * Non-existence is expressed by the ABSENCE OF A ROW, never by a third value on `requirement`. A
 * country does not declare the documents it does not issue, and a form that asks the catalogue
 * "what can identify a natural person here?" gets an answer that is true by construction.
 *
 * ## What is seeded here, and what deliberately is not
 *
 * Every row below is derived from something this repository already asserts:
 *
 *   - the fiscal identifiers come from `TAX_ID_RULES`, which validates all nineteen markets
 *     arithmetically and is covered by `tax-id-validators.spec.ts`. Where
 *     `kindAffectsValidation` is true the country issues a different identifier to each kind, so
 *     it gets two rows; where it is false one identifier serves both, so it gets one;
 *   - the national identity documents come from the regional translation patches the team already
 *     wrote — `es-CO` says "Cédula de ciudadanía", `es-MX` says "CURP / INE", `es-PE` and `es-AR`
 *     say "DNI", `es-CL` says "RUN". Those assertions are not new; they are being moved out of the
 *     translation catalogue, where they were doing a catalogue's job badly, and into the catalogue;
 *   - the passport is universal.
 *
 * Nothing else is seeded, and that is a decision rather than an omission. A Colombian cédula de
 * extranjería, a Mexican INE as distinct from the CURP, an Ecuadorian cédula separate from the RUC
 * — these exist, and this file does not invent their formats. **Adding them is now an INSERT.**
 * That is the whole point of the refactor: the eight markets that carry only their fiscal
 * identifier and a passport today are under-populated as DATA, not blocked by SCHEMA.
 *
 * Entries whose `checksum` is `null` are validated by pattern alone. For a passport that is
 * correct — there is no algorithm to apply across every issuing state. For `CO.CC`, `PE.DNI`,
 * `AR.DNI` and `MX.CURP` it reflects that this repository has no published check rule for them
 * yet; each is marked below with what would have to be confirmed to tighten it. A pattern-only
 * entry is weaker than an algorithmic one and stronger than the previous behaviour, which was to
 * apply a different country's algorithm.
 */

import { COUNTRY_FISCAL_PROFILES } from './country-profiles';

/** Who a document identifies. Ternary, not boolean: a Chilean RUT identifies both. */
export type DocumentAppliesTo = 'individual' | 'company' | 'both';

/** Whether the country requires the document where it is used. Absence of a row means "not issued". */
export type DocumentRequirement = 'required' | 'optional';

/**
 * Where in the product a document is asked for.
 *
 * Mexico is the case that forced this: the SAT wants an RFC on every CFDI, and payroll wants the
 * employee's CURP. Both are Mexican identity documents and neither substitutes for the other, so a
 * catalogue with no notion of context would offer the RFC on the employee form — which is how the
 * enum behaved, and why `RNC` appeared as an option for a Dominican employee.
 */
export type DocumentContext = 'payroll' | 'invoicing' | 'registration';

/**
 * How the value is normalised before it is stored and compared.
 *
 * Mirrors the canonicalisers in `tax-id-validators.ts`. Kept as a string union rather than a
 * function reference because it has to survive a round trip through a database column.
 */
export type CanonicalForm = 'digits' | 'alphanumeric' | 'segmented';

export interface IdentityDocumentTypeSpec {
  /** ISO 3166-1 alpha-2 of the ISSUING jurisdiction, or `XX` for a supranational document. */
  countryCode: string;
  /**
   * The authority's own code, declared explicitly.
   *
   * Never derived from the label. The previous seeding computed it as
   * `label.replace(/[^A-Za-z]/g, '').toUpperCase()`, which turned `'RNC / Cédula'` into
   * `RNCCDULA` and `'Cédula jurídica'` into `CDULAJURDICA` — identifiers nobody chose, that no
   * authority publishes, and that changed whenever someone edited a label.
   */
  code: string;
  /** Catalogue key. The label is NEVER stored as a word; see `label-verbatim` below. */
  labelKey: string;
  /**
   * Terminology that must NOT be translated, because it is what the authority prints on the paper
   * the user is copying from. "CUIT" glossed as "tax number" is harder to find on the page, not
   * easier. When set, it wins over `labelKey` at render time.
   */
  labelVerbatim?: string;
  /** Placeholder. Shaped like a real value, never a real issued identifier. */
  example?: string;
  /** Anchored on both ends. Shape only — the authoritative check is `checksum`, server-side. */
  pattern: string;
  /** Name resolved through `CHECKSUM_ALGORITHMS`. Null means the pattern is the whole check. */
  checksum: string | null;
  canonicalForm: CanonicalForm;
  appliesTo: DocumentAppliesTo;
  requirement: DocumentRequirement;
  usedFor: readonly DocumentContext[];
  /** At most one default per (country, appliesTo, context). Replaces the `DEFAULT 'CEDULA'`. */
  isDefault?: boolean;
  issuingAuthority?: string;
  sortOrder: number;
}

/**
 * A passport, issued by every state and identifying a natural person anywhere.
 *
 * `XX` rather than nineteen duplicated rows. A passport's issuing jurisdiction is the traveller's,
 * not the employer's, so filing it under the employer's country would be false; and a foreign hire
 * is exactly the case where a passport is the document on hand. Resolution always considers the
 * tenant's country AND `XX`, so it is offered everywhere without being claimed by anyone.
 */
const PASSPORT: IdentityDocumentTypeSpec = {
  countryCode: 'XX',
  code: 'PASSPORT',
  labelKey: 'identity_document.passport',
  // Deliberately wide. Passport numbers are issued by ~200 states under no common scheme; any
  // tighter pattern rejects somebody's real document, which is worse than accepting a typo.
  pattern: '^[A-Za-z0-9]{5,20}$',
  checksum: null,
  canonicalForm: 'alphanumeric',
  appliesTo: 'individual',
  requirement: 'optional',
  usedFor: ['payroll', 'invoicing'],
  sortOrder: 900,
};

export const IDENTITY_DOCUMENT_TYPES: readonly IdentityDocumentTypeSpec[] = Object.freeze([
  // ── Dominican Republic ────────────────────────────────────────────────────
  {
    countryCode: 'DO', code: 'CEDULA', labelKey: 'identity_document.do.cedula', labelVerbatim: 'Cédula',
    example: '001-1234567-8', pattern: '^\\d{3}-?\\d{7}-?\\d$|^\\d{11}$', checksum: 'do_cedula_luhn10',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true, issuingAuthority: 'JCE', sortOrder: 10,
  },
  {
    countryCode: 'DO', code: 'RNC', labelKey: 'identity_document.do.rnc', labelVerbatim: 'RNC',
    example: '131-12345-7', pattern: '^\\d{3}-?\\d{5}-?\\d$|^\\d{9}$', checksum: 'do_rnc_mod11',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'DGII', sortOrder: 20,
  },

  // ── United States ─────────────────────────────────────────────────────────
  {
    countryCode: 'US', code: 'SSN', labelKey: 'identity_document.us.ssn', labelVerbatim: 'SSN / ITIN',
    example: '123-45-6789', pattern: '^\\d{3}-?\\d{2}-?\\d{4}$', checksum: 'us_ssn_itin',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true, issuingAuthority: 'SSA / IRS', sortOrder: 10,
  },
  {
    countryCode: 'US', code: 'EIN', labelKey: 'identity_document.us.ein', labelVerbatim: 'EIN',
    example: '12-3456789', pattern: '^\\d{2}-?\\d{7}$', checksum: 'us_ein_prefix',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'IRS', sortOrder: 20,
  },

  // ── Mexico ────────────────────────────────────────────────────────────────
  // The CURP identifies the person and the RFC the taxpayer. Payroll needs the first, the CFDI the
  // second, and neither substitutes for the other — which is why `usedFor` exists.
  {
    countryCode: 'MX', code: 'CURP', labelKey: 'identity_document.mx.curp', labelVerbatim: 'CURP',
    example: 'DEMS010203HDFLRL09',
    // 18 characters: 4 letters, 6 date digits, sex, 2-letter state, 3 consonants, homoclave, check.
    // `checksum` is null: the CURP does carry a published check digit, and tightening this entry
    // means adding that algorithm to `document-checksums.ts` and naming it here. Nothing else.
    pattern: '^[A-Z][AEIOUX][A-Z]{2}\\d{6}[HM][A-Z]{2}[B-DF-HJ-NP-TV-Z]{3}[A-Z\\d]\\d$',
    checksum: null, canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RENAPO', sortOrder: 10,
  },
  {
    countryCode: 'MX', code: 'RFC', labelKey: 'identity_document.mx.rfc', labelVerbatim: 'RFC',
    example: 'DEM010203AB5', pattern: '^[A-ZÑ&]{3,4}\\d{6}[A-Z\\d]{3}$', checksum: 'mx_rfc',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SAT', sortOrder: 20,
  },

  // ── Colombia ──────────────────────────────────────────────────────────────
  {
    countryCode: 'CO', code: 'CC', labelKey: 'identity_document.co.cc', labelVerbatim: 'Cédula de ciudadanía',
    example: '1020304050',
    // No published check digit: the DIAN's modulus-11 rule applies to the NIT, not to the cédula.
    // Tightening this means confirming with the Registraduría whether one exists, not guessing.
    pattern: '^\\d{6,10}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'Registraduría Nacional', sortOrder: 10,
  },
  {
    countryCode: 'CO', code: 'NIT', labelKey: 'identity_document.co.nit', labelVerbatim: 'NIT',
    example: '900123456-8', pattern: '^\\d{9,10}-?\\d$', checksum: 'co_nit_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'DIAN', sortOrder: 20,
  },

  // ── Chile ─────────────────────────────────────────────────────────────────
  // RUN and RUT are the same number under two names — the person's RUN is their RUT once they hold
  // a taxpayer role — so they share `cl_rut_mod11`. Kept as two rows because a Chilean payroll form
  // says RUN and a Chilean invoice says RUT, and the catalogue should say what the user is told.
  {
    countryCode: 'CL', code: 'RUN', labelKey: 'identity_document.cl.run', labelVerbatim: 'RUN',
    example: '12.345.678-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', checksum: 'cl_rut_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Registro Civil', sortOrder: 10,
  },
  {
    countryCode: 'CL', code: 'RUT', labelKey: 'identity_document.cl.rut', labelVerbatim: 'RUT',
    example: '76.086.428-5', pattern: '^\\d{1,2}\\.?\\d{3}\\.?\\d{3}-?[0-9Kk]$', checksum: 'cl_rut_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SII', sortOrder: 20,
  },

  // ── Peru ──────────────────────────────────────────────────────────────────
  {
    countryCode: 'PE', code: 'DNI', labelKey: 'identity_document.pe.dni', labelVerbatim: 'DNI',
    example: '12345678',
    // RENIEC prints a verification character beside the eight digits, but it is not part of the
    // number as it is transcribed into a payroll system. Pattern-only until that is confirmed.
    pattern: '^\\d{8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENIEC', sortOrder: 10,
  },
  {
    countryCode: 'PE', code: 'RUC', labelKey: 'identity_document.pe.ruc', labelVerbatim: 'RUC',
    example: '20123456786', pattern: '^(10|15|17|20)\\d{9}$', checksum: 'pe_ruc_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SUNAT', sortOrder: 20,
  },

  // ── Argentina ─────────────────────────────────────────────────────────────
  {
    countryCode: 'AR', code: 'DNI', labelKey: 'identity_document.ar.dni', labelVerbatim: 'DNI',
    example: '12345678',
    // No check digit. The CUIL that wraps it does carry one, and is the separate row below.
    pattern: '^\\d{7,8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENAPER', sortOrder: 10,
  },
  {
    countryCode: 'AR', code: 'CUIT', labelKey: 'identity_document.ar.cuit', labelVerbatim: 'CUIT / CUIL',
    example: '30-71234567-1', pattern: '^\\d{2}-?\\d{8}-?\\d$', checksum: 'ar_cuit_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], issuingAuthority: 'AFIP', sortOrder: 20,
  },

  // ── Brazil ────────────────────────────────────────────────────────────────
  {
    countryCode: 'BR', code: 'CPF', labelKey: 'identity_document.br.cpf', labelVerbatim: 'CPF',
    example: '123.456.789-09', pattern: '^\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}$', checksum: 'br_cpf',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 10,
  },
  {
    countryCode: 'BR', code: 'CNPJ', labelKey: 'identity_document.br.cnpj', labelVerbatim: 'CNPJ',
    example: '11.222.333/0001-81',
    pattern: '^\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}$', checksum: 'br_cnpj',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 20,
  },

  // ── Ecuador ───────────────────────────────────────────────────────────────
  {
    countryCode: 'EC', code: 'RUC', labelKey: 'identity_document.ec.ruc', labelVerbatim: 'RUC',
    example: '1790123456001', pattern: '^\\d{13}$', checksum: 'ec_ruc',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SRI', sortOrder: 10,
  },

  // ── Uruguay ───────────────────────────────────────────────────────────────
  {
    countryCode: 'UY', code: 'RUT', labelKey: 'identity_document.uy.rut', labelVerbatim: 'RUT',
    example: '211003420017', pattern: '^\\d{12}$', checksum: 'uy_rut_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 10,
  },

  // ── Paraguay ──────────────────────────────────────────────────────────────
  {
    countryCode: 'PY', code: 'RUC', labelKey: 'identity_document.py.ruc', labelVerbatim: 'RUC',
    example: '80012345-0', pattern: '^\\d{5,8}-?\\d$', checksum: 'py_ruc_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SET', sortOrder: 10,
  },

  // ── Bolivia ───────────────────────────────────────────────────────────────
  {
    countryCode: 'BO', code: 'NIT', labelKey: 'identity_document.bo.nit', labelVerbatim: 'NIT',
    example: '1234567890', pattern: '^\\d{7,12}$', checksum: 'bo_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SIN', sortOrder: 10,
  },

  // ── Venezuela ─────────────────────────────────────────────────────────────
  // One RIF, whose leading letter carries the distinction: V/E a natural person, J/G/P a company.
  {
    countryCode: 'VE', code: 'RIF', labelKey: 'identity_document.ve.rif', labelVerbatim: 'RIF',
    example: 'J-30599168-5', pattern: '^[VEJPGvejpg]-?\\d{8}-?\\d$', checksum: 've_rif_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SENIAT', sortOrder: 10,
  },

  // ── Panama ────────────────────────────────────────────────────────────────
  {
    countryCode: 'PA', code: 'RUC', labelKey: 'identity_document.pa.ruc', labelVerbatim: 'RUC',
    example: '15512345-2-2018', pattern: '^[\\dA-Za-z]+(-[\\dA-Za-z]+){1,4}$', checksum: 'pa_ruc',
    canonicalForm: 'segmented', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 10,
  },

  // ── Costa Rica ────────────────────────────────────────────────────────────
  {
    countryCode: 'CR', code: 'CEDULA_FISICA', labelKey: 'identity_document.cr.cedula_fisica',
    labelVerbatim: 'Cédula física', example: '112345678', pattern: '^\\d{9}$',
    checksum: 'cr_cedula_fisica', canonicalForm: 'digits', appliesTo: 'individual',
    requirement: 'required', usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'TSE', sortOrder: 10,
  },
  {
    countryCode: 'CR', code: 'CEDULA_JURIDICA', labelKey: 'identity_document.cr.cedula_juridica',
    labelVerbatim: 'Cédula jurídica', example: '3101123456', pattern: '^\\d{10}$',
    checksum: 'cr_cedula_juridica', canonicalForm: 'digits', appliesTo: 'company',
    requirement: 'required', usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Registro Nacional', sortOrder: 20,
  },

  // ── Guatemala ─────────────────────────────────────────────────────────────
  {
    countryCode: 'GT', code: 'NIT', labelKey: 'identity_document.gt.nit', labelVerbatim: 'NIT',
    example: '1234567-9', pattern: '^\\d{2,12}-?[0-9Kk]$', checksum: 'gt_nit_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAT', sortOrder: 10,
  },

  // ── El Salvador ───────────────────────────────────────────────────────────
  {
    countryCode: 'SV', code: 'NIT', labelKey: 'identity_document.sv.nit', labelVerbatim: 'NIT',
    example: '0614-123456-001-2', pattern: '^\\d{4}-?\\d{6}-?\\d{3}-?\\d$', checksum: 'sv_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Ministerio de Hacienda', sortOrder: 10,
  },

  // ── Honduras ──────────────────────────────────────────────────────────────
  {
    countryCode: 'HN', code: 'RTN', labelKey: 'identity_document.hn.rtn', labelVerbatim: 'RTN',
    example: '08019012345678', pattern: '^\\d{14}$', checksum: 'hn_rtn',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAR', sortOrder: 10,
  },

  // ── Nicaragua ─────────────────────────────────────────────────────────────
  {
    countryCode: 'NI', code: 'RUC', labelKey: 'identity_document.ni.ruc', labelVerbatim: 'RUC',
    example: 'J0310000012345', pattern: '^[A-Za-z0-9]{14}$', checksum: 'ni_ruc',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 10,
  },

  // ── Supranational ─────────────────────────────────────────────────────────
  PASSPORT,
]);

/** The pseudo-country under which documents with no single issuing state are filed. */
export const SUPRANATIONAL_COUNTRY = 'XX';

/**
 * Every document a country can offer: its own, plus the supranational ones.
 *
 * Used by the seeder and by tests. Runtime resolution goes through the database, not through this
 * function, so an operator who inserts a row does not have to redeploy for it to appear.
 */
export function catalogueForCountry(countryCode: string): IdentityDocumentTypeSpec[] {
  const country = (countryCode ?? '').trim().toUpperCase();
  return IDENTITY_DOCUMENT_TYPES.filter(
    (entry) => entry.countryCode === country || entry.countryCode === SUPRANATIONAL_COUNTRY,
  ).sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * The markets that must have at least one entry.
 *
 * Derived from `COUNTRY_FISCAL_PROFILES` rather than restated, so a market added there without a
 * document type fails `identity-document-catalogue.spec.ts` instead of silently shipping a country
 * whose employee form has nothing to offer but a passport.
 */
export const MARKETS_REQUIRING_DOCUMENTS: readonly string[] = Object.freeze(
  COUNTRY_FISCAL_PROFILES.map((profile) => profile.countryCode),
);

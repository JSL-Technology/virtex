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
import { resolveChecksum } from './document-checksums';
import { TaxpayerKind } from './tax-id-validators';

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
  /**
   * Kind-specific checksum names, for the few countries whose SINGLE identifier refines its check
   * by taxpayer kind — a Mexican RFC's 12-vs-13 length, an Argentine CUIT's prefix, an Ecuadorian
   * RUC's third digit, a Venezuelan RIF's type letter. When the caller knows the kind, the tax-id
   * validator applies the matching one on top of the base `checksum`; this is what replaced the
   * `byPrefix()` / `byLength()` helpers and the per-country map they lived in. Absent for documents
   * whose kind is settled by which ROW was chosen (an RNC is a company's, a cédula a person's).
   */
  kindChecksums?: Readonly<Partial<Record<TaxpayerKind, string>>>;
  /**
   * This document's code in each electronic-invoicing regime, so a builder can state the buyer's
   * document type without inferring it from the number's length (A-02): a Brazilian CNPJ is `'CNPJ'`
   * to the NF-e, a natural person `'80'` to AFIP. Keyed by a regime tag the builder owns.
   */
  regimeCodes?: Readonly<Record<string, string>>;
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
  // A passport is `06` to Ecuador's SRI and `41` to Colombia's DIAN. The e-invoicing builders read
  // these instead of counting digits (a passport has no fixed length), so a foreign buyer is
  // declared as a passport holder, never mislabelled as an unidentified consumer (A-02).
  regimeCodes: { sri: '06', dian: '41' },
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
    kindChecksums: { company: 'mx_rfc_company', individual: 'mx_rfc_individual' },
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
    // Also `invoicing`: a Colombian factura electrónica identifies a natural-person buyer by their
    // cédula (DIAN tipo de documento `13`), so the customer form must offer it — otherwise the only
    // recordable option is a NIT and every buyer is declared a company, which is the H-06 defect.
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll', 'invoicing'], isDefault: true,
    issuingAuthority: 'Registraduría Nacional', sortOrder: 10, regimeCodes: { dian: '13' },
  },
  {
    countryCode: 'CO', code: 'NIT', labelKey: 'identity_document.co.nit', labelVerbatim: 'NIT',
    example: '900123456-8', pattern: '^\\d{9,10}-?\\d$', checksum: 'co_nit_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    // `dian: '31'` is the DIAN's tipo de documento for a NIT (persona jurídica y asimiladas).
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'DIAN', sortOrder: 20,
    regimeCodes: { dian: '31' },
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
    // `sunat: '1'` is SUNAT's catálogo 06 code for a DNI (tipo de documento del adquirente).
    pattern: '^\\d{8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENIEC', sortOrder: 10, regimeCodes: { sunat: '1' },
  },
  {
    countryCode: 'PE', code: 'RUC', labelKey: 'identity_document.pe.ruc', labelVerbatim: 'RUC',
    example: '20123456786', pattern: '^(10|15|17|20)\\d{9}$', checksum: 'pe_ruc_mod11',
    kindChecksums: { company: 'pe_ruc_company', individual: 'pe_ruc_individual' },
    // `sunat: '6'` is SUNAT's catálogo 06 code for a RUC.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true, issuingAuthority: 'SUNAT', sortOrder: 20,
    regimeCodes: { sunat: '6' },
  },

  // ── Argentina ─────────────────────────────────────────────────────────────
  {
    countryCode: 'AR', code: 'DNI', labelKey: 'identity_document.ar.dni', labelVerbatim: 'DNI',
    example: '12345678',
    // No check digit. The CUIL that wraps it does carry one, and is the separate row below.
    // `afip: '96'` is AFIP's DocTipo for a DNI (catálogo tipo de documento del comprador).
    pattern: '^\\d{7,8}$', checksum: null, canonicalForm: 'digits',
    appliesTo: 'individual', requirement: 'required', usedFor: ['payroll'], isDefault: true,
    issuingAuthority: 'RENAPER', sortOrder: 10, regimeCodes: { afip: '96' },
  },
  {
    countryCode: 'AR', code: 'CUIT', labelKey: 'identity_document.ar.cuit', labelVerbatim: 'CUIT / CUIL',
    example: '30-71234567-1', pattern: '^\\d{2}-?\\d{8}-?\\d$', checksum: 'ar_cuit_mod11',
    kindChecksums: { company: 'ar_cuit_company', individual: 'ar_cuit_individual' },
    // `afip: '80'` is AFIP's DocTipo for a CUIT.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], issuingAuthority: 'AFIP', sortOrder: 20,
    regimeCodes: { afip: '80' },
  },

  // ── Brazil ────────────────────────────────────────────────────────────────
  {
    countryCode: 'BR', code: 'CPF', labelKey: 'identity_document.br.cpf', labelVerbatim: 'CPF',
    example: '123.456.789-09', pattern: '^\\d{3}\\.?\\d{3}\\.?\\d{3}-?\\d{2}$', checksum: 'br_cpf',
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll', 'invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 10, regimeCodes: { nfe: 'CPF' },
  },
  {
    countryCode: 'BR', code: 'CNPJ', labelKey: 'identity_document.br.cnpj', labelVerbatim: 'CNPJ',
    example: '11.222.333/0001-81',
    pattern: '^\\d{2}\\.?\\d{3}\\.?\\d{3}/?\\d{4}-?\\d{2}$', checksum: 'br_cnpj',
    canonicalForm: 'digits', appliesTo: 'company', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Receita Federal', sortOrder: 20, regimeCodes: { nfe: 'CNPJ' },
  },

  // ── Ecuador ───────────────────────────────────────────────────────────────
  // A worker holds a cédula; the RUC identifies whoever carries on economic activity, so the RUC is
  // no longer offered for payroll (it would ask an employee for a company identifier). The 10-digit
  // cédula is the first nine digits of a natural person's RUC plus a mod-10 check whose algorithm
  // this repository has not confirmed, so it validates by pattern alone for now — weaker than the
  // check digit, far stronger than offering only a passport.
  {
    countryCode: 'EC', code: 'CEDULA', labelKey: 'identity_document.ec.cedula', labelVerbatim: 'Cédula de identidad',
    example: '1710034065', pattern: '^\\d{10}$', checksum: null,
    // `sri: '05'` is the SRI's tipo de identificación del comprador for a cédula.
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Registro Civil', sortOrder: 10,
    regimeCodes: { sri: '05' },
  },
  {
    countryCode: 'EC', code: 'RUC', labelKey: 'identity_document.ec.ruc', labelVerbatim: 'RUC',
    example: '1790123456001', pattern: '^\\d{13}$', checksum: 'ec_ruc',
    kindChecksums: { company: 'ec_ruc_company', individual: 'ec_ruc_individual' },
    // `sri: '04'` is the SRI's tipo de identificación del comprador for a RUC.
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SRI', sortOrder: 20, regimeCodes: { sri: '04' },
  },

  // ── Uruguay ───────────────────────────────────────────────────────────────
  // The RUT (12 digits) belongs to a taxpayer; a worker holds a cédula de identidad — seven digits
  // and a mod-10 check digit written `1.234.567-8`. The check algorithm is published (weights
  // 2,9,8,7,6,3,4) but is left unimplemented for now, so the row validates by pattern alone and the
  // separators are canonicalised away.
  {
    countryCode: 'UY', code: 'CEDULA', labelKey: 'identity_document.uy.cedula', labelVerbatim: 'Cédula de identidad',
    example: '12345672', pattern: '^\\d{6,8}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'DNIC', sortOrder: 10,
  },
  {
    countryCode: 'UY', code: 'RUT', labelKey: 'identity_document.uy.rut', labelVerbatim: 'RUT',
    example: '211003420017', pattern: '^\\d{12}$', checksum: 'uy_rut_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
  },

  // ── Paraguay ──────────────────────────────────────────────────────────────
  // A worker holds a cédula de identidad civil (a correlative number, no published check digit); the
  // RUC is that number plus a mod-11 check and identifies a taxpayer. Pattern-only for the cédula.
  {
    countryCode: 'PY', code: 'CEDULA', labelKey: 'identity_document.py.cedula', labelVerbatim: 'Cédula de identidad',
    example: '1234567', pattern: '^\\d{4,8}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Departamento de Identificaciones', sortOrder: 10,
  },
  {
    countryCode: 'PY', code: 'RUC', labelKey: 'identity_document.py.ruc', labelVerbatim: 'RUC',
    example: '80012345-0', pattern: '^\\d{5,8}-?\\d$', checksum: 'py_ruc_mod11',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SET', sortOrder: 20,
  },

  // ── Bolivia ───────────────────────────────────────────────────────────────
  // The NIT is a taxpayer identifier; a worker holds a cédula de identidad issued by SEGIP — a
  // numeric base with an optional department/expedition complement (e.g. `-1K`). Kept deliberately
  // wide and pattern-only: SEGIP publishes no check digit this repository can assert.
  {
    countryCode: 'BO', code: 'CI', labelKey: 'identity_document.bo.ci', labelVerbatim: 'Cédula de identidad',
    example: '1234567', pattern: '^\\d{4,10}(-?[A-Za-z0-9]{1,3})?$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'SEGIP', sortOrder: 10,
  },
  {
    countryCode: 'BO', code: 'NIT', labelKey: 'identity_document.bo.nit', labelVerbatim: 'NIT',
    example: '1234567890', pattern: '^\\d{7,12}$', checksum: 'bo_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SIN', sortOrder: 20,
  },

  // ── Venezuela ─────────────────────────────────────────────────────────────
  // The RIF is the tax identifier (its leading letter carries the kind: V/E a natural person,
  // J/G/P a company). The document a worker is enrolled with is the cédula de identidad — the same
  // number that seeds a V-RIF, written on its own without the type letter. Pattern-only.
  {
    countryCode: 'VE', code: 'CI', labelKey: 'identity_document.ve.ci', labelVerbatim: 'Cédula de identidad',
    example: 'V-12345678', pattern: '^[VEve]?-?\\d{5,9}$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'SAIME', sortOrder: 10,
  },
  {
    countryCode: 'VE', code: 'RIF', labelKey: 'identity_document.ve.rif', labelVerbatim: 'RIF',
    example: 'J-30599168-5', pattern: '^[VEJPGvejpg]-?\\d{8}-?\\d$', checksum: 've_rif_mod11',
    kindChecksums: { company: 've_rif_company', individual: 've_rif_individual' },
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SENIAT', sortOrder: 20,
  },

  // ── Panama ────────────────────────────────────────────────────────────────
  // A worker holds a cédula: `provincia-tomo-asiento` (`8-430-70`), with letter prefixes for those
  // born abroad (PE), naturalised (N) or foreign residents (E). Composite like the RUC, so it takes
  // the same segmented canonical form. No published check digit.
  {
    countryCode: 'PA', code: 'CEDULA', labelKey: 'identity_document.pa.cedula', labelVerbatim: 'Cédula de identidad',
    example: '8-430-70', pattern: '^[A-Za-z0-9]+(-[A-Za-z0-9]+){1,3}$', checksum: null,
    canonicalForm: 'segmented', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'Tribunal Electoral', sortOrder: 10,
  },
  {
    countryCode: 'PA', code: 'RUC', labelKey: 'identity_document.pa.ruc', labelVerbatim: 'RUC',
    example: '15512345-2-2018', pattern: '^[\\dA-Za-z]+(-[\\dA-Za-z]+){1,4}$', checksum: 'pa_ruc',
    canonicalForm: 'segmented', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
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
  // The NIT is the tax number; a worker is identified by the DPI, whose number is the CUI — 13
  // digits (8 correlative, a verifier, then the 4-digit municipality). Pattern-only for now.
  {
    countryCode: 'GT', code: 'CUI', labelKey: 'identity_document.gt.cui', labelVerbatim: 'CUI (DPI)',
    example: '1234567890101', pattern: '^\\d{13}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RENAP', sortOrder: 10,
  },
  {
    countryCode: 'GT', code: 'NIT', labelKey: 'identity_document.gt.nit', labelVerbatim: 'NIT',
    example: '1234567-9', pattern: '^\\d{2,12}-?[0-9Kk]$', checksum: 'gt_nit_mod11',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAT', sortOrder: 20,
  },

  // ── El Salvador ───────────────────────────────────────────────────────────
  // The NIT is the tax number; a worker holds a DUI — eight digits and a check digit, `########-#`.
  // The check algorithm is not implemented here yet, so it validates by pattern alone.
  {
    countryCode: 'SV', code: 'DUI', labelKey: 'identity_document.sv.dui', labelVerbatim: 'DUI',
    example: '01234567-8', pattern: '^\\d{8}-?\\d$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RNPN', sortOrder: 10,
  },
  {
    countryCode: 'SV', code: 'NIT', labelKey: 'identity_document.sv.nit', labelVerbatim: 'NIT',
    example: '0614-123456-001-2', pattern: '^\\d{4}-?\\d{6}-?\\d{3}-?\\d$', checksum: 'sv_nit',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'Ministerio de Hacienda', sortOrder: 20,
  },

  // ── Honduras ──────────────────────────────────────────────────────────────
  // The RTN is the tax number; a worker holds the Documento Nacional de Identificación — 13 digits
  // (4-digit municipality, 4-digit birth year, 5 correlative). Pattern-only for now.
  {
    countryCode: 'HN', code: 'DNI', labelKey: 'identity_document.hn.dni', labelVerbatim: 'Identidad',
    example: '0801199012345', pattern: '^\\d{13}$', checksum: null,
    canonicalForm: 'digits', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'RNP', sortOrder: 10,
  },
  {
    countryCode: 'HN', code: 'RTN', labelKey: 'identity_document.hn.rtn', labelVerbatim: 'RTN',
    example: '08019012345678', pattern: '^\\d{14}$', checksum: 'hn_rtn',
    canonicalForm: 'digits', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'SAR', sortOrder: 20,
  },

  // ── Nicaragua ─────────────────────────────────────────────────────────────
  // The RUC is the tax number; a worker holds a cédula: `###-######-####A` — municipality, birth
  // date, correlative and a Module-23 check letter. The letter check is not implemented here yet.
  {
    countryCode: 'NI', code: 'CI', labelKey: 'identity_document.ni.ci', labelVerbatim: 'Cédula de identidad',
    example: '001-230592-1002X', pattern: '^\\d{3}-?\\d{6}-?\\d{4}[A-Za-z]$', checksum: null,
    canonicalForm: 'alphanumeric', appliesTo: 'individual', requirement: 'required',
    usedFor: ['payroll'], isDefault: true, issuingAuthority: 'CSE', sortOrder: 10,
  },
  {
    countryCode: 'NI', code: 'RUC', labelKey: 'identity_document.ni.ruc', labelVerbatim: 'RUC',
    example: 'J0310000012345', pattern: '^[A-Za-z0-9]{14}$', checksum: 'ni_ruc',
    canonicalForm: 'alphanumeric', appliesTo: 'both', requirement: 'required',
    usedFor: ['invoicing', 'registration'], isDefault: true,
    issuingAuthority: 'DGI', sortOrder: 20,
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

/**
 * The stored form of a document value.
 *
 * Lives here — rather than in `IdentityDocumentService` — so the synchronous `canonicalizeTaxId`
 * below can share it without importing an injectable. Removes only what an authority prints as
 * decoration and upper-cases; nothing that carries information is removed. Applying
 * `replace(/[^\d]/g, '')` to every country once turned a Mexican RFC into its date of incorporation
 * and made a `J-` company and a `V-` person the same stored Venezuelan value.
 */
export function canonicalize(form: string, value: string): string {
  switch (form) {
    case 'digits':
      return value.replace(/\D/g, '');
    case 'segmented':
      return value
        .toUpperCase()
        .split('-')
        .map((segment) => segment.replace(/[^0-9A-Z]/g, ''))
        .filter(Boolean)
        .join('-');
    case 'alphanumeric':
    default:
      return value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '');
  }
}

// ── The tenant's fiscal identifier and its validation, as data ─────────────────────────────────
//
// These replace `TAX_ID_RULES` from `tax-id-validators.ts` — a `Record<país>` a new market could
// only join by a code change. They read the SAME catalogue Sales, Purchasing and HR validate
// against, so a country's registration identifier is declared once, as a row, and opening the
// twentieth market is an INSERT. `IdentityDocumentService.resolveParty` is the async, DB-backed
// path those modules use; these are the synchronous, in-memory path the registration boundary
// validator needs — it must fail closed with no query and therefore cannot await the database.

const upperCountry = (countryCode: string): string => (countryCode ?? '').trim().toUpperCase();

/** The documents a country asks for at registration — its fiscal identifiers. */
function registrationDocsFor(country: string): IdentityDocumentTypeSpec[] {
  return IDENTITY_DOCUMENT_TYPES.filter(
    (entry) => entry.countryCode === country && entry.usedFor.includes('registration'),
  );
}

/** Whether a document identifies the given taxpayer kind; `both` satisfies either. */
function documentServesKind(appliesTo: DocumentAppliesTo, kind: TaxpayerKind): boolean {
  return appliesTo === 'both' || appliesTo === kind;
}

/** A document's own rule: pattern, then the kind-specific checksum when known, else the base one. */
function documentAccepts(
  spec: IdentityDocumentTypeSpec,
  value: string,
  kind?: TaxpayerKind,
): boolean {
  if (!new RegExp(spec.pattern).test(value)) return false;
  const checksumName = (kind && spec.kindChecksums?.[kind]) || spec.checksum;
  if (!checksumName) return true; // the pattern is the whole check — a passport, an unconfirmed rule
  const algorithm = resolveChecksum(checksumName);
  // An unresolved name is a seeding bug; fail closed rather than silently drop to pattern-only.
  return algorithm ? algorithm(value) : false;
}

/**
 * Validate a fiscal identifier for a country, optionally narrowed to a taxpayer kind.
 *
 * Valid when it passes the rule of ANY registration document the country issues for that kind — an
 * RNC for a Dominican company, a cédula for a person, either when the kind is unknown. Returns
 * false for a country with no registration document, exactly as the retired map returned false for
 * a country it had no entry for.
 */
export function validateTaxId(countryCode: string, taxId: string, kind?: TaxpayerKind): boolean {
  const raw = taxId?.trim();
  if (!raw) return false;
  const docs = registrationDocsFor(upperCountry(countryCode));
  if (docs.length === 0) return false;
  const forKind = kind ? docs.filter((doc) => documentServesKind(doc.appliesTo, kind)) : docs;
  const pool = forKind.length > 0 ? forKind : docs;
  return pool.some((doc) => documentAccepts(doc, raw, kind));
}

/**
 * One declared spec by its natural key, considering supranational documents (a passport).
 *
 * The in-memory counterpart of `IdentityDocumentService.find` (which reads the database). Used
 * where a caller already holds `(country, code)` and only needs the declared label — a printed
 * document naming the buyer's identifier by its own name rather than the issuer's (M-07).
 */
export function findIdentityDocumentSpec(
  countryCode: string,
  code: string,
): IdentityDocumentTypeSpec | null {
  const country = upperCountry(countryCode);
  const wanted = (code ?? '').trim().toUpperCase();
  if (!wanted) return null;
  return (
    IDENTITY_DOCUMENT_TYPES.find((e) => e.countryCode === country && e.code === wanted) ??
    IDENTITY_DOCUMENT_TYPES.find(
      (e) => e.countryCode === SUPRANATIONAL_COUNTRY && e.code === wanted,
    ) ??
    null
  );
}

/** The country's default invoicing document that identifies the given taxpayer kind. */
function invoicingDocumentForKind(
  country: string,
  kind: TaxpayerKind,
): IdentityDocumentTypeSpec | null {
  const docs = IDENTITY_DOCUMENT_TYPES.filter(
    (entry) =>
      entry.countryCode === country &&
      entry.usedFor.includes('invoicing') &&
      documentServesKind(entry.appliesTo, kind),
  );
  return docs.find((doc) => doc.isDefault) ?? docs[0] ?? null;
}

/**
 * The buyer's document type as an e-invoicing `regime` names it — read from the catalogue, never
 * inferred from the number's length (A-02).
 *
 * A Brazilian CNPJ is `'CNPJ'` to the NF-e and a natural person `'CPF'`; a CUIT is `'80'` to AFIP
 * and a DNI `'96'`; a RUC is `'6'` to SUNAT and a DNI `'1'`. The builders used to reach these by
 * counting digits, which collides a mistyped number with a real one of another kind. This resolves
 * the party's recorded `(country, code)` to its `regimeCodes` entry; when the party carries no
 * document type but a taxpayer kind, it falls back to that kind's default invoicing document for the
 * country. Null when neither is known — the caller decides what an unidentified party is in its own
 * regime (AFIP `99` consumidor final, SUNAT `0`).
 */
export function regimeDocumentCode(
  regime: string,
  party: {
    countryCode?: string | null;
    code?: string | null;
    kind?: TaxpayerKind | null;
  },
): string | null {
  const country = upperCountry(party.countryCode ?? '');
  if (!country) return null;
  if (party.code) {
    const byCode = findIdentityDocumentSpec(country, party.code)?.regimeCodes?.[regime];
    if (byCode) return byCode;
  }
  if (party.kind) {
    const byKind = invoicingDocumentForKind(country, party.kind)?.regimeCodes?.[regime];
    if (byKind) return byKind;
  }
  return null;
}

/**
 * The document that IS the tenant's fiscal identifier: the default company/both registration one.
 */
export function fiscalIdentifierFor(countryCode: string): IdentityDocumentTypeSpec | null {
  const docs = registrationDocsFor(upperCountry(countryCode)).filter(
    (doc) => doc.appliesTo === 'company' || doc.appliesTo === 'both',
  );
  return docs.find((doc) => doc.isDefault) ?? docs[0] ?? null;
}

/**
 * The canonical stored form of a country's fiscal identifier.
 *
 * Throws for a country with no registration document rather than inventing a form — silently
 * guessing one is how the destructive global digit-strip survived as long as it did.
 */
export function canonicalizeTaxId(countryCode: string, taxId: string): string {
  const spec = fiscalIdentifierFor(countryCode);
  if (!spec) {
    throw new Error(`No canonical tax-id form is defined for country "${countryCode}".`);
  }
  return canonicalize(spec.canonicalForm, taxId.trim());
}

/**
 * The tenant's fiscal-identifier label, for an error message or a form.
 *
 * The authority's own term — RNC, RUC, CNPJ — which is `labelVerbatim` and stays untranslated
 * (M-08). Falls back to the code, then to a neutral `'ID'` for a country with none.
 */
export function fiscalIdentifierLabel(countryCode: string): string {
  const spec = fiscalIdentifierFor(countryCode);
  return spec?.labelVerbatim ?? spec?.code ?? 'ID';
}

/**
 * Whether the signup form must ask company-versus-natural-person for this country.
 *
 * True when the country issues DISTINCT registration documents to each kind (a Dominican RNC and
 * cédula, a US EIN and SSN) or a single one whose check refines by kind (an RFC, a CUIT). Read off
 * the catalogue, so it stays correct by construction as rows change.
 */
export function taxpayerKindAffectsValidation(countryCode: string): boolean {
  const docs = registrationDocsFor(upperCountry(countryCode));
  const hasIndividual = docs.some((doc) => doc.appliesTo === 'individual');
  const hasCompany = docs.some((doc) => doc.appliesTo === 'company');
  const hasKindChecksum = docs.some((doc) => Boolean(doc.kindChecksums));
  return (hasIndividual && hasCompany) || hasKindChecksum;
}

/** True when the country has a registration document at all — i.e. the product can be sold there. */
export function isSupportedFiscalCountry(countryCode: string): boolean {
  return registrationDocsFor(upperCountry(countryCode)).length > 0;
}

/**
 * Validator-only view keyed by the markets that have a registration document. Derived from the
 * catalogue, never restated — the coverage test asserts these keys equal the shipped markets.
 */
export const TAX_ID_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = Object.freeze(
  Object.fromEntries(
    COUNTRY_FISCAL_PROFILES.filter((profile) => isSupportedFiscalCountry(profile.countryCode)).map(
      (profile) => [
        profile.countryCode,
        (value: string): boolean => validateTaxId(profile.countryCode, value),
      ],
    ),
  ),
);

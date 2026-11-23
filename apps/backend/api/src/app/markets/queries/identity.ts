import {
  ChecksumAlgorithm,
  DocumentAppliesTo,
  FiscalFieldOption,
  FiscalFieldSpec,
  IdentityDocumentTypeSpec,
  TaxpayerKind,
  TaxpayerKindValue,
} from '../contracts';
import { SUPRANATIONAL_COUNTRY, SUPRANATIONAL_DOCUMENTS } from '../kit/identity';
import { allMarkets, knownMarket, normalizeMarketCode } from '../registry';

/**
 * Identity documents across the catalogue: which a market issues, how a value is checked and
 * stored, and what a market asks a taxpayer at registration.
 *
 * Every answer is read from the markets' own `identity.ts`. Nothing here names a country: a market
 * added to the catalogue is validated, canonicalised and offered by the same code as every other.
 */

/**
 * The supranational documents, carrying the code each market's regime gives them. A passport is
 * `06` to one authority and `41` to another; the passport names neither, the markets do.
 */
function supranationalDocuments(): IdentityDocumentTypeSpec[] {
  return SUPRANATIONAL_DOCUMENTS.map((document) => {
    const regimeCodes: Record<string, string> = {};
    for (const market of allMarkets()) {
      Object.assign(regimeCodes, market.identity.supranationalRegimeCodes[document.code] ?? {});
    }
    return Object.keys(regimeCodes).length > 0 ? { ...document, regimeCodes } : { ...document };
  });
}

/** Every identity document type, the markets' own and the supranational ones, as the catalogue seeds them. */
export const IDENTITY_DOCUMENT_TYPES: readonly IdentityDocumentTypeSpec[] = Object.freeze([
  ...allMarkets().flatMap((market) =>
    market.identity.documents.map((document): IdentityDocumentTypeSpec => ({ countryCode: market.code, ...document })),
  ),
  ...supranationalDocuments(),
]);

/**
 * Every check a document may cite, by name. Names are persisted in
 * `identity_document_types.checksum`; `market-catalogue.spec.ts` asserts that every name a document
 * cites resolves here and that no two markets declare the same name.
 */
export const CHECKSUM_ALGORITHMS: Readonly<Record<string, ChecksumAlgorithm>> = Object.freeze(
  Object.assign({}, ...allMarkets().map((market) => market.identity.checksums)),
);

/** Every name the catalogue may cite. */
export const CHECKSUM_ALGORITHM_NAMES: readonly string[] = Object.freeze(Object.keys(CHECKSUM_ALGORITHMS));

/**
 * The registered checks that test structure only, not a check digit. The signup told a US company
 * "we verify the check digit" because its EIN row names a check; the EIN has no check digit. A form
 * may only claim what is actually checked.
 */
export const STRUCTURAL_CHECKS: ReadonlySet<string> = new Set(allMarkets().flatMap((market) => market.identity.structuralChecks));

/**
 * A check by name. Null for an unknown name, and the caller decides what that means: a document
 * citing a check that does not exist is a seeding defect, and accepting the value would silently
 * downgrade the check to its pattern.
 */
export function resolveChecksum(name: string | null | undefined): ChecksumAlgorithm | null {
  if (!name) return null;
  return CHECKSUM_ALGORITHMS[name] ?? null;
}

/**
 * Every document a country can offer: its own, plus the supranational ones. Used by the seeder and by
 * tests; runtime resolution goes through `identity_document_types`, so an operator who inserts a row
 * does not have to redeploy for it to appear.
 */
export function catalogueForCountry(countryCode: string): IdentityDocumentTypeSpec[] {
  const country = normalizeMarketCode(countryCode);
  return IDENTITY_DOCUMENT_TYPES.filter(
    (entry) => entry.countryCode === country || entry.countryCode === SUPRANATIONAL_COUNTRY,
  ).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** The markets that must have at least one document: every market the product is sold in. */
export const MARKETS_REQUIRING_DOCUMENTS: readonly string[] = Object.freeze(allMarkets().map((market) => market.code));

/**
 * The stored form of a document value. Removes only what an authority prints as decoration and
 * upper-cases; nothing that carries information is removed. Stripping every non-digit once turned a
 * Mexican RFC into its date of incorporation and made a `J-` company and a `V-` person the same value.
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

/** The documents a country asks for at registration — its fiscal identifiers. */
function registrationDocsFor(country: string): IdentityDocumentTypeSpec[] {
  return IDENTITY_DOCUMENT_TYPES.filter(
    (entry) => entry.countryCode === country && entry.usedFor.includes('registration'),
  );
}

/**
 * The identifiers a taxpayer of this country can file under, as printed on their documents — the
 * authority's own label and a placeholder-shaped example. What a supplier's bill shows as its
 * issuer's identifier, so a reader knows what to look for.
 */
export function registrationDocumentsFor(countryCode: string): Array<{ label: string; example: string | null }> {
  return registrationDocsFor(normalizeMarketCode(countryCode))
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((doc) => ({ label: doc.labelVerbatim ?? doc.code, example: doc.example ?? null }));
}

/** Whether a document identifies the given taxpayer kind; `both` satisfies either. */
function documentServesKind(appliesTo: DocumentAppliesTo, kind: TaxpayerKindValue): boolean {
  return appliesTo === 'both' || appliesTo === kind;
}

/** A document's own rule: pattern, then the kind-specific check when known, else the base one. */
function documentAccepts(spec: IdentityDocumentTypeSpec, value: string, kind?: TaxpayerKindValue): boolean {
  if (!new RegExp(spec.pattern).test(value)) return false;
  const checksumName = (kind && spec.kindChecksums?.[kind]) || spec.checksum;
  if (!checksumName) return true; // the pattern is the whole check — a passport, an unconfirmed rule
  const algorithm = resolveChecksum(checksumName);
  // An unresolved name is a seeding defect; fail closed rather than silently drop to pattern-only.
  return algorithm ? algorithm(value) : false;
}

/**
 * Validate a fiscal identifier for a country, optionally narrowed to a taxpayer kind.
 *
 * Valid when it passes the rule of ANY registration document the country issues for that kind.
 * False for a country with no registration document.
 */
export function validateTaxId(countryCode: string, taxId: string, kind?: TaxpayerKindValue): boolean {
  const raw = taxId?.trim();
  if (!raw) return false;
  const docs = registrationDocsFor(normalizeMarketCode(countryCode));
  if (docs.length === 0) return false;
  const forKind = kind ? docs.filter((doc) => documentServesKind(doc.appliesTo, kind)) : docs;
  const pool = forKind.length > 0 ? forKind : docs;
  return pool.some((doc) => documentAccepts(doc, raw, kind));
}

/** One declared document by its natural key, considering the supranational ones (a passport). */
export function findIdentityDocumentSpec(countryCode: string, code: string): IdentityDocumentTypeSpec | null {
  const country = normalizeMarketCode(countryCode);
  const wanted = (code ?? '').trim().toUpperCase();
  if (!wanted) return null;
  return (
    IDENTITY_DOCUMENT_TYPES.find((e) => e.countryCode === country && e.code === wanted) ??
    IDENTITY_DOCUMENT_TYPES.find((e) => e.countryCode === SUPRANATIONAL_COUNTRY && e.code === wanted) ??
    null
  );
}

/** The country's default invoicing document that identifies the given taxpayer kind. */
function invoicingDocumentForKind(country: string, kind: TaxpayerKindValue): IdentityDocumentTypeSpec | null {
  const docs = IDENTITY_DOCUMENT_TYPES.filter(
    (entry) =>
      entry.countryCode === country && entry.usedFor.includes('invoicing') && documentServesKind(entry.appliesTo, kind),
  );
  return docs.find((doc) => doc.isDefault) ?? docs[0] ?? null;
}

/**
 * The buyer's document type as an e-invoicing `regime` names it — read from the catalogue, never
 * inferred from the number's length. Resolves the party's recorded `(country, code)`; when the party
 * carries no document type but a taxpayer kind, that kind's default invoicing document. Null when
 * neither is known: the caller decides what an unidentified party is in its own regime.
 */
export function regimeDocumentCode(
  regime: string,
  party: { countryCode?: string | null; code?: string | null; kind?: TaxpayerKindValue | null },
): string | null {
  const country = normalizeMarketCode(party.countryCode ?? '');
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

/** The document that IS the tenant's fiscal identifier: the default company/both registration one. */
export function fiscalIdentifierFor(countryCode: string): IdentityDocumentTypeSpec | null {
  const docs = registrationDocsFor(normalizeMarketCode(countryCode)).filter(
    (doc) => doc.appliesTo === 'company' || doc.appliesTo === 'both',
  );
  return docs.find((doc) => doc.isDefault) ?? docs[0] ?? null;
}

/**
 * The canonical stored form of a country's fiscal identifier. Throws for a country with no
 * registration document rather than inventing a form.
 */
export function canonicalizeTaxId(countryCode: string, taxId: string): string {
  const spec = fiscalIdentifierFor(countryCode);
  if (!spec) {
    throw new Error(`No canonical tax-id form is defined for country "${countryCode}".`);
  }
  return canonicalize(spec.canonicalForm, taxId.trim());
}

/** The tenant's fiscal-identifier label: the authority's own term, untranslated. */
export function fiscalIdentifierLabel(countryCode: string): string {
  const spec = fiscalIdentifierFor(countryCode);
  return spec?.labelVerbatim ?? spec?.code ?? 'ID';
}

/** The name of the document that identifies a taxpayer of this kind in this country, as the authority writes it. */
export function identityDocumentLabel(countryCode: string, kind: TaxpayerKindValue): string {
  const country = normalizeMarketCode(countryCode);
  if (kind === TaxpayerKind.COMPANY) return fiscalIdentifierLabel(country);
  const docs = registrationDocsFor(country).filter((doc) => documentServesKind(doc.appliesTo, kind));
  const spec = docs.find((doc) => doc.isDefault) ?? docs[0] ?? invoicingDocumentForKind(country, kind);
  return spec?.labelVerbatim ?? spec?.code ?? 'ID';
}

/**
 * Whether the signup form must ask company-versus-natural-person for this country: it issues distinct
 * registration documents to each kind, or a single one whose check refines by kind.
 */
export function taxpayerKindAffectsValidation(countryCode: string): boolean {
  const docs = registrationDocsFor(normalizeMarketCode(countryCode));
  const hasIndividual = docs.some((doc) => doc.appliesTo === 'individual');
  const hasCompany = docs.some((doc) => doc.appliesTo === 'company');
  const hasKindChecksum = docs.some((doc) => Boolean(doc.kindChecksums));
  return (hasIndividual && hasCompany) || hasKindChecksum;
}

/** True when the country has a registration document at all — i.e. the product can be sold there. */
export function isSupportedFiscalCountry(countryCode: string): boolean {
  return registrationDocsFor(normalizeMarketCode(countryCode)).length > 0;
}

/** A validator per market that has a registration document, derived from the catalogue. */
export const TAX_ID_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = Object.freeze(
  Object.fromEntries(
    allMarkets()
      .filter((market) => isSupportedFiscalCountry(market.code))
      .map((market) => [market.code, (value: string): boolean => validateTaxId(market.code, value)]),
  ),
);

// ── Registration data the authority requires ───────────────────────────────────────────────────

/** The fiscal fields that apply to one country and one kind of taxpayer. */
export function fiscalFieldsFor(countryCode: string, kind?: TaxpayerKindValue): readonly FiscalFieldSpec[] {
  const fields = knownMarket(countryCode)?.identity.fiscalFields ?? [];
  return fields.filter((field) => !field.appliesTo || !kind || field.appliesTo.includes(kind));
}

/** The options of a select field that apply to one kind of taxpayer. */
export function fiscalFieldOptionsFor(field: FiscalFieldSpec, kind?: TaxpayerKindValue): readonly FiscalFieldOption[] {
  if (!field.options) return [];
  return field.options.filter((option) => !option.appliesTo || !kind || option.appliesTo.includes(kind));
}

/** One rejected fiscal field, in a shape the API can turn into a validation message. */
export interface FiscalFieldError {
  key: string;
  label: string;
  reason: 'required' | 'unknown_option' | 'bad_format' | 'unexpected';
}

/**
 * Check a country's fiscal answers. Total and synchronous, like the identifier checks: a rule that
 * can pass because a lookup returned nothing is not a rule. Unknown keys are rejected rather than
 * ignored, so a client cannot smuggle arbitrary data into `organizations.fiscal_profile`.
 */
export function validateFiscalFields(
  countryCode: string,
  kind: TaxpayerKindValue | undefined,
  values: Readonly<Record<string, unknown>> = {},
): FiscalFieldError[] {
  return validateFiscalValues(fiscalFieldsFor(countryCode, kind), kind, values);
}

/**
 * The same check over any set of fiscal fields a market declares — the registration data an
 * authority requires, and what it asks of a purchase (`MarketPurchases.fiscalAttributes`). One
 * validator, so a market that adds a field gets it checked wherever the field is answered.
 */
export function validateFiscalValues(
  expected: readonly FiscalFieldSpec[],
  kind: TaxpayerKindValue | undefined,
  values: Readonly<Record<string, unknown>> = {},
): FiscalFieldError[] {
  const errors: FiscalFieldError[] = [];
  const known = new Set(expected.map((field) => field.key));

  for (const key of Object.keys(values)) {
    if (!known.has(key)) {
      errors.push({ key, label: key, reason: 'unexpected' });
    }
  }

  for (const field of expected) {
    const raw = values[field.key];

    // A multi-valued field accepts an array or a comma-separated string, and every entry has to be a
    // published code — a list where one member is wrong produces a document the authority rejects.
    if (field.multiple) {
      const selected = parseMultiValue(raw);
      if (selected.length === 0) {
        if (field.required) errors.push({ key: field.key, label: field.label, reason: 'required' });
        continue;
      }
      const allowed = fiscalFieldOptionsFor(field, kind);
      const unknown = selected.some((code) => !allowed.some((option) => option.code === code));
      if (unknown) {
        errors.push({ key: field.key, label: field.label, reason: 'unknown_option' });
      }
      continue;
    }

    const value = typeof raw === 'string' ? raw.trim() : '';

    if (!value) {
      if (field.required) errors.push({ key: field.key, label: field.label, reason: 'required' });
      continue;
    }

    if (field.type === 'select') {
      const allowed = fiscalFieldOptionsFor(field, kind);
      if (!allowed.some((option) => option.code === value)) {
        errors.push({ key: field.key, label: field.label, reason: 'unknown_option' });
      }
      continue;
    }

    if (field.pattern && !new RegExp(`^(?:${field.pattern.replace(/^\^|\$$/g, '')})$`).test(value)) {
      errors.push({ key: field.key, label: field.label, reason: 'bad_format' });
    }
  }

  return errors;
}

/** Keep only the answers the country actually asks for, trimmed. Never store what was not asked. */
export function normalizeFiscalFields(
  countryCode: string,
  kind: TaxpayerKindValue | undefined,
  values: Readonly<Record<string, unknown>> = {},
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const field of fiscalFieldsFor(countryCode, kind)) {
    const raw = values[field.key];
    if (field.multiple) {
      const selected = parseMultiValue(raw);
      // Stored comma-separated, de-duplicated and in a stable order, so two tenants that chose the
      // same answers in a different order hold the same value.
      if (selected.length) result[field.key] = [...new Set(selected)].sort().join(',');
      continue;
    }
    if (typeof raw === 'string' && raw.trim()) result[field.key] = raw.trim();
  }
  return result;
}

/** A multi-valued answer from whatever shape it arrived in: an array (a form), a comma list (a row). */
function parseMultiValue(raw: unknown): string[] {
  const parts = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return parts.map((part) => (typeof part === 'string' ? part.trim() : '')).filter((part) => part.length > 0);
}

import {
  isValidArgentineCuit,
  isValidArgentineCuitCompany,
  isValidArgentineCuitIndividual,
  isValidBolivianNit,
  isValidBrazilianCnpj,
  isValidBrazilianCpf,
  isValidChileanRut,
  isValidColombianNit,
  isValidCostaRicanId,
  isValidDominicanTaxId,
  isValidEcuadorianRuc,
  isValidEcuadorianRucCompany,
  isValidEcuadorianRucIndividual,
  isValidGuatemalanNit,
  isValidHonduranRtn,
  isValidMexicanRfc,
  isValidNicaraguanRuc,
  isValidPanamanianRuc,
  isValidParaguayanRuc,
  isValidPeruvianRuc,
  isValidPeruvianRucCompany,
  isValidPeruvianRucIndividual,
  isValidSalvadoranNit,
  isValidUruguayanRut,
  isValidUsEinStrict,
  isValidUsSsnOrItin,
  isValidVenezuelanRif,
  isValidVenezuelanRifCompany,
  isValidVenezuelanRifIndividual,
} from './tax-id-validators';

/**
 * Check-digit algorithms, addressable by name.
 *
 * ## Why a registry and not a `switch`
 *
 * A catalogue row can carry a regular expression, but it cannot carry an algorithm: a modulus-11
 * sum with country-specific weights and a country-specific remainder map does not fit in a
 * database column. Writing the algorithm into a `switch (documentType)` is what the previous HCM
 * validator did, and it is precisely what made adding a country a code change.
 *
 * The resolution is to put the algorithm's NAME in the row and its implementation here. A country
 * that reuses an algorithm another country already has — a Chilean RUN is checked exactly like a
 * Chilean RUT, a Dominican cédula exactly like any other Luhn identifier — costs a row and no
 * code. Only a genuinely new algorithm touches code, and it touches this one file.
 *
 * ## Names are contract
 *
 * The keys below are persisted in `identity_document_types.checksum`. Renaming one orphans every
 * row that references it, so `identity-document-catalogue.spec.ts` asserts that every name a
 * catalogue entry cites resolves here. Treat them as you would a database column name.
 *
 * ## Total, never throwing
 *
 * Every function takes any string and returns a boolean, matching the contract the underlying
 * validators in `tax-id-validators.ts` already keep. A validator that throws on malformed input
 * turns a rejected form field into a 500.
 */
export type ChecksumAlgorithm = (value: string) => boolean;

/** Digits only, for the length-restricted variants below. */
const digits = (value: string): string => value.replace(/\D/g, '');

/**
 * The Dominican identifier is one algorithm over two lengths — 9 digits weighted mod-11 for an
 * RNC, 11 digits Luhn for a cédula — and `isValidDominicanTaxId` dispatches on length internally.
 * The catalogue needs them apart, because a cédula in the RNC field is an error even though the
 * combined function accepts both.
 */
const dominicanOfLength = (length: number): ChecksumAlgorithm =>
  (value) => digits(value).length === length && isValidDominicanTaxId(value);

/**
 * The Mexican RFC is 12 characters for a persona moral and 13 for a persona física; the check
 * pair is computed the same way for both. Same reasoning as the Dominican split above.
 */
const mexicanRfcOfLength = (length: number): ChecksumAlgorithm =>
  (value) =>
    value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '').length === length && isValidMexicanRfc(value);

/** Costa Rica: cédula jurídica is 10 digits, cédula física 9. One algorithm, two lengths. */
const costaRicanOfLength = (length: number): ChecksumAlgorithm =>
  (value) => digits(value).length === length && isValidCostaRicanId(value);

export const CHECKSUM_ALGORITHMS: Readonly<Record<string, ChecksumAlgorithm>> = Object.freeze({
  // ── Dominican Republic ────────────────────────────────────────────────────
  do_rnc_mod11: dominicanOfLength(9),
  do_cedula_luhn10: dominicanOfLength(11),

  // ── United States ─────────────────────────────────────────────────────────
  // The EIN has no check digit; the IRS-assigned prefix set is the only structural signal there
  // is, and rejecting an unassigned prefix catches the typo cases without claiming more.
  us_ein_prefix: isValidUsEinStrict,
  us_ssn_itin: isValidUsSsnOrItin,

  // ── Mexico ────────────────────────────────────────────────────────────────
  mx_rfc: isValidMexicanRfc,
  mx_rfc_company: mexicanRfcOfLength(12),
  mx_rfc_individual: mexicanRfcOfLength(13),

  // ── South and Central America ─────────────────────────────────────────────
  co_nit_mod11: isValidColombianNit,
  cl_rut_mod11: isValidChileanRut,
  ar_cuit_mod11: isValidArgentineCuit,
  br_cpf: isValidBrazilianCpf,
  br_cnpj: isValidBrazilianCnpj,
  pe_ruc_mod11: isValidPeruvianRuc,
  ec_ruc: isValidEcuadorianRuc,

  // Kind-refined variants. Where one identifier distinguishes a company from a natural person by
  // its prefix, third digit or type letter, the catalogue row cites these through `kindChecksums`
  // so the check narrows to the declared kind — the strength `byPrefix()` used to add, now data.
  ar_cuit_company: isValidArgentineCuitCompany,
  ar_cuit_individual: isValidArgentineCuitIndividual,
  pe_ruc_company: isValidPeruvianRucCompany,
  pe_ruc_individual: isValidPeruvianRucIndividual,
  ec_ruc_company: isValidEcuadorianRucCompany,
  ec_ruc_individual: isValidEcuadorianRucIndividual,
  ve_rif_company: isValidVenezuelanRifCompany,
  ve_rif_individual: isValidVenezuelanRifIndividual,
  uy_rut_mod11: isValidUruguayanRut,
  py_ruc_mod11: isValidParaguayanRuc,
  ve_rif_mod11: isValidVenezuelanRif,
  gt_nit_mod11: isValidGuatemalanNit,
  pa_ruc: isValidPanamanianRuc,
  cr_cedula_juridica: costaRicanOfLength(10),
  cr_cedula_fisica: costaRicanOfLength(9),
  bo_nit: isValidBolivianNit,
  sv_nit: isValidSalvadoranNit,
  hn_rtn: isValidHonduranRtn,
  ni_ruc: isValidNicaraguanRuc,
});

/** Every name the catalogue may cite. Exported so a test can assert the two lists agree. */
export const CHECKSUM_ALGORITHM_NAMES: readonly string[] = Object.freeze(
  Object.keys(CHECKSUM_ALGORITHMS),
);

/**
 * Resolve a checksum by name.
 *
 * Returns `null` for an unknown name rather than throwing, and the CALLER decides what that means.
 * `validateIdentityDocument` treats it as a hard failure — a row citing an algorithm that does not
 * exist is a seeding bug, and accepting the value would silently downgrade the check to the regex
 * alone, which is the failure mode this whole refactor exists to remove.
 */
export function resolveChecksum(name: string | null | undefined): ChecksumAlgorithm | null {
  if (!name) return null;
  return CHECKSUM_ALGORITHMS[name] ?? null;
}

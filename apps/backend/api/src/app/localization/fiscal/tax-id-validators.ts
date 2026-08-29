/**
 * Tax-identifier validation, per country, by algorithm.
 *
 * Nearly every fiscal identifier in Latin America carries a check digit. Validating with a regex
 * accepts roughly ten times more strings than are actually issuable — so a typo in an RFC, a NIT
 * or a RUT was stored as though it were real, and only surfaced later when an invoice was
 * rejected by the tax authority, or a reconciliation failed, or a return could not be filed.
 * For a product whose entire purpose is fiscal compliance, "looks about right" is not validation.
 *
 * Each function here implements the published check-digit rule for its country. They are pure and
 * total: any input, including nonsense, returns a boolean rather than throwing.
 *
 * What these functions do NOT do is confirm that an identifier is *registered*. That requires the
 * tax authority's own registry, which only some countries publish; where one exists it is reached
 * through a `FiscalRegistryLookup` and is always advisory, never a gate — a registry being down
 * must not stop a customer from signing up.
 */

/**
 * Strip formatting so validators see only the characters the algorithm operates on.
 *
 * Stripping is not the same as ignoring. A value containing letters is not a mis-formatted number,
 * it is a different string, and silently deleting the letters made `900123456K` validate as the
 * Colombian NIT `900123456` — a Chilean-style check character accepted by a country that never
 * issues one. `numericOnly` rejects such a value instead of quietly rewriting it; `digitsOnly` is
 * kept for the algorithms that legitimately operate on a mixed alphabet.
 */
const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/**
 * Digits with separators removed, or `null` when the input contains anything else.
 *
 * Only the separators a tax authority actually prints are allowed: space, hyphen, dot, slash and
 * the parentheses some registries use.
 */
const numericOnly = (value: string): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[0-9\s.\-/()]+$/.test(trimmed)) return null;
  return trimmed.replace(/\D/g, '');
};
const alphanumeric = (value: string): string => value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '');

/**
 * Weighted modulus-11 check digit, the family most of these identifiers belong to.
 *
 * @param body     Digits preceding the check digit.
 * @param weights  Multiplier per position, aligned to `body` from the left.
 * @param map      Turns the modulus into the expected check character. Countries differ here far
 *                 more than they do in the sum itself, which is why it is a parameter.
 */
function modulus11(
  body: string,
  weights: number[],
  map: (remainder: number) => string | null,
): string | null {
  if (body.length !== weights.length) return null;
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * weights[i];
  }
  return map(sum % 11);
}

/**
 * Luhn (modulus 10), used by Dominican cédulas among others.
 *
 * Doubling starts at the RIGHTMOST digit of the body and alternates leftwards. Starting from the
 * left and deriving the parity from the body's length gives the right answer only for
 * odd-length bodies, and silently the wrong one for even-length bodies — which is every
 * Dominican cédula.
 */
function luhnCheckDigit(body: string): string {
  let sum = 0;
  let double = true;
  for (let i = body.length - 1; i >= 0; i--) {
    let digit = Number(body[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

// ---------------------------------------------------------------------------------------------
// Dominican Republic — RNC (9 digits) and Cédula (11 digits), DGII
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// United States — EIN (9 digits), IRS
// ---------------------------------------------------------------------------------------------
/**
 * An EIN has no check digit, so the only structural signal is the two-digit prefix: the IRS
 * publishes the set it assigns, and the unassigned values are the ones a typo or a placeholder
 * produces. Rejecting them catches the common cases without pretending to more certainty than
 * the format allows.
 */
const IRS_ASSIGNED_PREFIXES = new Set([
  '01','02','03','04','05','06','10','11','12','13','14','15','16','20','21','22','23','24','25',
  '26','27','30','31','32','33','34','35','36','37','38','39','40','41','42','43','44','45','46',
  '47','48','50','51','52','53','54','55','56','57','58','59','60','61','62','63','64','65','66',
  '67','68','71','72','73','74','75','76','77','80','81','82','83','84','85','86','87','88','90',
  '91','92','93','94','95','98','99',
]);

export function isValidUsEin(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 9) return false;
  // 00-, 07-, 08-, 09-, 17-, 18-, 19-, 28-, 29-, 49-, 69-, 70-, 78-, 79-, 89-, 96-, 97- are unassigned.
  return IRS_ASSIGNED_PREFIXES.has(digits.slice(0, 2));
}

// ---------------------------------------------------------------------------------------------
// Mexico — RFC, SAT. 12 characters for a company, 13 for a person, last is a check digit.
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Colombia — NIT, DIAN. 9 digits plus a verification digit (DV).
// ---------------------------------------------------------------------------------------------
const NIT_WEIGHTS = [41, 37, 29, 23, 19, 17, 13, 7, 3];

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
  if (digits.length < 10 || digits.length > 11) return false;

  const body = digits.slice(0, -1);
  const provided = digits.slice(-1);
  if (body.length > NIT_WEIGHTS.length) return false;

  // Weights align to the RIGHT of the body.
  const weights = NIT_WEIGHTS.slice(NIT_WEIGHTS.length - body.length);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += Number(body[i]) * weights[i];

  const remainder = sum % 11;
  const expected = String(remainder > 1 ? 11 - remainder : remainder);

  return expected === provided;
}

// ---------------------------------------------------------------------------------------------
// Chile — RUT, SII. Body plus a check character that may be 'K'.
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Argentina — CUIT/CUIL, AFIP. 11 digits, modulus 11.
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Brazil — CNPJ, Receita Federal. 14 digits, two check digits.
// ---------------------------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------------------------
// Peru — RUC, SUNAT. 11 digits, modulus 11.
// ---------------------------------------------------------------------------------------------
export function isValidPeruvianRuc(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 11) return false;
  // 10 = natural person, 15/17 = legacy, 20 = company.
  if (!['10', '15', '17', '20'].includes(digits.slice(0, 2))) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(digits[i]) * weights[i];
  const remainder = 11 - (sum % 11);
  const expected = String(remainder === 10 ? 0 : remainder === 11 ? 1 : remainder);
  return expected === digits[10];
}

// ---------------------------------------------------------------------------------------------
// Ecuador — RUC, SRI. 13 digits; the rule depends on the third digit.
// ---------------------------------------------------------------------------------------------
export function isValidEcuadorianRuc(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;
  if (digits.length !== 13) return false;

  const province = Number(digits.slice(0, 2));
  if (province < 1 || province > 24) return false;
  if (!digits.endsWith('001')) return false;

  const thirdDigit = Number(digits[2]);

  // Natural person: modulus 10 over the first nine digits.
  if (thirdDigit < 6) {
    const weights = [2, 1, 2, 1, 2, 1, 2, 1];
    let sum = 0;
    for (let i = 0; i < 8; i++) {
      let product = Number(digits[i]) * weights[i];
      if (product > 9) product -= 9;
      sum += product;
    }
    const expected = (10 - (sum % 10)) % 10;
    return expected === Number(digits[8]);
  }

  // Public entity (6) and private company (9) use modulus 11 with different weights and lengths.
  const isPublic = thirdDigit === 6;
  const weights = isPublic ? [3, 2, 7, 6, 5, 4, 3, 2] : [4, 3, 2, 7, 6, 5, 4, 3, 2];
  const bodyLength = isPublic ? 8 : 9;
  let sum = 0;
  for (let i = 0; i < bodyLength; i++) sum += Number(digits[i]) * weights[i];
  const remainder = sum % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === Number(digits[bodyLength]);
}

// ---------------------------------------------------------------------------------------------
// Uruguay — RUT, DGI. 12 digits, modulus 11.
// ---------------------------------------------------------------------------------------------
export function isValidUruguayanRut(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null) return false;
  if (digits.length !== 12) return false;

  const weights = [4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 11; i++) sum += Number(digits[i]) * weights[i];
  const remainder = sum % 11;
  const expected = remainder === 0 ? 0 : 11 - remainder;
  return expected === Number(digits[11]);
}

// ---------------------------------------------------------------------------------------------
// Paraguay — RUC, SET. Body plus a check digit, modulus 11 base 11.
// ---------------------------------------------------------------------------------------------
export function isValidParaguayanRuc(value: string): boolean {
  const cleaned = numericOnly(value);
  if (cleaned === null) return false;
  if (cleaned.length < 6 || cleaned.length > 9) return false;

  const body = cleaned.slice(0, -1);
  const provided = Number(cleaned.slice(-1));

  let sum = 0;
  let weight = 2;
  for (let i = body.length - 1; i >= 0; i--) {
    sum += Number(body[i]) * weight;
    weight = weight === 11 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  const expected = remainder > 1 ? 11 - remainder : 0;
  return expected === provided;
}

// ---------------------------------------------------------------------------------------------
// Venezuela — RIF, SENIAT. A type letter plus 9 digits.
// ---------------------------------------------------------------------------------------------
const RIF_TYPE_WEIGHT: Record<string, number> = { V: 1, E: 2, J: 3, P: 4, G: 5 };

export function isValidVenezuelanRif(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[VEJPG]\d{9}$/.test(cleaned)) return false;

  const typeWeight = RIF_TYPE_WEIGHT[cleaned[0]];
  const digits = cleaned.slice(1);
  const weights = [4, 3, 2, 7, 6, 5, 4, 3];

  let sum = typeWeight * 4;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * weights[i];

  const remainder = 11 - (sum % 11);
  const expected = remainder >= 10 ? 0 : remainder;
  return expected === Number(digits[8]);
}

// ---------------------------------------------------------------------------------------------
// Guatemala — NIT, SAT. Body plus a check character that may be 'K'.
// ---------------------------------------------------------------------------------------------
export function isValidGuatemalanNit(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9K]/g, '');
  if (cleaned.length < 2 || cleaned.length > 13) return false;

  const body = cleaned.slice(0, -1);
  const provided = cleaned.slice(-1);
  if (!/^\d+$/.test(body)) return false;

  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    sum += Number(body[i]) * (body.length + 1 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  const expected = remainder === 10 ? 'K' : String(remainder);
  return expected === provided;
}

// ---------------------------------------------------------------------------------------------
// Countries whose identifier carries no check digit: validate structure only, and say so.
// ---------------------------------------------------------------------------------------------

/** Panama — RUC, DGI. Composite, hyphen-separated; no published check-digit rule. */
export function isValidPanamanianRuc(value: string): boolean {
  return /^\d{1,10}(-[A-Z0-9]{1,6}){1,4}$/i.test(value.trim());
}

/** Costa Rica — cédula jurídica (10) / física (9); structural only. */
export function isValidCostaRicanId(value: string): boolean {
  const digits = numericOnly(value);
  return digits !== null && digits.length >= 9 && digits.length <= 12;
}

/** Bolivia — NIT, SIN. 7–12 digits, no public check digit. */
export function isValidBolivianNit(value: string): boolean {
  const digits = numericOnly(value);
  return digits !== null && digits.length >= 7 && digits.length <= 12;
}

/** El Salvador — NIT, 14 digits, structural. */
export function isValidSalvadoranNit(value: string): boolean {
  return numericOnly(value)?.length === 14;
}

/** Honduras — RTN, 14 digits, structural. */
export function isValidHonduranRtn(value: string): boolean {
  return numericOnly(value)?.length === 14;
}

/** Nicaragua — RUC, 14 characters, structural. */
export function isValidNicaraguanRuc(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return cleaned.length === 14;
}

/**
 * Validator lookup by ISO 3166-1 alpha-2 country code.
 *
 * A country absent from this map has NO validator, and the registration strategy treats that as a
 * reason to refuse the signup rather than to accept anything. Accepting an unvalidated tax id in
 * a fiscal product means the first thing the customer discovers is that their invoices are
 * rejected.
 */
export const TAX_ID_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> = {
  DO: isValidDominicanTaxId,
  US: isValidUsEin,
  MX: isValidMexicanRfc,
  CO: isValidColombianNit,
  CL: isValidChileanRut,
  AR: isValidArgentineCuit,
  BR: isValidBrazilianCnpj,
  PE: isValidPeruvianRuc,
  EC: isValidEcuadorianRuc,
  UY: isValidUruguayanRut,
  PY: isValidParaguayanRuc,
  VE: isValidVenezuelanRif,
  GT: isValidGuatemalanNit,
  PA: isValidPanamanianRuc,
  CR: isValidCostaRicanId,
  BO: isValidBolivianNit,
  SV: isValidSalvadoranNit,
  HN: isValidHonduranRtn,
  NI: isValidNicaraguanRuc,
};

/** True when the country has a validator at all — i.e. the product can be sold there. */
export function isSupportedFiscalCountry(countryCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAX_ID_VALIDATORS, countryCode?.toUpperCase() ?? '');
}

/**
 * Validate a tax id for a country.
 *
 * Returns false for an unsupported country: there is no safe way to "probably" validate a fiscal
 * identifier, and a permissive default is what let six countries through with no checking at all.
 */
export function validateTaxId(countryCode: string, taxId: string): boolean {
  const validator = TAX_ID_VALIDATORS[countryCode?.toUpperCase() ?? ''];
  if (!validator) return false;
  return Boolean(taxId?.trim()) && validator(taxId.trim());
}

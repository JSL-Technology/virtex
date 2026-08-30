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
 * issues one. `numericOnly` rejects such a value instead of quietly rewriting it.
 */

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
// United States — EIN (companies) and SSN/ITIN (sole proprietors), IRS
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

/** Strict EIN check. Used when the caller knows the taxpayer is a company. */
export function isValidUsEinStrict(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 9) return false;
  // 00-, 07-, 08-, 09-, 17-, 18-, 19-, 28-, 29-, 49-, 69-, 70-, 78-, 79-, 89-, 96-, 97- are unassigned.
  return IRS_ASSIGNED_PREFIXES.has(digits.slice(0, 2));
}

/**
 * SSN (natural person) and ITIN (resident alien without an SSN).
 *
 * Both are nine digits in `AAA-GG-SSSS` form. The rules that make a value un-issuable are
 * published by the SSA and the IRS:
 *   - area 000, 666 and 900-999 are never issued as an SSN; 900-999 IS the ITIN range, so an
 *     ITIN is recognised by its area plus its group, which the IRS restricts to 50-65, 70-88,
 *     90-92 and 94-99;
 *   - group 00 and serial 0000 are never issued in either scheme.
 *
 * This matters commercially: a US sole proprietor files under an SSN or ITIN, not an EIN, and
 * they are a large share of the small-business market the product sells into.
 */
export function isValidUsSsnOrItin(value: string): boolean {
  const digits = numericOnly(value);
  if (digits === null || digits.length !== 9) return false;

  const area = Number(digits.slice(0, 3));
  const group = Number(digits.slice(3, 5));
  const serial = Number(digits.slice(5));

  if (group === 0 || serial === 0) return false;

  // ITIN: area 900-999 with an IRS-assigned group range.
  if (area >= 900 && area <= 999) {
    return (
      (group >= 50 && group <= 65) ||
      (group >= 70 && group <= 88) ||
      (group >= 90 && group <= 92) ||
      (group >= 94 && group <= 99)
    );
  }

  // SSN: any area except 000 and 666.
  return area !== 0 && area !== 666;
}

/**
 * A United States taxpayer identifier, of either kind.
 *
 * The country profile has always advertised `individualDocument: { code: 'SSN', label:
 * 'SSN / ITIN' }` and the comment beside it says rejecting that shape "would lock out a whole
 * class of customer" — and then `validateTaxId` only ever ran the company validator, so it locked
 * them out. Any SSN whose first two digits fall outside the IRS's EIN prefix list was refused:
 * `078-05-1120` among them.
 */
export function isValidUsTaxId(value: string): boolean {
  return isValidUsEinStrict(value) || isValidUsSsnOrItin(value);
}

/** @deprecated Use {@link isValidUsTaxId} for registration, or {@link isValidUsEinStrict} when the taxpayer is known to be a company. */
export const isValidUsEin = isValidUsEinStrict;

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
// Brazil — CPF (natural person), Receita Federal. 11 digits, two check digits.
// ---------------------------------------------------------------------------------------------
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

  // Provinces 1-24, plus 30 for Ecuadorians registered abroad. Rejecting 30 turned every RUC
  // issued to a non-resident taxpayer into a "bad check digit" error.
  const province = Number(digits.slice(0, 2));
  if ((province < 1 || province > 24) && province !== 30) return false;

  // The trailing three digits are the establishment code, and SRI's published rule for the RUC
  // itself is that they are 001: branch codes (002, 003…) belong to the `estab` field of an
  // electronic document, not to the taxpayer's RUC. Kept strict deliberately — for a fiscal
  // validator, widening acceptance on a rule that is not published is the wrong direction.
  if (!digits.endsWith('001')) return false;

  const thirdDigit = Number(digits[2]);

  // Natural person: the RUC is the 10-digit cédula plus the establishment code, so the cédula's
  // own check digit is the TENTH digit, computed over the first nine with coefficients
  // 2,1,2,1,2,1,2,1,2.
  //
  // This previously ran eight coefficients over the first eight digits and compared the result
  // against digits[8] — the ninth. Off by one in both the body and the target, so it rejected
  // every valid natural-person RUC in the country. `1710034065001` is a worked example: the
  // published rule yields check digit 5 and matches; the old code computed 8 against digits[8]=6.
  if (thirdDigit < 6) {
    const weights = [2, 1, 2, 1, 2, 1, 2, 1, 2];
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      let product = Number(digits[i]) * weights[i];
      if (product > 9) product -= 9;
      sum += product;
    }
    const expected = (10 - (sum % 10)) % 10;
    return expected === Number(digits[9]);
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

/**
 * SENIAT's weight series: 4 for the type letter, then 3,2,7,6,5,4,3,2 across the eight body
 * digits.
 *
 * The previous implementation shifted the series one position onto the digits — 4,3,2,7,6,5,4,3 —
 * so the first body digit was weighted 4 instead of 3 and every subsequent one was wrong too. It
 * rejected real RIFs: `J-00123072-6` (PDVSA) and `J-00002950-4` among them. The one value it
 * accepted was the example in the country profile, `J-30599168-5`, and that is a coincidence —
 * for those particular digits the difference between the two sums happens to be exactly 11, so
 * both series land on the same residue. The unit test used that same value, so the defect was
 * invisible from inside the suite.
 */
const RIF_DIGIT_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2];

export function isValidVenezuelanRif(value: string): boolean {
  const cleaned = value.toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (!/^[VEJPG]\d{9}$/.test(cleaned)) return false;

  const typeWeight = RIF_TYPE_WEIGHT[cleaned[0]];
  const digits = cleaned.slice(1);

  let sum = typeWeight * 4;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * RIF_DIGIT_WEIGHTS[i];

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

// ---------------------------------------------------------------------------------------------
// Canonical storage form
// ---------------------------------------------------------------------------------------------

/**
 * How a tax id is written to the database, per country.
 *
 * Registration used to store `taxId.replace(/[^\d]/g, '')` — every non-digit deleted, for every
 * country. That is not normalisation, it is destruction, and it broke six markets at once:
 *
 *   - Mexico    `DEM010203AB5` → `0102035`. The RFC's three or four leading letters encode the
 *               company name and the trailing two are its check pair; stripping them leaves the
 *               date of incorporation. Every Mexican company incorporated on the same day
 *               collapsed to the same stored value, and `organizations` carries a unique index on
 *               `(tax_id, fiscal_region_id)` — so the second one to sign up was rejected with a
 *               generic "no se pudo completar el registro", after paying.
 *   - Chile     `76.086.428-K` → `76086428`. The check character is lost, and a RUT ending in K
 *               becomes indistinguishable from a different RUT.
 *   - Venezuela `J-30599168-5` and `V-30599168-5` → the same digits. J is a company and V a
 *               natural person: two different taxpayers, one stored value.
 *   - Guatemala the K check character, as in Chile.
 *   - Nicaragua the leading letter of the RUC.
 *   - Panama    the segment structure of a composite RUC.
 *
 * Canonicalising means removing only what a tax authority prints as decoration — spaces, dots,
 * slashes, parentheses, and hyphens where the hyphen is a separator rather than structure — and
 * upper-casing. Nothing that carries information is removed. The result is what the unique index
 * compares and what an electronic invoice will later have to reproduce.
 */
type Canonicalizer = (value: string) => string;

/** Digits only. For identifiers that are purely numeric once formatting is removed. */
const canonicalDigits: Canonicalizer = (value) => value.replace(/\D/g, '');

/** Letters and digits, upper-cased. Preserves RFC letters, RUT/NIT `K`, RIF and RUC prefixes. */
const canonicalAlphanumeric: Canonicalizer = (value) =>
  value.toUpperCase().replace(/[^0-9A-ZÑ&]/g, '');

/**
 * Upper-cased alphanumeric segments joined by hyphens.
 *
 * Panama's RUC is genuinely composite (`15512345-2-2018`): the hyphens separate meaningful fields
 * rather than grouping digits, so collapsing them would merge distinct identifiers.
 */
const canonicalSegmented: Canonicalizer = (value) =>
  value
    .toUpperCase()
    .split('-')
    .map((segment) => segment.replace(/[^0-9A-Z]/g, ''))
    .filter(Boolean)
    .join('-');

/**
 * Whether the taxpayer is a legal entity or a natural person.
 *
 * Several countries issue a *different identifier* to each — the United States an EIN versus an
 * SSN/ITIN, Brazil a CNPJ versus a CPF, the Dominican Republic an RNC versus a cédula — and
 * several more encode the distinction inside one identifier: a Mexican RFC is twelve characters
 * for a company and thirteen for a person, an Argentine CUIT starts 30/33/34 versus 20/23/24/27,
 * a Peruvian RUC starts 20 versus 10, a Venezuelan RIF starts J/G/P versus V/E.
 *
 * Without it the validator has to accept the union of both schemes, which is materially weaker.
 * A nine-digit United States number is a valid EIN under prefix 66 *and* an un-issuable SSN under
 * area 666; asked to judge it with no context, the only safe answer is "accepted", and a typo
 * gets through. Knowing the kind is what makes the check meaningful, and every regime the product
 * targets requires the distinction on the invoice anyway.
 */
export enum TaxpayerKind {
  COMPANY = 'company',
  INDIVIDUAL = 'individual',
}

interface TaxIdRules {
  /** `kind` is optional so callers that genuinely cannot know accept either scheme. */
  validate: (value: string, kind?: TaxpayerKind) => boolean;
  canonicalize: Canonicalizer;
  /**
   * True when the country's identifier — or the pair of identifiers — differs by taxpayer kind,
   * so the signup form knows to ask. Where the same identifier serves both (a Colombian NIT, a
   * Chilean RUT), asking would be noise.
   */
  kindAffectsValidation: boolean;
}

/** Restrict a shared validator to one shape, then defer to the country's own arithmetic. */
const byLength = (
  validate: (value: string) => boolean,
  normalise: (value: string) => string,
  companyLength: number,
  individualLength: number,
) => (value: string, kind?: TaxpayerKind): boolean => {
  const length = normalise(value).length;
  if (kind === TaxpayerKind.COMPANY && length !== companyLength) return false;
  if (kind === TaxpayerKind.INDIVIDUAL && length !== individualLength) return false;
  return validate(value);
};

/** Restrict a shared validator to the prefixes the country assigns to one kind. */
const byPrefix = (
  validate: (value: string) => boolean,
  companyPrefixes: readonly string[],
  individualPrefixes: readonly string[],
) => (value: string, kind?: TaxpayerKind): boolean => {
  if (!validate(value)) return false;
  const prefix = (numericOnly(value) ?? '').slice(0, 2);
  if (kind === TaxpayerKind.COMPANY) return companyPrefixes.includes(prefix);
  if (kind === TaxpayerKind.INDIVIDUAL) return individualPrefixes.includes(prefix);
  return true;
};

/**
 * Validation and canonical form, per ISO 3166-1 alpha-2 country code.
 *
 * A country absent from this map has NO validator, and the registration strategy treats that as a
 * reason to refuse the signup rather than to accept anything. Accepting an unvalidated tax id in
 * a fiscal product means the first thing the customer discovers is that their invoices are
 * rejected.
 */
export const TAX_ID_RULES: Readonly<Record<string, TaxIdRules>> = {
  // RNC (9 digits) for a company, cédula (11) for a natural person.
  DO: {
    validate: byLength(isValidDominicanTaxId, (v) => numericOnly(v) ?? '', 9, 11),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  // EIN for a company, SSN or ITIN for a sole proprietor. Two separate schemes.
  US: {
    validate: (value, kind) =>
      kind === TaxpayerKind.COMPANY
        ? isValidUsEinStrict(value)
        : kind === TaxpayerKind.INDIVIDUAL
          ? isValidUsSsnOrItin(value)
          : isValidUsTaxId(value),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  // RFC: 12 characters for a persona moral, 13 for a persona física.
  MX: {
    validate: byLength(isValidMexicanRfc, alphanumeric, 12, 13),
    canonicalize: canonicalAlphanumeric,
    kindAffectsValidation: true,
  },
  // One NIT for both.
  CO: { validate: isValidColombianNit, canonicalize: canonicalDigits, kindAffectsValidation: false },
  // One RUT for both; the numeric range is conventional, not normative.
  CL: { validate: isValidChileanRut, canonicalize: canonicalAlphanumeric, kindAffectsValidation: false },
  // CUIT: 30/33/34 legal entity, 20/23/24/27 natural person, 50/51/55 other.
  AR: {
    validate: byPrefix(isValidArgentineCuit, ['30', '33', '34', '50', '51', '55'], ['20', '23', '24', '27']),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  // CNPJ for a company, CPF for a natural person. Two separate schemes.
  BR: {
    validate: (value, kind) =>
      kind === TaxpayerKind.COMPANY
        ? isValidBrazilianCnpj(value)
        : kind === TaxpayerKind.INDIVIDUAL
          ? isValidBrazilianCpf(value)
          : isValidBrazilianCnpj(value) || isValidBrazilianCpf(value),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  // RUC: 20 company, 10 natural person, 15/17 legacy.
  PE: {
    validate: byPrefix(isValidPeruvianRuc, ['20'], ['10', '15', '17']),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  // RUC: third digit 9 = company, 6 = public entity, <6 = natural person.
  EC: {
    validate: (value, kind) => {
      if (!isValidEcuadorianRuc(value)) return false;
      const third = Number((numericOnly(value) ?? '')[2]);
      if (kind === TaxpayerKind.COMPANY) return third >= 6;
      if (kind === TaxpayerKind.INDIVIDUAL) return third < 6;
      return true;
    },
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  UY: { validate: isValidUruguayanRut, canonicalize: canonicalDigits, kindAffectsValidation: false },
  PY: { validate: isValidParaguayanRuc, canonicalize: canonicalDigits, kindAffectsValidation: false },
  // RIF: J (company), G (public), P (partnership) versus V/E (natural person).
  VE: {
    validate: (value, kind) => {
      if (!isValidVenezuelanRif(value)) return false;
      const type = value.trim().toUpperCase().replace(/[^A-Z]/g, '')[0];
      if (kind === TaxpayerKind.COMPANY) return type === 'J' || type === 'G' || type === 'P';
      if (kind === TaxpayerKind.INDIVIDUAL) return type === 'V' || type === 'E';
      return true;
    },
    canonicalize: canonicalAlphanumeric,
    kindAffectsValidation: true,
  },
  GT: { validate: isValidGuatemalanNit, canonicalize: canonicalAlphanumeric, kindAffectsValidation: false },
  PA: { validate: isValidPanamanianRuc, canonicalize: canonicalSegmented, kindAffectsValidation: false },
  // Cédula jurídica (10 digits) for a company, física (9) for a natural person.
  CR: {
    validate: byLength(isValidCostaRicanId, (v) => numericOnly(v) ?? '', 10, 9),
    canonicalize: canonicalDigits,
    kindAffectsValidation: true,
  },
  BO: { validate: isValidBolivianNit, canonicalize: canonicalDigits, kindAffectsValidation: false },
  SV: { validate: isValidSalvadoranNit, canonicalize: canonicalDigits, kindAffectsValidation: false },
  HN: { validate: isValidHonduranRtn, canonicalize: canonicalDigits, kindAffectsValidation: false },
  NI: { validate: isValidNicaraguanRuc, canonicalize: canonicalAlphanumeric, kindAffectsValidation: false },
};

/** True when the signup form must ask whether the taxpayer is a company or a natural person. */
export function taxpayerKindAffectsValidation(countryCode: string): boolean {
  return TAX_ID_RULES[countryCode?.toUpperCase() ?? '']?.kindAffectsValidation ?? false;
}

/** Validator-only view of {@link TAX_ID_RULES}, kept for callers that only need the predicate. */
export const TAX_ID_VALIDATORS: Readonly<Record<string, (value: string) => boolean>> =
  Object.fromEntries(
    Object.entries(TAX_ID_RULES).map(([code, rules]) => [code, rules.validate]),
  );

/** True when the country has a validator at all — i.e. the product can be sold there. */
export function isSupportedFiscalCountry(countryCode: string): boolean {
  return Object.prototype.hasOwnProperty.call(TAX_ID_RULES, countryCode?.toUpperCase() ?? '');
}

/**
 * Validate a tax id for a country.
 *
 * Returns false for an unsupported country: there is no safe way to "probably" validate a fiscal
 * identifier, and a permissive default is what let six countries through with no checking at all.
 */
export function validateTaxId(countryCode: string, taxId: string, kind?: TaxpayerKind): boolean {
  const rules = TAX_ID_RULES[countryCode?.toUpperCase() ?? ''];
  if (!rules) return false;
  return Boolean(taxId?.trim()) && rules.validate(taxId.trim(), kind);
}

/**
 * The form a validated tax id is stored in.
 *
 * Throws for an unsupported country rather than guessing: a caller that reaches this without
 * having validated first has a bug, and silently inventing a canonical form for an unknown
 * country is how the destructive `replace(/[^\d]/g, '')` survived as long as it did.
 */
export function canonicalizeTaxId(countryCode: string, taxId: string): string {
  const rules = TAX_ID_RULES[countryCode?.toUpperCase() ?? ''];
  if (!rules) {
    throw new Error(`No canonical tax-id form is defined for country "${countryCode}".`);
  }
  return rules.canonicalize(taxId.trim());
}

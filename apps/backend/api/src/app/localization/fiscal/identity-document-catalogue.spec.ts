import {
  CHECKSUM_ALGORITHMS,
  resolveChecksum,
} from './document-checksums';
import {
  IDENTITY_DOCUMENT_TYPES,
  MARKETS_REQUIRING_DOCUMENTS,
  SUPRANATIONAL_COUNTRY,
  catalogueForCountry,
} from './identity-document-catalogue';
import { canonicalize } from '../services/identity-document.service';

/**
 * The invariants that keep the catalogue from decaying back into an enum.
 *
 * The defect this replaced was not a bug in one function; it was a shape — three Dominican values
 * in a PostgreSQL enum, relabelled per locale by the translation files, validated by one country's
 * arithmetic for all nineteen markets. These assertions are what stop each of those from creeping
 * back one commit at a time.
 */
describe('identity document catalogue', () => {
  it('gives every market at least one document of its own', () => {
    for (const country of MARKETS_REQUIRING_DOCUMENTS) {
      const own = IDENTITY_DOCUMENT_TYPES.filter((entry) => entry.countryCode === country);
      expect(own.length).toBeGreaterThan(0);
    }
  });

  it('offers every market a natural-person document usable for payroll', () => {
    // This is the assertion that would have failed before the change: seventeen of nineteen
    // markets had no personal document at all, and the two that did could not be validated.
    for (const country of MARKETS_REQUIRING_DOCUMENTS) {
      const payrollDocuments = catalogueForCountry(country).filter(
        (entry) =>
          (entry.appliesTo === 'individual' || entry.appliesTo === 'both') &&
          entry.usedFor.includes('payroll'),
      );
      expect(payrollDocuments.length).toBeGreaterThan(0);
    }
  });

  it('names only checksum algorithms that exist', () => {
    // A row citing an unknown algorithm validates as pattern-only at runtime, which is a silent
    // downgrade of exactly the check this catalogue exists to make possible.
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      if (!entry.checksum) continue;
      expect(resolveChecksum(entry.checksum)).toBeInstanceOf(Function);
    }
  });

  it('keys every entry uniquely on (country, code)', () => {
    const seen = new Set<string>();
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      const key = `${entry.countryCode}.${entry.code}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('declares codes, never derives them from a label', () => {
    // The previous seeding computed `code` as `label.replace(/[^A-Za-z]/g, '').toUpperCase()`,
    // which produced `RNCCDULA` for the Dominican Republic and `CDULAJURDICA` for Costa Rica.
    // A code is an identifier: upper-case, ASCII, and chosen.
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      expect(entry.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('gives every entry a catalogue key for its label', () => {
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      expect(entry.labelKey).toMatch(/^identity_document\.[a-z0-9_.]+$/);
    }
  });

  it('anchors every pattern at both ends', () => {
    // An unanchored pattern accepts anything that merely CONTAINS a valid-looking value, which is
    // how a pasted sentence with a cédula in it would pass a format check.
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      expect(entry.pattern.startsWith('^')).toBe(true);
      expect(entry.pattern.endsWith('$')).toBe(true);
      expect(() => new RegExp(entry.pattern)).not.toThrow();
    }
  });

  it('files the passport supranationally rather than under any employer country', () => {
    const passports = IDENTITY_DOCUMENT_TYPES.filter((entry) => entry.code === 'PASSPORT');
    expect(passports).toHaveLength(1);
    expect(passports[0].countryCode).toBe(SUPRANATIONAL_COUNTRY);
    // …and it is still offered in every market.
    for (const country of MARKETS_REQUIRING_DOCUMENTS) {
      expect(catalogueForCountry(country).some((entry) => entry.code === 'PASSPORT')).toBe(true);
    }
  });

  it('names at most one default per (country, appliesTo)', () => {
    const counts = new Map<string, number>();
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      if (!entry.isDefault) continue;
      const key = `${entry.countryCode}.${entry.appliesTo}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      expect({ key, count }).toEqual({ key, count: 1 });
    }
  });

  it('accepts each entry’s own example against its own rule', () => {
    // The example is what the form shows as a placeholder. One that its own pattern rejects
    // teaches the user a shape the server will refuse.
    for (const entry of IDENTITY_DOCUMENT_TYPES) {
      if (!entry.example) continue;
      expect({ code: entry.code, example: entry.example, matches: new RegExp(entry.pattern).test(entry.example) })
        .toEqual({ code: entry.code, example: entry.example, matches: true });
    }
  });

  describe('the markets that could not store an employee document before', () => {
    // Each of these was rejected outright: the interface asked for the document named here (the
    // regional translation patch relabelled the enum) and the server checked it as an eleven-digit
    // Dominican cédula. These assertions pin the rule that each is now checked with its own.
    const cases: Array<{ country: string; code: string; valid: string; invalid: string }> = [
      { country: 'US', code: 'SSN', valid: '123-45-6789', invalid: '000-00-0000' },
      { country: 'BR', code: 'CPF', valid: '529.982.247-25', invalid: '111.111.111-11' },
      { country: 'CL', code: 'RUN', valid: '12.345.678-5', invalid: '12.345.678-0' },
      { country: 'CO', code: 'CC', valid: '1020304050', invalid: 'not-a-number' },
      { country: 'PE', code: 'DNI', valid: '12345678', invalid: '1234' },
      { country: 'AR', code: 'DNI', valid: '12345678', invalid: '123' },
    ];

    it.each(cases)('$country.$code accepts its own document', ({ country, code, valid }) => {
      const entry = catalogueForCountry(country).find((row) => row.code === code);
      expect(entry).toBeDefined();
      expect(new RegExp(entry!.pattern).test(valid)).toBe(true);
      const checksum = resolveChecksum(entry!.checksum);
      if (checksum) expect(checksum(valid)).toBe(true);
    });

    it.each(cases)('$country.$code rejects a malformed one', ({ country, code, invalid }) => {
      const entry = catalogueForCountry(country).find((row) => row.code === code);
      const shapeOk = new RegExp(entry!.pattern).test(invalid);
      const checksum = resolveChecksum(entry!.checksum);
      expect(shapeOk && (!checksum || checksum(invalid))).toBe(false);
    });
  });

  it('does not accept a Dominican cédula as another country’s document', () => {
    // The precise failure being prevented: one country's algorithm standing in for another's.
    const dominicanCedula = '00113918204';
    const chileanRun = catalogueForCountry('CL').find((row) => row.code === 'RUN')!;
    expect(new RegExp(chileanRun.pattern).test(dominicanCedula)).toBe(false);
  });
});

describe('checksum registry', () => {
  it('is total: every algorithm answers a boolean for nonsense instead of throwing', () => {
    for (const [name, algorithm] of Object.entries(CHECKSUM_ALGORITHMS)) {
      for (const input of ['', '   ', 'abc', '!!!', '0'.repeat(40)]) {
        expect({ name, result: typeof algorithm(input) }).toEqual({ name, result: 'boolean' });
      }
    }
  });

  it('separates the Dominican identifiers by length', () => {
    // `isValidDominicanTaxId` accepts both; the catalogue needs them apart, because a cédula in
    // the RNC field is an error even though the combined function accepts it.
    expect(CHECKSUM_ALGORITHMS['do_rnc_mod11']('131-12345-7')).toBe(true);
    expect(CHECKSUM_ALGORITHMS['do_cedula_luhn10']('131-12345-7')).toBe(false);
  });
});

describe('canonical form', () => {
  it('removes only decoration', () => {
    expect(canonicalize('digits', '001-1234567-8')).toBe('00112345678');
    // The Mexican RFC's letters encode the company name and its check pair; deleting them leaves
    // the date of incorporation, which is what the old global digit-strip did.
    expect(canonicalize('alphanumeric', 'DEM010203AB5')).toBe('DEM010203AB5');
    // Panama's RUC is genuinely composite: the hyphens separate fields rather than grouping digits.
    expect(canonicalize('segmented', '15512345-2-2018')).toBe('15512345-2-2018');
  });

  it('keeps two Venezuelan taxpayers distinct', () => {
    // `J-30599168-5` is a company and `V-30599168-5` a natural person. A digits-only canonical
    // form made them the same stored value.
    expect(canonicalize('alphanumeric', 'J-30599168-5')).not.toBe(
      canonicalize('alphanumeric', 'V-30599168-5'),
    );
  });
});

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LOCALES } from '@virteex/shared/types';
import { allMarkets } from './index';

/**
 * Every market reads its own words (MP-02, docs/ARQUITECTURA_MERCADOS.md fase 8).
 *
 * The catalogue is written once, in neutral Latin American Spanish, English and Portuguese, and a
 * market's own vocabulary is a PATCH over it (`libs/shared/locales/src/regional/<locale>.json`):
 * only the keys whose wording actually differs, so a market cannot fall behind the base the way a
 * whole catalogue per country would. Eight markets of nineteen had a patch, so a company in Quito,
 * Tegucigalpa or Asunción read «Bonificación de fin de año» for its décimo tercer sueldo, its
 * decimotercer mes and its aguinaldo.
 *
 * This is the completeness proof the finding asks for. It checks four things, each of which was a
 * real way the wording could be wrong:
 *
 *  1. The market's own locale is a tag the product supports. `LocaleStore.wordingLocale()` answers
 *     `null` for a tag it does not know and the reader silently gets neutral text for ever — no
 *     error, no missing key, just the wrong word.
 *  2. A patch exists for it.
 *  3. Every key a patch carries exists in the base. A patch key that no longer exists in the
 *     catalogue is dead weight that reads as coverage.
 *  4. Each patch covers the keys the base names BY CONCEPT because every market calls them
 *     something else. Those are listed below, with the exemptions spelled out.
 *
 * And one thing that must NOT be in a patch: the name of the market's principal consumption tax.
 * That is declared by the market itself (`markets/<cc>/taxes.ts`, `principalTaxName`) and reaches
 * the invoice screen and the printed document from there, so there is one source of truth and a
 * market opened tomorrow prints its own tax name with no patch at all.
 */
const LOCALES_DIR = join(__dirname, '..', '..', '..', '..', '..', '..', 'libs', 'shared', 'locales', 'src');
const REGIONAL_DIR = join(LOCALES_DIR, 'regional');
const BASE_DIR = join(LOCALES_DIR, 'base');

/** Keys whose base text names a CONCEPT because each market has its own word for it. */
const REQUIRED_KEYS = [
  'payroll.runs.type_label.christmas_bonus',
  'hcm.employees.form.proportional_bonus',
  'hcm.employees.form.social_security_number',
] as const;

/**
 * Where the neutral text is the right text, said explicitly rather than left to a gap.
 *
 * The United States has no statutory year-end bonus: «Year-end bonus» is what a discretionary one
 * is called there, so a patch would be inventing a term. Its social-security number IS patched,
 * because «Social Security Number» is a proper noun there and the neutral phrase is not.
 */
const NEUTRAL_IS_CORRECT: Readonly<Record<string, readonly string[]>> = {
  'en-US': ['payroll.runs.type_label.christmas_bonus', 'hcm.employees.form.proportional_bonus'],
};

/** Keys a patch may never carry: the market declares them itself. */
const DECLARED_BY_THE_MARKET = ['invoices.new.tax_column_header', 'invoice.pdf.tax_column_header'] as const;

const readJson = (path: string): Record<string, unknown> => JSON.parse(readFileSync(path, 'utf8'));

/** Every key the source catalogue defines, across every namespace. */
const baseKeys = new Set<string>(
  readdirSync(BASE_DIR)
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => Object.keys(readJson(join(BASE_DIR, file))))
    .filter((key) => !key.startsWith('$')),
);

/** The market's own locale: the language its books are kept in, placed in its country. */
const localeOf = (market: { code: string; profile: { booksLanguage: string } }) =>
  `${market.profile.booksLanguage}-${market.code}`;

const markets = allMarkets();

describe('regional wording covers every market', () => {
  it('the catalogue and the markets both exist', () => {
    expect(markets.length).toBe(19);
    expect(baseKeys.size).toBeGreaterThan(1000);
  });

  it.each(markets.map((market) => [market.code, localeOf(market)] as const))(
    '%s reads %s',
    (_code, locale) => {
      // 1. The product must know the tag, or the patch can never be chosen.
      expect(SUPPORTED_LOCALES).toContain(locale);

      // 2. A patch exists.
      const path = join(REGIONAL_DIR, `${locale}.json`);
      expect(existsSync(path)).toBe(true);

      const patch = readJson(path);
      expect(patch['$locale']).toBe(locale);

      const keys = Object.keys(patch).filter((key) => !key.startsWith('$'));

      // 3. No orphan: every key it overrides still exists in the catalogue.
      expect(keys.filter((key) => !baseKeys.has(key))).toEqual([]);

      // 4. It covers the concepts each market names differently.
      const exempt = NEUTRAL_IS_CORRECT[locale] ?? [];
      const missing = REQUIRED_KEYS.filter((key) => !exempt.includes(key) && !keys.includes(key));
      expect(missing).toEqual([]);

      // And it does not repeat what the market package declares.
      expect(keys.filter((key) => (DECLARED_BY_THE_MARKET as readonly string[]).includes(key))).toEqual([]);
    },
  );

  it('no patch is left for a locale no market reads', () => {
    const expected = new Set(markets.map(localeOf));
    const present = readdirSync(REGIONAL_DIR)
      .filter((file) => file.endsWith('.json'))
      .map((file) => file.replace('.json', ''));
    expect(present.filter((locale) => !expected.has(locale))).toEqual([]);
  });

  it('every market names its own principal consumption tax', () => {
    // What the invoice column and the printed document read, for all nineteen, with no patch.
    const named = markets.map((market) => [market.code, market.taxes.principalTaxName] as const);
    expect(named.filter(([, name]) => !name || !name.trim())).toEqual([]);
    expect(Object.fromEntries(named)).toMatchObject({
      DO: 'ITBIS',
      PE: 'IGV',
      HN: 'ISV',
      PA: 'ITBMS',
      US: 'Sales Tax',
    });
  });
});

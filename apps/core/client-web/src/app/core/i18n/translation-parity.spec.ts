import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LANGUAGES, LanguageCode, DEFAULT_LANGUAGE } from '@virteex/shared/types';

/**
 * The catalogues must all describe the same product.
 *
 * `en.json` had drifted 376 keys behind `es.json`, and because the application falls back to
 * Spanish that did not surface as a missing string — it surfaced as Spanish text on an English
 * screen. Eighty-eight of those keys were the security and profile settings: the 2FA setup, the
 * recovery codes, the active-session list, the password change. For a product being sold in the
 * United States, the account-security screens rendering in Spanish is not a polish issue.
 *
 * A silent fallback cannot be caught by looking at the application, so it is caught here. The
 * check is driven by `SUPPORTED_LANGUAGES`, so adding a language to the contract without adding
 * its catalogue fails the build rather than shipping a half-translated market.
 */

const I18N_ROOT = join(__dirname, '..', '..', '..', 'assets', 'i18n');

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') {
      Object.assign(out, flatten(value as Tree, path));
    } else {
      out[path] = value as string;
    }
  }
  return out;
}

function load(language: LanguageCode): Record<string, string> {
  return flatten(JSON.parse(readFileSync(join(I18N_ROOT, `${language}.json`), 'utf8')));
}

const CATALOGUES = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((language) => [language, load(language)]),
) as Record<LanguageCode, Record<string, string>>;

const REFERENCE = CATALOGUES[DEFAULT_LANGUAGE];

/** `{{name}}` holes, sorted — order differs legitimately between languages, membership does not. */
const placeholders = (value: string): string[] =>
  [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();

describe('translation catalogues', () => {
  it.each(SUPPORTED_LANGUAGES)('%s defines every key the reference defines', (language) => {
    const missing = Object.keys(REFERENCE).filter((key) => !(key in CATALOGUES[language]));
    expect(missing).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s defines nothing the reference does not', (language) => {
    // A key that exists in one catalogue only is either a typo or a string nobody can reach.
    const extra = Object.keys(CATALOGUES[language]).filter((key) => !(key in REFERENCE));
    expect(extra).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s has no empty values', (language) => {
    const empty = Object.entries(CATALOGUES[language])
      .filter(([, value]) => !String(value).trim())
      .map(([key]) => key);
    expect(empty).toEqual([]);
  });

  /**
   * An interpolation that exists in one language and not another renders a literal `{{email}}` to
   * whichever part of the customer base reads that language.
   */
  it.each(SUPPORTED_LANGUAGES)('%s uses the same placeholders as the reference', (language) => {
    const mismatched = Object.keys(REFERENCE)
      .filter((key) => key in CATALOGUES[language])
      .filter(
        (key) =>
          placeholders(REFERENCE[key]).join(',') !==
          placeholders(CATALOGUES[language][key]).join(','),
      );
    expect(mismatched).toEqual([]);
  });

  /**
   * A plural key must carry every category its language has.
   *
   * Spanish and English have `one`/`other`; Portuguese adds `many`. A catalogue that defines
   * `_one` and `_other` for Portuguese renders the `many` case through the `_other` fallback,
   * which is usually right and is worth knowing about rather than assuming.
   */
  it.each(SUPPORTED_LANGUAGES)('%s defines a plural family completely', (language) => {
    const families = new Set(
      Object.keys(CATALOGUES[language])
        .filter((key) => /_(zero|one|two|few|many|other)$/.test(key))
        .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, '')),
    );

    const incomplete = [...families].filter(
      (family) => !(`${family}_other` in CATALOGUES[language]),
    );
    // `other` is the fallback every CLDR language has, so its absence breaks the whole family.
    expect(incomplete).toEqual([]);
  });

  /**
   * The account-security and payment screens get an explicit floor.
   *
   * These are the ones that were rendering in Spanish for English readers, and they are the ones
   * where not understanding the screen has a cost beyond irritation.
   */
  it.each(
    SUPPORTED_LANGUAGES.flatMap((language) =>
      ['SETTINGS.SECURITY', 'SETTINGS.PROFILE', 'AUTH.STEP_UP', 'REGISTER', 'LOGIN', 'ERRORS'].map(
        (namespace) => [language, namespace] as const,
      ),
    ),
  )('%s translates %s completely', (language, namespace) => {
    const keys = Object.keys(REFERENCE).filter((key) => key.startsWith(`${namespace}.`));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.filter((key) => !(key in CATALOGUES[language]))).toEqual([]);
  });

  /**
   * A translation that is byte-identical to the Spanish is usually an untranslated string.
   *
   * Not always — `Email`, `Total`, `ERP`, a brand name and most acronyms are the same word in all
   * three languages — so the check is a budget rather than a prohibition, and it is generous. It
   * exists to catch a bulk copy of `es.json` into `pt.json`, which is the way this fails in
   * practice.
   */
  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== DEFAULT_LANGUAGE))(
    '%s is not a copy of the reference',
    (language) => {
      const identical = Object.keys(REFERENCE).filter(
        (key) => CATALOGUES[language][key]?.trim() === REFERENCE[key]?.trim(),
      );
      const share = identical.length / Object.keys(REFERENCE).length;
      expect({ language, identical: identical.length, share: Number(share.toFixed(3)) }).toEqual(
        expect.objectContaining({ share: expect.any(Number) }),
      );
      expect(share).toBeLessThan(0.25);
    },
  );
});

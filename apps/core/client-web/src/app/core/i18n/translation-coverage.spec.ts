import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SUPPORTED_LANGUAGES, LanguageCode } from '@virteex/shared/types';

/**
 * A translation key that is used must be a translation key that exists.
 *
 * `@ngx-translate` renders a missing key as the key itself, so the failure mode is a screen that
 * shows `REGISTER.INDUSTRIES.TECHNOLOGY` in a dropdown instead of "Tecnología". That is exactly
 * what the signup wizard did: the whole industry list — a REQUIRED field on the step that takes
 * the customer's money — was missing from both locale files, along with fourteen other keys
 * across password reset, the security settings and the dashboard widgets.
 *
 * Nothing caught it because nothing could: a missing key is not a type error, not a runtime error,
 * and not a failing render. It is a string. This sweep is the check that makes it one.
 *
 * ## Why the pattern is not just SCREAMING_SNAKE
 *
 * It used to be `[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+`, which missed 374 of the 989 keys — every
 * `sidebar.*` and `datasheets.*` key, 38 % of the catalogue, invisible to the guard that existed
 * to protect it. The two naming conventions are now both recognised, and `naming` below refuses
 * to let a third one appear.
 */

const APP_ROOT = join(__dirname, '..', '..');
const I18N_ROOT = join(__dirname, '..', '..', '..', 'assets', 'i18n');

/**
 * A quoted string that looks like a catalogue key.
 *
 * Accepts both conventions in the catalogue: `SECTION.SUB.KEY` and `sidebar.group.item`. At least
 * two segments, because a single word is a value far more often than a key.
 */
const KEY_PATTERN = /['"]((?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_]*)(?:\.[A-Za-z0-9_]+)+)['"]/g;

/**
 * Strings that look like a translation key but are not one.
 *
 * Enum members, HTTP header names, MIME types and dotted property paths share the shape. Listing
 * them explicitly is better than loosening the pattern, which would let real misses through.
 */
const NOT_TRANSLATION_KEYS = new Set<string>([
  'UserStatus.ACTIVE',
  'X-XSRF-TOKEN',
  'Content-Type',
  'application.json',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith('.ts') && !full.endsWith('.html')) return [];
    if (full.endsWith('.spec.ts')) return [];
    return [full];
  });
}

function flatten(value: Record<string, unknown>, prefix = ''): Set<string> {
  const keys = new Set<string>();
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      for (const nested of flatten(child as Record<string, unknown>, path)) keys.add(nested);
    } else {
      keys.add(path);
    }
  }
  return keys;
}

function loadLocale(language: LanguageCode): Set<string> {
  return flatten(JSON.parse(readFileSync(join(I18N_ROOT, `${language}.json`), 'utf8')));
}

describe('translation coverage', () => {
  const catalogues = Object.fromEntries(
    SUPPORTED_LANGUAGES.map((language) => [language, loadLocale(language)]),
  ) as Record<LanguageCode, Set<string>>;

  const used = new Map<string, string[]>();
  for (const file of sourceFiles(APP_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(KEY_PATTERN)) {
      const key = match[1];
      if (NOT_TRANSLATION_KEYS.has(key)) continue;
      // Only strings the catalogue actually knows about, or that look like an intended key in a
      // translate call. A dotted property path in a string (`'organization.legalName'` in a
      // sort expression) is not a translation key, and the catalogue is the arbiter.
      used.set(key, [...(used.get(key) ?? []), file.slice(APP_ROOT.length + 1)]);
    }
  }

  /** The keys that are plausibly translation keys: the catalogue defines at least one language. */
  const referenced = [...used.entries()].filter(([key]) =>
    SUPPORTED_LANGUAGES.some((language) => catalogues[language].has(key)),
  );

  it('finds keys to check (guards against a silently empty sweep)', () => {
    expect(referenced.length).toBeGreaterThan(900);
  });

  it.each(SUPPORTED_LANGUAGES)('every key the client uses exists in %s', (language) => {
    const missing = referenced
      .filter(([key]) => !catalogues[language].has(key))
      .map(([key, files]) => `${key}  (${files[0]})`);
    expect(missing).toEqual([]);
  });

  /**
   * A key referenced in code that NO catalogue defines.
   *
   * Separated from the check above because the failure is different: that one is a translation
   * gap, this one is a key that will render as itself in every language. `USER.STATUS.INACTIVE`
   * was exactly this — composed at runtime from an enum with five members against a catalogue
   * with four.
   */
  it('references no key that is missing from every catalogue', () => {
    const orphans = [...used.entries()]
      // Composed keys and property paths are not detectable here; the shape test keeps this to
      // strings that were written as keys.
      .filter(([key]) => /^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(key))
      .filter(([key]) => SUPPORTED_LANGUAGES.every((language) => !catalogues[language].has(key)))
      .filter(([, files]) => files.some((file) => file.endsWith('.html')))
      .map(([key, files]) => `${key}  (${files[0]})`);
    expect(orphans).toEqual([]);
  });

  /**
   * Every value of every enum a template composes a key from.
   *
   * `{{ "USER.STATUS." + user.status | translate }}` cannot be checked by a sweep for literals:
   * the key never appears in the source. It appeared on screen instead — `USER.STATUS.INACTIVE`,
   * in a table cell, because the enum has five members and the catalogue had four.
   */
  describe('runtime-composed keys', () => {
    const cases: Array<[string, readonly string[]]> = [
      ['USER.STATUS', ['PENDING', 'ACTIVE', 'INACTIVE', 'ARCHIVED', 'BLOCKED']],
      ['USER.ROLE', ['ADMINISTRATOR', 'MEMBER', 'SELLER', 'ACCOUNTANT', 'NO_ROLE']],
    ];

    it.each(
      cases.flatMap(([prefix, values]) =>
        SUPPORTED_LANGUAGES.map((language) => [language, prefix, values] as const),
      ),
    )('%s defines every %s', (language, prefix, values) => {
      const missing = values.filter((value) => !catalogues[language].has(`${prefix}.${value}`));
      expect(missing).toEqual([]);
    });
  });

  /**
   * One naming convention per catalogue, or at most the two that already exist.
   *
   * `NAV.DASHBOARD` and `sidebar.general.dashboard` coexist for historical reasons and the
   * coverage pattern above recognises both. A third shape would be one the pattern does not
   * match, which is how 38 % of the catalogue became invisible to this very check.
   */
  it('uses no naming convention the coverage sweep cannot see', () => {
    const unrecognised = [...catalogues['es']].filter(
      (key) => !/^(?:[A-Z][A-Z0-9_]*|[a-z][a-z0-9_]*)(?:\.[A-Za-z0-9_]+)*$/.test(key),
    );
    expect(unrecognised).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A translation key that is used must be a translation key that exists.
 *
 * `@ngx-translate` renders a missing key as the key itself, so the failure mode is a screen that
 * shows `REGISTER.INDUSTRIES.TECHNOLOGY` in a dropdown instead of "Tecnología". That is exactly
 * what the signup wizard did: the whole industry list — a REQUIRED field on step five of the
 * flow that takes the customer's money — was missing from both locale files, along with fourteen
 * other keys across password reset, the security settings and the dashboard widgets.
 *
 * Nothing caught it because nothing could: a missing key is not a type error, not a runtime
 * error, and not a failing render. It is a string. This sweep is the check that makes it one.
 */

const APP_ROOT = join(__dirname, '..', '..');
const I18N_ROOT = join(__dirname, '..', '..', '..', 'assets', 'i18n');

/** `SECTION.SUB.KEY` — screaming snake segments, at least two of them. */
const KEY_PATTERN = /['"]([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)['"]/g;

/**
 * Strings that look like a translation key but are not one.
 *
 * Enum members, HTTP header names and permission constants share the shape. Listing them
 * explicitly is better than loosening the pattern, which would let real misses through.
 */
const NOT_TRANSLATION_KEYS = new Set<string>([
  'UserStatus.ACTIVE',
  'X-XSRF-TOKEN',
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

function loadLocale(language: string): Set<string> {
  return flatten(JSON.parse(readFileSync(join(I18N_ROOT, `${language}.json`), 'utf8')));
}

describe('translation coverage', () => {
  const spanish = loadLocale('es');
  const english = loadLocale('en');

  const used = new Map<string, string[]>();
  for (const file of sourceFiles(APP_ROOT)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(KEY_PATTERN)) {
      const key = match[1];
      if (NOT_TRANSLATION_KEYS.has(key)) continue;
      used.set(key, [...(used.get(key) ?? []), file.slice(APP_ROOT.length + 1)]);
    }
  }

  it('finds keys to check (guards against a silently empty sweep)', () => {
    expect(used.size).toBeGreaterThan(300);
  });

  it('every key the client uses exists in Spanish', () => {
    const missing = [...used.entries()]
      .filter(([key]) => !spanish.has(key))
      .map(([key, files]) => `${key}  (${files[0]})`);

    expect(missing).toEqual([]);
  });

  it('every key the client uses exists in English', () => {
    const missing = [...used.entries()]
      .filter(([key]) => !english.has(key))
      .map(([key, files]) => `${key}  (${files[0]})`);

    expect(missing).toEqual([]);
  });

  it('the two locales declare exactly the same keys', () => {
    const onlySpanish = [...spanish].filter((key) => !english.has(key));
    const onlyEnglish = [...english].filter((key) => !spanish.has(key));

    expect({ onlySpanish, onlyEnglish }).toEqual({ onlySpanish: [], onlyEnglish: [] });
  });
});

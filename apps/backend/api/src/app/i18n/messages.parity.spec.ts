import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_LANGUAGE, LanguageCode, SUPPORTED_LANGUAGES } from '@virteex/shared/types';

/**
 * The server's catalogues must all describe the same product.
 *
 * The same check the client has, for the same reason and against the same failure: a language
 * that is missing a key falls back silently, so an English reader gets a Spanish sentence at the
 * moment something went wrong. On the server that includes every exception message, every e-mail
 * subject and every line of an invoice PDF.
 *
 * Driven by `SUPPORTED_LANGUAGES`, so adding a language to the contract without adding its
 * catalogue fails the build rather than shipping a market that half works.
 */

const MESSAGES = join(__dirname, 'messages');

type Tree = { [key: string]: string | Tree };

function flatten(tree: Tree, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value !== null && typeof value === 'object') Object.assign(out, flatten(value as Tree, path));
    else out[path] = value as string;
  }
  return out;
}

const CATALOGUES = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((language) => [
    language,
    flatten(JSON.parse(readFileSync(join(MESSAGES, `${language}.json`), 'utf8'))),
  ]),
) as Record<LanguageCode, Record<string, string>>;

const REFERENCE = CATALOGUES[DEFAULT_LANGUAGE];

const placeholders = (value: string): string[] =>
  [...String(value).matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((match) => match[1]).sort();

describe('server message catalogues', () => {
  it('the reference catalogue is not empty', () => {
    expect(Object.keys(REFERENCE).length).toBeGreaterThan(400);
  });

  it.each(SUPPORTED_LANGUAGES)('%s defines every key the reference defines', (language) => {
    expect(Object.keys(REFERENCE).filter((key) => !(key in CATALOGUES[language]))).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s defines nothing the reference does not', (language) => {
    expect(Object.keys(CATALOGUES[language]).filter((key) => !(key in REFERENCE))).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES)('%s has no empty values', (language) => {
    expect(
      Object.entries(CATALOGUES[language])
        .filter(([, value]) => !String(value).trim())
        .map(([key]) => key),
    ).toEqual([]);
  });

  /**
   * A message whose parameters differ between languages loses a value for half the customer base.
   *
   * `'Usuario con id {{id}} no encontrado'` translated without its `{{id}}` renders a sentence
   * that names nothing, and the support ticket that follows has no reference to quote.
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
   * No HTML entity in a value.
   *
   * The e-mail templates render through `{{ }}`, which escapes its output — so a `&copy;` stored
   * in the catalogue reaches the reader as the literal five characters `&copy;` rather than as
   * `©`. Store the character.
   */
  it.each(SUPPORTED_LANGUAGES)('%s stores characters, not HTML entities', (language) => {
    const entities = Object.entries(CATALOGUES[language])
      .filter(([, value]) => /&[a-z]+;|&#x?[0-9a-f]+;/i.test(String(value)))
      .map(([key]) => key);
    expect(entities).toEqual([]);
  });

  it.each(SUPPORTED_LANGUAGES.filter((language) => language !== DEFAULT_LANGUAGE))(
    '%s is not a copy of the reference',
    (language) => {
      const identical = Object.keys(REFERENCE).filter(
        (key) => CATALOGUES[language][key]?.trim() === REFERENCE[key]?.trim(),
      );
      expect(identical.length / Object.keys(REFERENCE).length).toBeLessThan(0.25);
    },
  );
  /**
   * Every key the code actually throws exists in a catalogue.
   *
   * The parity checks above compare the three catalogues to **each other**, and pass perfectly
   * while a key that no catalogue has is thrown from production code — because being equally
   * absent everywhere is parity. The reader then gets the raw key as their error message:
   * `SAAS.SUBSCRIPTION_SUSPENDED` instead of a sentence telling them why they were refused.
   *
   * Sixteen such keys were live when this check was written, in guards and services that had
   * never been read back in a language. That is the same shape of blind spot as the schema-drift
   * check that reported success without diffing, and the i18n gate that could not see a literal
   * inside a comment: a control that ran, passed, and was not looking at the thing it was named
   * after.
   *
   * Scanned rather than enumerated, so a key added tomorrow is covered without anyone remembering
   * to list it here.
   */
  describe('keys the code throws', () => {
    /** `'GROUP.SOME_KEY'` as it appears in a `BadRequestError` / `InternalServerError` call. */
    const KEY_PATTERN = /'([A-Z][A-Z0-9_]*(?:\.[A-Z][A-Z0-9_]*)+)'/g;

    /**
     * i18next plural suffixes.
     *
     * `TIME.MINUTES` is stored as `MINUTES_one` and `MINUTES_other`, and the code names the base
     * key. Both spellings are the same message.
     */
    const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other'];

    /**
     * The client's catalogue, because some keys the backend names are the client's to render.
     *
     * `FiscalDocumentTypeOption.labelKey` is the example: the server says a Chilean document type
     * is `FISCAL.CL.33` and the invoice screen translates it. Requiring it in the server's own
     * catalogue would mean storing the same label twice, and the failure this guards against —
     * a reader seeing a raw key — is equally prevented by it existing on the side that renders it.
     */
    const clientCatalogue = flatten(
      JSON.parse(
        readFileSync(
          join(__dirname, '../../../../../core/client-web/src/assets/i18n/es.json'),
          'utf8',
        ),
      ) as Tree,
    );

    const defined = (key: string): boolean =>
      key in REFERENCE ||
      key in clientCatalogue ||
      PLURAL_SUFFIXES.some((suffix) => `${key}${suffix}` in REFERENCE);

    /**
     * Source with comments removed.
     *
     * Doc comments in this codebase quote example keys — `throw new UnprocessableEntityError(
     * 'JOURNAL_ENTRIES.UNBALANCED', …)` appears in `localized.exception.ts` explaining the
     * pattern — and an example is not a call. Scanning them was the same mistake the template
     * scanner made before it learned to skip `<!-- -->`.
     */
    const withoutComments = (source: string): string =>
      source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

    const sourceFiles = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return sourceFiles(path);
        // Specs name keys they expect NOT to exist, and migrations carry SQL identifiers that
        // look like keys. Neither is a message the product throws.
        if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) return [];
        if (path.includes('/database/migrations/')) return [];
        return [path];
      });

    it('are all present in a catalogue', () => {
      const groups = new Set(Object.keys(REFERENCE).map((key) => key.split('.')[0]));
      const referenced = new Map<string, string>();

      for (const file of sourceFiles(join(__dirname, '..'))) {
        const source = withoutComments(readFileSync(file, 'utf8'));
        for (const match of source.matchAll(KEY_PATTERN)) {
          const key = match[1];
          // Only keys under a group the catalogue defines: the pattern also matches enum-ish
          // constants and SQL fragments, and those are not messages.
          if (groups.has(key.split('.')[0])) referenced.set(key, file);
        }
      }

      // Proof the scan reaches real call sites rather than quietly matching nothing — the exact
      // failure mode this whole describe block exists to prevent.
      expect(referenced.size).toBeGreaterThan(200);

      const missing = [...referenced.entries()]
        .filter(([key]) => !defined(key))
        .map(([key, file]) => `${key} (${file.split('/src/app/')[1]})`);

      expect(missing).toEqual([]);
    });
  });
});

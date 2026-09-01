import { readFileSync } from 'node:fs';
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
});

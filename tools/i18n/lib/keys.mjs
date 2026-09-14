/**
 * Key shape, and the one place that decides it.
 *
 * ## The convention
 *
 * `namespace.section.element`, every segment `lower_snake`, every word English. Lowercase and
 * English are not aesthetics: a key sitting beside its own Spanish value has to be unmistakably
 * a key. `ACCOUNTING.ANO_FISCAL_CERRADO` next to "El año fiscal está cerrado" is two Spanish
 * strings and a reader has to know the file to tell which is which; `accounting.fiscal_year.closed`
 * cannot be mistaken for a translation of anything.
 *
 * ## Why this module exists rather than a rule in a document
 *
 * The catalogues arrived here with three conventions at once — `SCREAMING_SNAKE` for most of the
 * tree, `sidebar.master_data.products` in lowercase for the navigation, and `'success'` /
 * `'execution_failed'` for keys composed from an unnormalised API enum. Three conventions is what
 * happens when the convention lives in prose. It lives here, `verify-catalogues.mjs` enforces it,
 * and CI fails on a key that does not match.
 *
 * CLDR plural suffixes (`_one`, `_other`, `_many`, `_few`, `_zero`, `_two`) are part of the lookup
 * contract that `Intl.PluralRules` resolves against, so they survive normalisation untouched.
 */

/** The plural categories CLDR defines. A trailing one of these is a suffix, not a word. */
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/**
 * A valid key: dot-separated `lower_snake` segments.
 *
 * A segment may start with a digit because some segments are not words: the fiscal document type
 * codes each authority publishes (`fiscal.cl.33`, `fiscal.ar.01`, `fiscal.do.b01`) are the codes
 * themselves, composed at runtime from the value the tax authority assigns. Renaming them to
 * words would mean maintaining a translation table between a legal code and our own name for it,
 * which is one more place to be wrong.
 */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z0-9][a-z0-9]*(?:_[a-z0-9]+)*)*$/;

export function isValidKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key);
}

/**
 * English words carrying no identifying weight in a key.
 *
 * Deliberately short. Dropping too much turns distinct messages into the same slug — the reason
 * `slugFor` in the old extractor collided often enough to need a `_2` suffix scheme.
 */
const FILLER = new Set([
  'the', 'a', 'an', 'of', 'to', 'is', 'are', 'was', 'were', 'be', 'been', 'its', 'it',
  'this', 'that', 'these', 'those', 'and', 'or', 'as', 'at', 'by', 'in', 'on', 'for',
  'please', 'there',
]);

/**
 * Split a segment into words, whatever case it arrived in.
 *
 * Handles `SCREAMING_SNAKE`, `camelCase`, `kebab-case` and `Sentence text`, because the tree
 * contained all four.
 */
export function words(segment) {
  return String(segment)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Normalise an already-English segment: `ACCOUNT_FORM` → `account_form`. */
export function normaliseSegment(segment) {
  const parts = words(segment).map((w) => w.toLowerCase());
  return parts.join('_') || 'value';
}

/**
 * Build a segment from a sentence.
 *
 * Used once, to migrate keys that had been generated from their own Spanish text. `maxWords`
 * defaults to five: long enough to stay distinct, short enough that the key reads as a name
 * rather than as the sentence it came from.
 */
export function segmentFromText(text, maxWords = 5) {
  const all = words(text).map((w) => w.toLowerCase());
  const kept = all.filter((w) => !FILLER.has(w) && w.length > 1);
  const source = kept.length ? kept : all;
  const slug = source.slice(0, maxWords).join('_');
  return slug || 'value';
}

/** Split a leaf into `[stem, pluralSuffix|null]` so the suffix survives a rename. */
export function splitPlural(leaf) {
  const match = /^(.*)_([a-z]+)$/.exec(String(leaf));
  if (match && PLURAL_SUFFIXES.includes(match[2])) return [match[1], match[2]];
  return [String(leaf), null];
}

/**
 * What a catalogue key looks like, and the one place a key gets normalised.
 *
 * ## The convention
 *
 * `namespace.section.element` — every segment `lower_snake`, every word English. English because a
 * key has to be unmistakably a key: `ACCOUNTING.ANO_FISCAL_CERRADO` sitting beside "El año fiscal
 * está cerrado" is two Spanish strings, and telling which one is the identifier means knowing the
 * file. `accounting.fiscal_year.closed` cannot be mistaken for a translation of anything.
 *
 * ## Why normalisation has to exist at runtime
 *
 * Half the keys in this product are not written out. They are composed from a value that arrived
 * from the API — a status, a document type, a payment method, a CLDR plural category:
 *
 *     `accounts_payable.status.${bill.status}`      // status is 'PARTIALLY_PAID'
 *     `payroll.runs.type_label.${run.runType}`      // runType is 'CHRISTMAS_BONUS'
 *     `extensions.run_status.${run.status}`         // status is 'execution_failed'
 *
 * Those values are the database's spelling, not the catalogue's, and they are not consistent with
 * each other: TypeORM enums are `SCREAMING_SNAKE`, the extension sandbox reports `snake_case`, and
 * a DTO field arrives `camelCase`. Asking sixty call sites to remember to convert is asking for the
 * one that forgets, which surfaces as a raw `accounts_payable.status.PARTIALLY_PAID` in a table
 * cell — the failure mode this whole convention exists to make impossible.
 *
 * So the conversion happens once, at lookup, in `VirtexTranslateStore` on the client and in
 * `I18nService` on the server. A call site may compose a key in whatever case its data arrives in
 * and still find the entry.
 */

/** The CLDR plural categories. A trailing one of these is a suffix, never a word to re-case. */
export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

export type PluralSuffix = (typeof PLURAL_SUFFIXES)[number];

/**
 * A valid key.
 *
 * A segment may begin with a digit because some segments are not words: the fiscal document type
 * codes each tax authority publishes (`fiscal.cl.33`, `fiscal.ar.01`, `fiscal.do.b01`) are the
 * codes themselves. Translating them into names of our own would mean maintaining a mapping
 * between a legal code and our word for it — one more table to be wrong.
 */
export const KEY_PATTERN = /^[a-z0-9][a-z0-9]*(?:_[a-z0-9]+)*(?:\.[a-z0-9][a-z0-9]*(?:_[a-z0-9]+)*)*$/;

export function isCatalogueKey(value: unknown): value is string {
  return typeof value === 'string' && KEY_PATTERN.test(value);
}

/**
 * Normalise one segment: `PARTIALLY_PAID` → `partially_paid`, `payFrequency` → `pay_frequency`,
 * `execution_failed` → `execution_failed`, `B01` → `b01`.
 */
export function normalizeKeySegment(segment: string): string {
  return String(segment)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

/**
 * Normalise a whole dotted key.
 *
 * Cheap enough to run on every lookup: a key is a short string and this is a handful of regex
 * passes on it, against a table read that is already a walk down a nested object. The result is
 * memoised by the caller where it matters.
 */
export function normalizeKey(key: string): string {
  if (KEY_PATTERN.test(key)) return key;
  return key.split('.').map(normalizeKeySegment).filter(Boolean).join('.');
}

/**
 * Build a key from a prefix and the values that name its leaf.
 *
 * Prefer this to string concatenation at a call site that composes a key: it makes the intent
 * ("this is a key, and these parts come from data") legible, and it cannot be the call site that
 * forgot to convert. `null` and `undefined` segments are dropped, so an optional field does not
 * produce `prefix..suffix`.
 */
export function composeKey(prefix: string, ...segments: (string | number | null | undefined)[]): string {
  const tail = segments
    .filter((s): s is string | number => s !== null && s !== undefined && s !== '')
    .map((s) => normalizeKeySegment(String(s)))
    .filter(Boolean);
  return [normalizeKey(prefix), ...tail].join('.');
}

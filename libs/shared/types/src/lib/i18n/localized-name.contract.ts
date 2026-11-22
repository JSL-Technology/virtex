import { SUPPORTED_LANGUAGES, isLanguageCode, type LanguageCode } from './locale.contract';

/**
 * A name kept in several languages: `{ es: 'Bancos', en: 'Banks', pt: 'Bancos' }`.
 *
 * The books language is always present: it is the record, what a filing and an auditor read
 * (`LanguageAxis.Books`). The others are for whoever reads the screen (`LanguageAxis.Interface`) —
 * a US controller of a Dominican company reads «Banks» while the books, the exports and the DGII
 * keep «Bancos». A language that is missing falls back to the books one, never to a blank.
 */
export type LocalizedName = Partial<Record<LanguageCode, string>>;

/**
 * Whether a value IS a name kept in several languages — `{ es: 'Bancos', en: 'Banks' }` — judged by
 * its shape alone: an object with at least one entry, every key a language the product speaks and
 * every value a text.
 *
 * It is what lets a message carry an account's name as a value and have it read in the message's
 * language: the server and the client apply the same test, so `Categoría: {{account}}` becomes
 * «Categoría: Bancos» in the books and «Category: Banks» on an English screen — never
 * «[object Object]», which is what interpolating the object printed.
 */
export function isLocalizedName(value: unknown): value is LocalizedName {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  return entries.length > 0 && entries.every(([language, text]) => isLanguageCode(language) && typeof text === 'string');
}

/** The longest name a translation may carry: the column's own limit for the books one. */
export const LOCALIZED_NAME_MAX_LENGTH = 255;

/**
 * `name` in `language`; else in `booksLanguage`; else whichever it has. A plain string is a name
 * kept in one language only, and is returned as it is.
 */
export function localizedNameIn(
  name: LocalizedName | Record<string, string> | string | null | undefined,
  language: string | null | undefined,
  booksLanguage?: string | null,
): string {
  if (name == null) return '';
  if (typeof name === 'string') return name;
  const names = name as Record<string, string | undefined>;
  const base = (language ?? '').slice(0, 2).toLowerCase();
  const books = (booksLanguage ?? '').slice(0, 2).toLowerCase();
  return (
    (language ? names[language] : undefined) ??
    names[base] ??
    (books ? names[books] : undefined) ??
    Object.values(names).find((candidate): candidate is string => Boolean(candidate)) ??
    ''
  );
}

/**
 * The translations a person sent, cleaned: supported languages only, trimmed, the empty ones
 * dropped — an empty field means «no translation in that language», not a blank name.
 */
export function cleanTranslations(translations: Record<string, unknown> | null | undefined): LocalizedName {
  const out: LocalizedName = {};
  if (!translations) return out;
  for (const language of SUPPORTED_LANGUAGES) {
    const value = translations[language];
    if (typeof value === 'string' && value.trim()) out[language] = value.trim();
  }
  return out;
}

/**
 * How an AI answer is scored against a case. Pure functions: they run in every CI build (on the
 * cases' own fixtures) and in the evaluation run (on what the model answered).
 */

export interface Grade {
  pass: boolean;
  score: number;
  failures: string[];
}

/** A grade from a list of named checks. */
export function grade(checks: Array<[string, boolean]>, passAt = 1): Grade {
  const failures = checks.filter(([, ok]) => !ok).map(([name]) => name);
  const score = checks.length ? (checks.length - failures.length) / checks.length : 1;
  return { pass: score >= passAt, score, failures };
}

/** A read field against the printed one: numbers to the cent, text ignoring case, spaces and dashes. */
export function sameField(expected: unknown, actual: unknown): boolean {
  if (expected === null) return actual === null || actual === undefined || actual === '';
  if (typeof expected === 'number') return typeof actual === 'number' && Math.abs(actual - expected) < 0.011;
  const text = (value: unknown) => String(value ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
  return text(expected) === text(actual);
}

/** Field accuracy of an extraction: one check per expected field (`lines` compares the count). */
export function gradeExtraction(expected: Record<string, unknown>, actual: Record<string, unknown> | null, passAt = 0.9): Grade {
  if (!actual) return { pass: false, score: 0, failures: ['no answer'] };
  return grade(
    Object.entries(expected).map(([field, value]) => {
      if (field === 'lines') return [field, Array.isArray(actual['lines']) && actual['lines'].length === value];
      return [field, sameField(value, actual[field])];
    }),
    passAt,
  );
}

const STOPWORDS: Record<'es' | 'en' | 'pt', string[]> = {
  es: ['el', 'la', 'los', 'las', 'de', 'que', 'y', 'en', 'un', 'una', 'por', 'con', 'para', 'es', 'su', 'tu', 'del', 'al', 'lo', 'más', 'hay', 'tiene'],
  en: ['the', 'and', 'of', 'to', 'in', 'is', 'you', 'that', 'it', 'for', 'on', 'with', 'are', 'your', 'have', 'has', 'this', 'by', 'at', 'from'],
  pt: ['o', 'a', 'os', 'as', 'de', 'que', 'e', 'em', 'um', 'uma', 'por', 'com', 'para', 'é', 'seu', 'sua', 'do', 'da', 'não', 'mais', 'tem'],
};

/** The language a text is written in, by its most frequent function words. */
export function languageOf(text: string): 'es' | 'en' | 'pt' | null {
  const words = text.toLowerCase().normalize('NFC').match(/\p{L}+/gu) ?? [];
  if (words.length < 3) return null;
  const counts = (Object.keys(STOPWORDS) as Array<'es' | 'en' | 'pt'>).map((language) => {
    const set = new Set(STOPWORDS[language]);
    return [language, words.filter((word) => set.has(word)).length] as const;
  });
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 && counts[0][1] > counts[1][1] ? counts[0][0] : null;
}

/** Every number written in a text, read either way ("1.500,25" and "1,500.25" are both 1500.25). */
export function numbersIn(text: string): number[] {
  const found: number[] = [];
  for (const raw of text.match(/\d[\d.,]*\d|\d/g) ?? []) {
    const lastDot = raw.lastIndexOf('.');
    const lastComma = raw.lastIndexOf(',');
    const decimal = Math.max(lastDot, lastComma);
    const tail = decimal >= 0 ? raw.length - decimal - 1 : 0;
    // A separator followed by exactly three digits and nothing else is a thousands separator.
    const isDecimal = decimal >= 0 && tail !== 3;
    const digits = isDecimal
      ? raw.slice(0, decimal).replace(/[.,]/g, '') + '.' + raw.slice(decimal + 1)
      : raw.replace(/[.,]/g, '');
    const value = Number(digits);
    if (Number.isFinite(value)) found.push(value);
  }
  return found;
}

/** Whether a text states a number (written in any customary way, or rounded as people do). */
export function mentions(text: string, value: number): boolean {
  const numbers = numbersIn(text);
  const scaled = [value, value / 1000, value / 1_000_000];
  return numbers.some((n) => scaled.some((target) => Math.abs(n - target) < 0.011 || (target >= 1 && Math.abs(n - target) / target < 0.005)));
}

/** Every number in a JSON value, flattened (the facts a text may state). */
export function numbersOf(value: unknown): number[] {
  const out: number[] = [];
  const visit = (node: unknown) => {
    if (typeof node === 'number') out.push(node);
    else if (typeof node === 'string') out.push(...numbersIn(node));
    else if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value);
  return out;
}

/**
 * Numbers in a text that the facts do not contain — small counting numbers aside (a list's "1.",
 * "2 facturas"), and percentages or sums a sentence may derive are reported, not excused.
 */
export function inventedNumbers(text: string, facts: unknown, smallUpTo = 31): number[] {
  const known = numbersOf(facts);
  const isKnown = (n: number) => known.some((k) => Math.abs(k - n) < 0.011 || Math.abs(Math.abs(k) - n) < 0.011 || (Math.abs(k) >= 1000 && Math.abs(Math.abs(k) / 1000 - n) < 0.011));
  return numbersIn(text).filter((n) => !(Number.isInteger(n) && n <= smallUpTo) && !isKnown(n) && !(n >= 1900 && n <= 2100));
}

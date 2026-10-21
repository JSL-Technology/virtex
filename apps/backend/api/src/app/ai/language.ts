/**
 * The name of a company's books language, for a model told what language to write in. Text the AI
 * writes once and keeps for everyone (a catalogue entry, an anomaly's explanation) is written in the
 * books language; Spanish only when the company has not set one.
 */
export function booksLanguageName(booksLanguage: string | null | undefined): string {
  const names: Record<string, string> = { es: 'Spanish', en: 'English', pt: 'Portuguese' };
  return names[(booksLanguage ?? '').slice(0, 2).toLowerCase()] ?? 'Spanish';
}

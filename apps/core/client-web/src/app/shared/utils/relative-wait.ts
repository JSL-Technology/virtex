/**
 * "in 15 minutes", "dentro de 40 segundos", "em 2 minutos" — a wait, in the reader's language.
 *
 * From `Intl.RelativeTimeFormat` rather than a catalogue entry per unit and plural: the platform
 * already knows how each language says it, including the plural forms our catalogue would have
 * to spell out three times. Rounded UP to the unit shown, because telling somebody to come back
 * a minute too early is the one error that sends them into the same wall again.
 */
export function relativeWait(seconds: number, locale: string): string {
  const safe = Math.max(1, Math.ceil(seconds));
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    safe < 60 ? [safe, 'second'] : safe < 3600 ? [Math.ceil(safe / 60), 'minute'] : [Math.ceil(safe / 3600), 'hour'];
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(value, unit);
  } catch {
    return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(value, unit);
  }
}

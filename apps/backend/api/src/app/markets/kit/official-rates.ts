import { OfficialRateFormatError, OfficialRateQuote } from '../contracts';

/**
 * What every official-rate feed needs to read a publication strictly: a body that is the JSON it
 * says it is, dates in the publisher's form, and figures that are numbers. Anything else is an
 * `OfficialRateFormatError` naming what was wrong — a feed never turns an unrecognised answer into
 * a rate.
 */

/** The body as JSON, or the reason it is not. */
export function jsonBody(feed: string, body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new OfficialRateFormatError(feed, `the response is not JSON (starts with ${JSON.stringify(body.slice(0, 40))})`);
  }
}

/** A plain object, or the reason it is not. */
export function objectAt(feed: string, value: unknown, where: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new OfficialRateFormatError(feed, `${where} is not an object`);
  }
  return value as Record<string, unknown>;
}

/** An array, or the reason it is not. */
export function arrayAt(feed: string, value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) throw new OfficialRateFormatError(feed, `${where} is not a list`);
  return value;
}

/**
 * A published figure as a positive number. Publishers write them as numbers or as strings, some
 * with a thousands separator (`1,234.56`); a decimal comma is never assumed — a feed whose
 * publisher writes one converts it itself, explicitly.
 */
export function positiveRate(feed: string, value: unknown, where: string): number {
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
  // A comma only where a thousands separator goes: `4,123.45` is read, `4123,45` is refused rather
  // than read as 412345.
  if (!/^(\d+|\d{1,3}(,\d{3})+)(\.\d+)?$/.test(raw)) {
    throw new OfficialRateFormatError(feed, `${where} is not a figure (${JSON.stringify(value)})`);
  }
  const rate = Number(raw.replace(/,/g, ''));
  if (!(rate > 0) || !Number.isFinite(rate)) throw new OfficialRateFormatError(feed, `${where} is not a positive figure (${raw})`);
  return rate;
}

/** `YYYY-MM-DD`, checked to be a real calendar day. */
export function calendarDay(feed: string, year: number, month: number, day: number, where: string): string {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new OfficialRateFormatError(feed, `${where} is not a calendar day (${year}-${month}-${day})`);
  }
  return date.toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` from an ISO-like date or timestamp (`2026-03-14`, `2026-03-14T00:00:00.000`, `2026-03-14 13:04:28.102`). */
export function isoDay(feed: string, value: unknown, where: string): string {
  const match = typeof value === 'string' ? value.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T ])/) : null;
  if (!match) throw new OfficialRateFormatError(feed, `${where} is not a date (${JSON.stringify(value)})`);
  return calendarDay(feed, Number(match[1]), Number(match[2]), Number(match[3]), where);
}

/** `YYYY-MM-DD` from `DD/MM/YYYY`. */
export function dayFromDmy(feed: string, value: unknown, where: string): string {
  const match = typeof value === 'string' ? value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) : null;
  if (!match) throw new OfficialRateFormatError(feed, `${where} is not a DD/MM/YYYY date (${JSON.stringify(value)})`);
  return calendarDay(feed, Number(match[3]), Number(match[2]), Number(match[1]), where);
}

/** `DD/MM/YYYY`… for the publishers that ask in that form. */
export function dmy(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** `MM-DD-YYYY`, as an OData service in the United States' order asks for it. */
export function mdy(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}-${day}-${year}`;
}

/** One figure per currency and day: a publication that states the same day twice is not trusted to say which one counts. */
export function uniqueQuotes(feed: string, quotes: OfficialRateQuote[]): OfficialRateQuote[] {
  const seen = new Map<string, OfficialRateQuote>();
  for (const quote of quotes) {
    const key = `${quote.currency}|${quote.publishedOn}`;
    const earlier = seen.get(key);
    if (earlier && earlier.rate !== quote.rate) {
      throw new OfficialRateFormatError(feed, `two different figures for ${quote.currency} on ${quote.publishedOn}`);
    }
    seen.set(key, quote);
  }
  return [...seen.values()].sort((a, b) => a.publishedOn.localeCompare(b.publishedOn) || a.currency.localeCompare(b.currency));
}

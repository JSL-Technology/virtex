/**
 * Dates and timestamps as the tax authority reads them: in the taxpayer's own time zone.
 *
 * ## The defect this replaces
 *
 * Every fiscal timestamp was produced from the server's local clock — `new Date().getHours()` and
 * friends. Containers run in UTC, and every Latin American market this product targets is behind
 * it, by four hours in the Dominican Republic and up to six elsewhere. So an e-CF signed at 20:30
 * in Santo Domingo carried `FechaHoraFirma` of 00:30 on the FOLLOWING day: a signature dated after
 * the comprobante's own emission date, which the DGII rejects, and a sale that lands in the next
 * month's 607 whenever it is made in the evening of the last day of a month.
 *
 * `Intl.DateTimeFormat` with an explicit zone is used rather than arithmetic on UTC offsets because
 * the offset is not a constant: Chile, Paraguay and parts of Mexico observe daylight saving, and a
 * hardcoded −4 is wrong for half the year.
 */

import { findCountryProfile } from '../localization/fiscal/country-profiles';

/** Fallback when a tenant has no zone recorded. UTC is the honest default: it is never silently wrong by an hour. */
export const DEFAULT_FISCAL_TIME_ZONE = 'UTC';

/** True when the runtime recognises the zone. An unknown zone must not take down an invoice. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function parts(at: Date, timeZone: string): Record<string, string> {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_FISCAL_TIME_ZONE;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const found: Record<string, string> = {};
  for (const part of formatter.formatToParts(at)) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  // `hour12: false` still renders midnight as '24' in some ICU versions; normalise it.
  if (found['hour'] === '24') found['hour'] = '00';
  return found;
}

/** `YYYY-MM-DD` in the taxpayer's zone — the calendar day the operation belongs to. */
export function fiscalDate(timeZone: string, at: Date = new Date()): string {
  const p = parts(at, timeZone);
  return `${p['year']}-${p['month']}-${p['day']}`;
}

/** `DD-MM-YYYY`, the date format every DGII e-CF element uses. */
export function dgiiDate(timeZone: string, at: Date = new Date()): string {
  const p = parts(at, timeZone);
  return `${p['day']}-${p['month']}-${p['year']}`;
}

/** `DD-MM-YYYY HH:mm:ss`, the format of `FechaHoraFirma` and the lifecycle messages' stamps. */
export function dgiiTimestamp(timeZone: string, at: Date = new Date()): string {
  const p = parts(at, timeZone);
  return `${p['day']}-${p['month']}-${p['year']} ${p['hour']}:${p['minute']}:${p['second']}`;
}

/** Re-render an ISO or `YYYY-MM-DD` date as `DD-MM-YYYY` without moving it across a zone. */
export function isoToDgiiDate(iso: string): string {
  const [date] = iso.split('T');
  const [year, month, day] = date.split('-');
  return `${day}-${month}-${year}`;
}

/** The identifying fields of a tenant, without dragging the entity into a pure module. */
export interface TimeZoneBearingOrganization {
  country?: string | null;
  timezone?: string | null;
}

/**
 * The zone a tenant's fiscal dates are read in.
 *
 * `organizations.timezone` defaults to `'UTC'` and nothing ever set it, so the column was of no use
 * on its own: every tenant, in every market, looked like it kept books in UTC. The country's zone
 * is therefore the effective default, and an explicit tenant value — set by an operator whose
 * office is in a different zone from its country's commercial centre — overrides it.
 */
export function organizationTimeZone(org: TimeZoneBearingOrganization | null | undefined): string {
  if (org?.timezone && org.timezone !== 'UTC') return org.timezone;
  const profile = org?.country ? findCountryProfile(org.country) : undefined;
  return profile?.timeZone ?? DEFAULT_FISCAL_TIME_ZONE;
}

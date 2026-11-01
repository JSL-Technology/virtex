/** The calendar date of an instant in an IANA timezone, as `YYYY-MM-DD`. */
export function calendarDateIn(timeZone: string, at: Date = new Date()): string {
  try {
    // `en-CA` formats as YYYY-MM-DD; the parts are read individually so no locale quirk leaks in.
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(at);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return `${get('year')}-${get('month')}-${get('day')}`;
  } catch {
    // An unknown zone: the browser's own calendar, never UTC.
    const month = `${at.getMonth() + 1}`.padStart(2, '0');
    const day = `${at.getDate()}`.padStart(2, '0');
    return `${at.getFullYear()}-${month}-${day}`;
  }
}

/**
 * The tenant's timezone, as `LocaleStore` last learned it. A plain module value so a form that
 * defaults a date from a function outside Angular's injection context reads the same "today" as
 * one that injects the store.
 */
let tenantTimeZone: string | null = null;

/** Called by `LocaleStore` whenever the tenant context changes. */
export function setTenantTimeZone(timeZone: string | null | undefined): void {
  tenantTimeZone = timeZone || null;
}

/**
 * Today as the company's books read it — the date every document form should default to.
 * Falls back to the browser's zone before a tenant is known (public pages), never to UTC.
 */
export function tenantToday(at: Date = new Date()): string {
  return calendarDateIn(tenantTimeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone, at);
}

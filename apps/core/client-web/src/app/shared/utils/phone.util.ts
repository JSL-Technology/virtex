import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';

/**
 * Phone-number normalization for the browser, using the SAME library the backend validates with
 * (`google-libphonenumber`). This is deliberate: the server's `IsVerificationTarget` /
 * `IsE164PhoneNumber` validators call libphonenumber's `isValidNumber`, so mirroring it here means
 * a number the form accepts is a number the API accepts — no drift, no "valid on screen, rejected
 * on submit".
 *
 * Every public verification and OTP endpoint requires E.164 (`+` followed by the country code and
 * the national number). A human types a national number — `809-555-2671`, `(55) 1234 5678` — so the
 * client is responsible for turning what the user types, together with the country they selected,
 * into E.164 before it ever reaches the network. Doing it anywhere else guarantees the failure this
 * module exists to remove.
 */
const phoneUtil = PhoneNumberUtil.getInstance();

/**
 * Convert a user-typed number to E.164, or return `null` when it is not a valid number for the
 * region.
 *
 * `region` is the ISO 3166-1 alpha-2 code of the selected country (`DO`, `MX`, `US`, …). When the
 * input already carries a leading `+`, libphonenumber reads the country from the number itself and
 * the region is only a fallback, so both national and international input are handled by one path.
 */
export function toE164(input: string | null | undefined, region: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = phoneUtil.parseAndKeepRawInput(raw, (region || '').toUpperCase() || undefined);
    if (!phoneUtil.isValidNumber(parsed)) return null;
    return phoneUtil.format(parsed, PhoneNumberFormat.E164);
  } catch {
    return null;
  }
}

/** True when the input is a valid phone number for the region (i.e. it normalizes to E.164). */
export function isValidPhone(input: string | null | undefined, region: string): boolean {
  return toE164(input, region) !== null;
}

/**
 * The national-format rendering of a number, for display in the input after a value is written back
 * (e.g. restoring a draft that already holds E.164). Falls back to the raw input when it cannot be
 * parsed, so the user never sees their number silently disappear.
 */
export function formatNational(input: string | null | undefined, region: string): string {
  const raw = (input ?? '').trim();
  if (!raw) return '';
  try {
    const parsed = phoneUtil.parseAndKeepRawInput(raw, (region || '').toUpperCase() || undefined);
    return phoneUtil.format(parsed, PhoneNumberFormat.NATIONAL);
  } catch {
    return raw;
  }
}

/** The ISO region a valid E.164 number belongs to (`+1809…` → `DO`), or `null` if undeterminable. */
export function regionForE164(e164: string | null | undefined): string | null {
  const raw = (e164 ?? '').trim();
  if (!raw) return null;
  try {
    const parsed = phoneUtil.parse(raw);
    return phoneUtil.getRegionCodeForNumber(parsed) ?? null;
  } catch {
    return null;
  }
}

/** The numeric calling code for a region (`DO` → `1`, `MX` → `52`), or `''` if unknown. */
export function callingCodeForRegion(region: string): string {
  try {
    const code = phoneUtil.getCountryCodeForRegion((region || '').toUpperCase());
    return code ? String(code) : '';
  } catch {
    return '';
  }
}

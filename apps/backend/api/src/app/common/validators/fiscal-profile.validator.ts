import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { findCountryProfile } from '../../localization/fiscal/country-profiles';
import { validateTaxId } from '../../localization/fiscal/tax-id-validators';

/**
 * Fiscal validation for the registration payload.
 *
 * What this replaces mattered: the previous constraint loaded a `FiscalRegion` row, asked its
 * strategy to validate, and returned `true` whenever the tax id or the region id was absent — so
 * omitting `fiscalRegionId` skipped fiscal validation entirely, and the "generic" strategy it
 * would otherwise have reached accepted every string. A tenant could be created with a tax id of
 * `"1"`, and the first anyone heard of it was a rejected electronic invoice.
 *
 * These constraints are synchronous and depend on nothing but the country profile: no database
 * round-trip, no injectable, no network. That is deliberate. A validation rule that can fail open
 * because a query returned nothing is not a validation rule.
 */

/** Reads the country code off the object being validated, whatever it is nested under. */
function countryOf(args: ValidationArguments): string {
  return (args.object as { countryCode?: string }).countryCode ?? '';
}

@ValidatorConstraint({ name: 'isSupportedCountry', async: false })
export class SupportedCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && Boolean(findCountryProfile(value));
  }

  defaultMessage(): string {
    return 'Ese país todavía no está disponible para registro.';
  }
}

export function IsSupportedCountry(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: SupportedCountryConstraint,
    });
}

@ValidatorConstraint({ name: 'isTaxIdValidForCountry', async: false })
export class TaxIdForCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    // An unsupported country is reported by its own constraint; reporting it twice just produces
    // two error messages about the same field.
    if (!findCountryProfile(countryOf(args))) return true;
    return validateTaxId(countryOf(args), value);
  }

  defaultMessage(args: ValidationArguments): string {
    const profile = findCountryProfile(countryOf(args));
    if (!profile) return 'El identificador fiscal no es válido.';
    return `El ${profile.taxId.label} no es válido. Verifica el dígito verificador (ejemplo: ${profile.taxId.example}).`;
  }
}

export function IsTaxIdValidForCountry(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: TaxIdForCountryConstraint,
    });
}

/**
 * The first-level administrative division, where the country publishes a coded catalogue.
 *
 * Only the United States, Mexico and the Dominican Republic carry `divisions` today; for the rest
 * a free-text division is accepted, because inventing a code list that the tax authority does not
 * publish would reject valid addresses.
 */
@ValidatorConstraint({ name: 'isStateValidForCountry', async: false })
export class StateForCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const profile = findCountryProfile(countryOf(args));
    if (!profile) return true;
    if (typeof value !== 'string' || !value.trim()) return false;
    if (!profile.address.divisions) return true;
    return profile.address.divisions.some((d) => d.code === value.trim().toUpperCase());
  }

  defaultMessage(args: ValidationArguments): string {
    const profile = findCountryProfile(countryOf(args));
    return `Selecciona ${profile ? `un valor válido para ${profile.address.divisionLabel}` : 'una división administrativa válida'}.`;
  }
}

export function IsStateValidForCountry(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: StateForCountryConstraint,
    });
}

/**
 * The postal code, where the country requires one.
 *
 * `postalCodeRequired` is not cosmetic: United States sales tax is destination-based and cannot be
 * computed without a ZIP, and CFDI 4.0 rejects a document whose issuer has no `LugarExpedicion`.
 * Where a country does not require one, an empty value passes and a present one is still checked
 * against the country's shape, so a Mexican five-digit code cannot be stored for Brazil.
 */
@ValidatorConstraint({ name: 'isPostalCodeValidForCountry', async: false })
export class PostalCodeForCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const profile = findCountryProfile(countryOf(args));
    if (!profile) return true;

    const provided = typeof value === 'string' ? value.trim() : '';
    if (!provided) return !profile.address.postalCodeRequired;
    if (!profile.address.postalCodePattern) return true;

    return new RegExp(profile.address.postalCodePattern).test(provided.toUpperCase());
  }

  defaultMessage(args: ValidationArguments): string {
    const profile = findCountryProfile(countryOf(args));
    if (!profile) return 'El código postal no es válido.';
    return `El ${profile.address.postalCodeLabel} no es válido para ${profile.name}.`;
  }
}

export function IsPostalCodeValidForCountry(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: PostalCodeForCountryConstraint,
    });
}

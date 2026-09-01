import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import {
    findCountryProfile,
    validateFiscalFields,
    type TaxpayerKindValue,
} from '../../localization/fiscal/country-profiles';
import {
    TaxpayerKind,
    taxpayerKindAffectsValidation,
    validateTaxId,
} from '../../localization/fiscal/tax-id-validators';

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

/**
 * A validation message, as a key and its parameters.
 *
 * `defaultMessage` has to return a string, and these messages are country-specific: they name the
 * local identifier ("RNC", "RFC", "CNPJ") and the local word for a first-level division
 * ("Provincia", "Estado", "Departamento"). Those terms follow the COUNTRY and stay as the
 * authority writes them — a Portuguese-speaking accountant registering a Dominican company is
 * still filling in an RNC for a Provincia. The sentence around them follows the READER, so it
 * travels as a key and is resolved by the validation exception factory.
 */
function message(key: string, params: Record<string, unknown> = {}): string {
  return Object.keys(params).length === 0 ? key : `${key}|${JSON.stringify(params)}`;
}

/** Reads the country code off the object being validated, whatever it is nested under. */
function countryOf(args: ValidationArguments): string {
  return (args.object as { countryCode?: string }).countryCode ?? '';
}

/** Reads the declared taxpayer kind, when the payload carries one. */
function kindOf(args: ValidationArguments): TaxpayerKind | undefined {
  const declared = (args.object as { taxpayerKind?: string }).taxpayerKind;
  return declared === TaxpayerKind.COMPANY || declared === TaxpayerKind.INDIVIDUAL
    ? (declared as TaxpayerKind)
    : undefined;
}

@ValidatorConstraint({ name: 'isSupportedCountry', async: false })
export class SupportedCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && Boolean(findCountryProfile(value));
  }

  defaultMessage(): string {
    return message('VALIDATION.FISCAL.COUNTRY_NOT_AVAILABLE');
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
    // The taxpayer kind is passed through so a country that issues a different identifier to
    // companies and to natural persons — an EIN versus an SSN, a CNPJ versus a CPF, a 12- versus
    // a 13-character RFC — is checked against the right one. Without it the validator has to
    // accept the union of both schemes, which is materially weaker: a nine-digit United States
    // number is simultaneously a valid EIN and an un-issuable SSN, and with no context the only
    // safe verdict is "accepted".
    return validateTaxId(countryOf(args), value, kindOf(args));
  }

  defaultMessage(args: ValidationArguments): string {
    const country = countryOf(args);
    const profile = findCountryProfile(country);
    if (!profile) return message('VALIDATION.FISCAL.TAX_ID_INVALID');

    // The kind note is a separate key rather than a suffix on this one: where the country's
    // algorithm distinguishes a company identifier from an individual's, telling the reader
    // which one was expected is the whole content of the message.
    if (taxpayerKindAffectsValidation(country) && kindOf(args)) {
      return message(
        kindOf(args) === TaxpayerKind.COMPANY
          ? 'VALIDATION.FISCAL.TAX_ID_INVALID_FOR_COMPANY'
          : 'VALIDATION.FISCAL.TAX_ID_INVALID_FOR_INDIVIDUAL',
        { label: profile.taxId.label, example: profile.taxId.example },
      );
    }

    return message('VALIDATION.FISCAL.TAX_ID_INVALID_FOR_COUNTRY', {
      label: profile.taxId.label,
      example: profile.taxId.example,
    });
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
    return profile
      ? message('VALIDATION.FISCAL.DIVISION_INVALID_FOR_COUNTRY', {
          label: profile.address.divisionLabel,
        })
      : message('VALIDATION.FISCAL.DIVISION_INVALID');
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
    if (!profile) return message('VALIDATION.FISCAL.POSTAL_CODE_INVALID');
    return message('VALIDATION.FISCAL.POSTAL_CODE_INVALID_FOR_COUNTRY', {
      label: profile.address.postalCodeLabel,
      country: profile.name,
    });
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


/**
 * The country's extra fiscal answers — régimen fiscal, condición frente al IVA, CRT, giro…
 *
 * Validated here rather than field by field because which fields exist, and which options each
 * one admits, depends on the country AND on whether the taxpayer is a company or a natural
 * person. Encoding that as separate decorators would mean one decorator per country per field.
 */
@ValidatorConstraint({ name: 'isFiscalProfileValidForCountry', async: false })
export class FiscalProfileForCountryConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    const country = countryOf(args);
    if (!findCountryProfile(country)) return true;
    if (value !== undefined && (typeof value !== 'object' || value === null || Array.isArray(value))) {
      return false;
    }
    const kind = kindOf(args) as TaxpayerKindValue | undefined;
    // Values may be strings OR arrays: a country whose authority admits several answers at once
    // — Colombia's `responsabilidades fiscales` — posts a list. `validateFiscalFields` accepts
    // both shapes, so nothing is coerced here; coercing is how a list would silently become the
    // string "O-13,O-23" and then fail an option check.
    return (
      validateFiscalFields(country, kind, (value ?? {}) as Record<string, unknown>).length === 0
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const country = countryOf(args);
    const kind = kindOf(args) as TaxpayerKindValue | undefined;
    const raw = args.value;
    const values =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const errors = validateFiscalFields(country, kind, values);
    if (errors.length === 0) return message('VALIDATION.FISCAL.PROFILE_INVALID');

    // Each problem is its own key with its own field label; the factory translates them and joins
    // them with `Intl.ListFormat`, so the separator is the reader's, not a hardcoded semicolon.
    const reasons: Record<string, string> = {
      required: 'VALIDATION.FISCAL.FIELD_REQUIRED',
      unknown_option: 'VALIDATION.FISCAL.FIELD_UNKNOWN_OPTION',
      bad_format: 'VALIDATION.FISCAL.FIELD_BAD_FORMAT',
    };

    return message('VALIDATION.FISCAL.PROFILE_INCOMPLETE', {
      details: errors.map((error) => ({
        key: reasons[error.reason] ?? 'VALIDATION.FISCAL.FIELD_NOT_FOR_COUNTRY',
        params: { label: error.label },
      })),
    });
  }
}

export function IsFiscalProfileValidForCountry(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: FiscalProfileForCountryConstraint,
    });
}

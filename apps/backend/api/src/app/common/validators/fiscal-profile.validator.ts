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
    if (!profile) return 'El identificador fiscal no es válido.';
    const kindNote =
      taxpayerKindAffectsValidation(country) && kindOf(args)
        ? ` Verifica también que corresponda a ${kindOf(args) === TaxpayerKind.COMPANY ? 'una empresa' : 'una persona física'}.`
        : '';
    return `El ${profile.taxId.label} no es válido. Verifica el dígito verificador (ejemplo: ${profile.taxId.example}).${kindNote}`;
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
    if (errors.length === 0) return 'Los datos fiscales no son válidos.';

    const describe = (error: (typeof errors)[number]) => {
      switch (error.reason) {
        case 'required':
          return `${error.label} es obligatorio`;
        case 'unknown_option':
          return `${error.label} no es una opción válida`;
        case 'bad_format':
          return `${error.label} no tiene el formato esperado`;
        default:
          return `${error.label} no corresponde a este país`;
      }
    };

    return `Datos fiscales incompletos: ${errors.map(describe).join('; ')}.`;
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

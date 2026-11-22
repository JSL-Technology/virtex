import { registerDecorator, ValidationArguments, ValidationOptions, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';
import { LOCALIZED_NAME_MAX_LENGTH, SUPPORTED_LANGUAGES } from '@virtex/shared/types';

/**
 * A name's translations: `{ en: 'Banks', pt: 'Bancos' }` — the languages the product speaks, each a
 * text of at most `LOCALIZED_NAME_MAX_LENGTH` characters. An empty one says «no translation in that
 * language» and is dropped; any other key, or a value that is not text, is refused.
 */
@ValidatorConstraint({ name: 'isLocalizedName', async: false })
export class IsLocalizedNameConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value as Record<string, unknown>).every(
      ([language, text]) =>
        (SUPPORTED_LANGUAGES as readonly string[]).includes(language) &&
        typeof text === 'string' &&
        text.trim().length <= LOCALIZED_NAME_MAX_LENGTH,
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return `validation.constraints.is_localized_name|${JSON.stringify({ languages: SUPPORTED_LANGUAGES.join(', '), max: LOCALIZED_NAME_MAX_LENGTH })}`;
  }
}

export function IsLocalizedName(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsLocalizedNameConstraint,
    });
  };
}

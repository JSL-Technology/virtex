import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { IdentityDocumentType } from '../entities/employee.entity';

const digitsOnly = (value: string): string => value.replace(/\D/g, '');

/**
 * Dominican cédula check — 11 digits validated by the JCE mod-10 (Luhn) algorithm.
 *
 * A malformed cédula is not caught by any length check but is rejected by the TSS/DGII the moment it
 * reaches a filing, without an error here, so it is validated at the door instead.
 */
export function isValidCedula(raw: string): boolean {
  const cedula = digitsOnly(raw);
  if (cedula.length !== 11) return false;
  let sum = 0;
  for (let i = 0; i < 10; i += 1) {
    let product = Number(cedula[i]) * (i % 2 === 0 ? 1 : 2);
    if (product > 9) product = Math.floor(product / 10) + (product % 10);
    sum += product;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(cedula[10]);
}

/**
 * Dominican RNC check — 9 digits validated by the DGII weighted mod-11 algorithm.
 */
export function isValidRnc(raw: string): boolean {
  const rnc = digitsOnly(raw);
  if (rnc.length !== 9) return false;
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const sum = weights.reduce((acc, weight, i) => acc + weight * Number(rnc[i]), 0);
  const remainder = sum % 11;
  const check = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return check === Number(rnc[8]);
}

/** A passport is not algorithmic; require a plausible alphanumeric length. */
function isValidPassport(raw: string): boolean {
  return /^[A-Za-z0-9]{5,20}$/.test(raw.trim());
}

@ValidatorConstraint({ name: 'identityDocumentForType', async: false })
class IdentityDocumentForTypeConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    if (value === undefined || value === null || value === '') return true; // optional
    if (typeof value !== 'string') return false;
    const type =
      (args.object as { identityDocumentType?: IdentityDocumentType }).identityDocumentType ??
      IdentityDocumentType.CEDULA;
    switch (type) {
      case IdentityDocumentType.CEDULA:
        return isValidCedula(value);
      case IdentityDocumentType.RNC:
        return isValidRnc(value);
      case IdentityDocumentType.PASSPORT:
        return isValidPassport(value);
      default:
        return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const type =
      (args.object as { identityDocumentType?: IdentityDocumentType }).identityDocumentType ??
      IdentityDocumentType.CEDULA;
    return `identityDocument is not a valid ${type}`;
  }
}

/** Validate `identityDocument` against the sibling `identityDocumentType` (cédula/RNC/passport). */
export function IsIdentityDocumentForType(options?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      name: 'identityDocumentForType',
      target: object.constructor,
      propertyName,
      options,
      validator: IdentityDocumentForTypeConstraint,
    });
  };
}

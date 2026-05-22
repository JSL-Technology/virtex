import {
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { PhoneNumberUtil, PhoneNumberFormat } from 'google-libphonenumber';

@ValidatorConstraint({ async: false })
export class IsE164PhoneNumberConstraint implements ValidatorConstraintInterface {
  validate(phoneNumber: string, args: ValidationArguments) {
    if (!phoneNumber) return false;
    try {
      const phoneUtil = PhoneNumberUtil.getInstance();
      // Assume input might be just digits or have + prefix.
      // If it doesn't have +, we can't really validate international without a country code.
      // But typically for strict E.164, it must start with +.
      if (!phoneNumber.startsWith('+')) {
         // If we don't force +, the libphonenumber might need a default region.
         // For now, let's enforce E.164 which implies +.
         return false;
      }
      const number = phoneUtil.parseAndKeepRawInput(phoneNumber);
      return phoneUtil.isValidNumber(number);
    } catch (e) {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments) {
    return 'Phone number must be in E.164 format (e.g. +1234567890) and valid.';
  }
}

export function IsE164PhoneNumber(validationOptions?: ValidationOptions) {
  return function (object: Object, propertyName: string) {
    registerDecorator({
      target: object.constructor,
      propertyName: propertyName,
      options: validationOptions,
      constraints: [],
      validator: IsE164PhoneNumberConstraint,
    });
  };
}

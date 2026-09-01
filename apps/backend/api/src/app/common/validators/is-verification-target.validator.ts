import {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  registerDecorator,
} from 'class-validator';
import { PhoneNumberUtil } from 'google-libphonenumber';

/**
 * The destination of a public verification code, checked against the channel it will travel on.
 *
 * `POST /auth/send-public-verification` has to be unauthenticated — the caller is signing up and
 * has no account — and it forwards `target` to a real email or SMS provider. Accepting an
 * arbitrary string there means the SMS branch will dial anything the body contains, which is how
 * an SMS-pumping campaign turns a signup form into someone else's revenue. Validating the shape
 * costs nothing and removes the whole class of junk before any rate limit has to think about it.
 *
 * The two channels are checked separately because they have nothing in common: an email address is
 * validated by shape, a phone number by libphonenumber's own metadata (E.164, and a number that
 * the country's numbering plan actually issues).
 */
@ValidatorConstraint({ name: 'isVerificationTarget', async: false })
export class VerificationTargetConstraint implements ValidatorConstraintInterface {
  private static readonly EMAIL = /^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/;

  validate(value: unknown, args: ValidationArguments): boolean {
    if (typeof value !== 'string') return false;
    const target = value.trim();
    if (!target) return false;

    const type = String((args.object as { type?: unknown }).type ?? '');

    // The enum member is named for the channel; matching on the substring keeps this validator
    // from having to import the enum and create a cycle with the DTO that declares it.
    if (type.toUpperCase().includes('PHONE')) {
      return VerificationTargetConstraint.isValidE164(target);
    }
    if (type.toUpperCase().includes('EMAIL')) {
      return target.length <= 254 && VerificationTargetConstraint.EMAIL.test(target);
    }

    // An unrecognised channel is reported by the `type` field's own constraint. Refusing here as
    // well would produce two messages about one mistake, but passing would let an unknown channel
    // through unchecked — so require the value to be valid for at least one known channel.
    return (
      VerificationTargetConstraint.isValidE164(target) ||
      VerificationTargetConstraint.EMAIL.test(target)
    );
  }

  private static isValidE164(value: string): boolean {
    if (!value.startsWith('+')) return false;
    try {
      const util = PhoneNumberUtil.getInstance();
      return util.isValidNumber(util.parseAndKeepRawInput(value));
    } catch {
      return false;
    }
  }

  defaultMessage(args: ValidationArguments): string {
    const type = String((args.object as { type?: unknown }).type ?? '').toUpperCase();
    if (type.includes('PHONE')) {
      return 'VALIDATION.CONSTRAINTS.IS_E164_PHONE_NUMBER';
    }
    return 'VALIDATION.CONSTRAINTS.IS_VERIFICATION_TARGET';
  }
}

export function IsVerificationTarget(validationOptions?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [],
      validator: VerificationTargetConstraint,
    });
}

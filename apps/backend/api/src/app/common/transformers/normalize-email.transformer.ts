import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';

/**
 * Canonicalise a contact string to its stored form: trimmed and lower-cased.
 *
 * `class-transformer` runs BEFORE `class-validator`, so the value an email address is validated
 * and later persisted under is already the canonical one. Guarded on `typeof === 'string'` so a
 * malformed payload (a number, an object) still reaches `@IsEmail` and fails there rather than
 * throwing inside the transform.
 */
const toCanonical = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/**
 * Store and look an email up in ONE canonical case.
 *
 * Without it, `Juan.Perez@x.com` and `juan.perez@x.com` are two different rows — `users.email` is
 * a plain `varchar unique`, and PostgreSQL compares it case-sensitively — so the same person can
 * be materialised twice (and charged twice), while a customer who signs up in one case and later
 * signs in in another is told their credentials are invalid. Applied at the DTO boundary it makes
 * registration, login, password recovery, email change, SSO discovery and invitations all agree
 * on the same identity, and it pairs with the unique `LOWER(email)` index that enforces it in the
 * database.
 */
export const NormalizeEmail = () => applyDecorators(Transform(toCanonical));

/**
 * Canonicalise a verification destination that may be an email OR an E.164 phone number.
 *
 * Identical trim + lower-case: an E.164 number is `+` followed by digits only, so lower-casing it
 * is a no-op, while an email is brought into the same canonical case the registration payload
 * carries — so the code stored against a `target` on send is found again on verify, and the
 * pre-verification token's `sub` matches the normalised email the checkout submits.
 */
export const NormalizeContactTarget = () => applyDecorators(Transform(toCanonical));

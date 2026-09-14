import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/transformers/normalize-email.transformer';

export class RequestEmailChangeDto {
  // Canonicalised so the new address collides with an existing one under the same rule the
  // unique LOWER(email) index enforces — `Nuevo@x.com` cannot slip past a stored `nuevo@x.com`.
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254, { message: 'validation.constraints.max_length|{"max":254}' })
  newEmail!: string;

  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}

export class ConfirmEmailChangeDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}


/**
 * An administrator changing another user's address.
 *
 * A DTO, not `@Body('email')`. TypeScript types are erased at runtime, so a bare `@Body('email')`
 * parameter reaches the service as whatever the client sent, bypassing the global ValidationPipe
 * entirely — the service then compensated with a hand-rolled regex that accepted values
 * `@IsEmail` rejects and imposed no length limit at all. The repository had already fixed exactly
 * this shape once, for the user-status endpoint; this one was left behind.
 */
export class AdminChangeEmailDto {
  @NormalizeEmail()
  @IsEmail({}, { message: 'validation.email_change.email_address_not_valid' })
  @IsNotEmpty({ message: 'validation.email_change.email_address_cannot_empty' })
  @MaxLength(254, { message: 'validation.email_change.email_cannot_longer_than_254_characters' })
  email!: string;
}

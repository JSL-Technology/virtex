import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RequestEmailChangeDto {
  @IsEmail()
  @MaxLength(254)
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
  @IsEmail({}, { message: 'El formato del correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico no puede estar vacío.' })
  @MaxLength(254, { message: 'El email no puede tener más de 254 caracteres (RFC 5321).' })
  email!: string;
}

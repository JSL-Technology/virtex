import { IsNotEmpty, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_REGEX, PASSWORD_POLICY_MESSAGE } from './password-policy';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty({ message: 'La contraseña actual no puede estar vacía.' })
  currentPassword: string;

  @IsString()
  @IsNotEmpty({ message: 'La nueva contraseña no puede estar vacía.' })
  @MinLength(PASSWORD_MIN_LENGTH, { message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  @MaxLength(PASSWORD_MAX_LENGTH)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}

import { IsNotEmpty, IsString, MaxLength, MinLength, Matches } from 'class-validator';

// H11 FIX: Apply the same password policy regex as reset-password.dto.ts and register-user.dto.ts.
export const PASSWORD_POLICY_REGEX = /((?=.*\d)|(?=.*\W+))(?![.\n])(?=.*[A-Z])(?=.*[a-z]).*$/;
export const PASSWORD_POLICY_MESSAGE = 'La contraseña debe contener mayúscula, minúscula y un número o símbolo.';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(8, { message: 'La contraseña debe tener al menos 8 caracteres.' })
  @MaxLength(72)
  @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
  newPassword: string;
}

import { IsNotEmpty, IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_POLICY_REGEX, PASSWORD_POLICY_MESSAGE } from './password-policy';

export class ResetPasswordDto {
    @IsString()
    @IsNotEmpty()
    token: string;

    @IsString()
    @IsNotEmpty()
    @MinLength(PASSWORD_MIN_LENGTH, { message: `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.` })
    @MaxLength(PASSWORD_MAX_LENGTH)
    @Matches(PASSWORD_POLICY_REGEX, { message: PASSWORD_POLICY_MESSAGE })
    password: string;
}
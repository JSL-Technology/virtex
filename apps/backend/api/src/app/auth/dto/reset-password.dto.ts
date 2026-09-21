import { IsNotEmpty, IsOptional, IsString, MinLength, MaxLength, Matches } from 'class-validator';
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

    /**
     * The account's second factor, when it has one: a TOTP code or a backup code.
     *
     * Recovery is the one flow that can replace a credential with nothing but access to an
     * inbox. Without this, an attacker holding the mailbox defeats MFA for the purpose of taking
     * over the password — and NIST SP 800-63B §6.1.2.3 asks the verifier to reconfirm the binding
     * to the authenticator during recovery, not only at sign-in.
     *
     * Optional in the DTO and enforced in the service, because whether it is required depends on
     * the account and the DTO is validated before the account is known. A backup code is accepted
     * so that losing the phone does not mean losing the account.
     */
    @IsOptional()
    @IsString()
    @MaxLength(64)
    twoFactorCode?: string;
}
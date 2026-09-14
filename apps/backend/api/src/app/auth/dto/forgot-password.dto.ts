import { IsEmail, IsNotEmpty } from 'class-validator';
import { IsRecaptchaToken } from './recaptcha-token.decorator';
import { NormalizeEmail } from '../../common/transformers/normalize-email.transformer';

export class ForgotPasswordDto {
  // Canonicalised so recovery finds the account regardless of the case the user types.
  @NormalizeEmail()
  @IsEmail({}, { message: 'validation.forgot_password.email_address_not_valid' })
  @IsNotEmpty({ message: 'validation.forgot_password.email_address_cannot_empty' })
  email: string;

  @IsRecaptchaToken()
  recaptchaToken: string;
}
import { IsEmail, IsNotEmpty } from 'class-validator';
import { IsRecaptchaToken } from './recaptcha-token.decorator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'VALIDATION.FORGOT_PASSWORD.FORMATO_CORREO_ELECTRONICO_NO_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.FORGOT_PASSWORD.CORREO_ELECTRONICO_NO_PUEDE_ESTAR_VACIO' })
  email: string;

  @IsRecaptchaToken()
  recaptchaToken: string;
}
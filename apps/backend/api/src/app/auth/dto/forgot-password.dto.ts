import { IsEmail, IsNotEmpty } from 'class-validator';
import { IsRecaptchaToken } from './recaptcha-token.decorator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El formato del correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico no puede estar vacío.' })
  email: string;

  @IsRecaptchaToken()
  recaptchaToken: string;
}
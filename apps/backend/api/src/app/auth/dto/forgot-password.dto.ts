import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail({}, { message: 'El formato del correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico no puede estar vacío.' })
  email: string;

  @IsString()
  @IsNotEmpty({ message: 'El token de reCAPTCHA es obligatorio.' })
  recaptchaToken: string;
}
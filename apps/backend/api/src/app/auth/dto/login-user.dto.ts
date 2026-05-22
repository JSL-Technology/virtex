
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail({}, { message: 'El formato del correo electrónico no es válido.' })
  @IsNotEmpty({ message: 'El correo electrónico no puede estar vacío.' })
  email: string;

  @ApiProperty({ example: 'SecureP@ssw0rd', description: 'User password' })
  @IsString({ message: 'La contraseña debe ser un texto.' })
  @IsNotEmpty({ message: 'La contraseña no puede estar vacía.' })
  password: string;

  @ApiProperty({ example: false, description: 'Remember session', required: false })
  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @ApiProperty({ description: 'Google Recaptcha V3 Token' })
  @IsString()
  @IsNotEmpty({ message: 'El token de reCAPTCHA es obligatorio.' })
  recaptchaToken: string;

  @ApiProperty({ example: '123456', description: '2FA Code if enabled', required: false })
  @IsString()
  @IsOptional()
  twoFactorCode?: string;
}

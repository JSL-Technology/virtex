import { IsRecaptchaToken } from './recaptcha-token.decorator';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  @IsEmail({}, { message: 'VALIDATION.LOGIN_USER.FORMATO_CORREO_ELECTRONICO_NO_VALIDO' })
  @IsNotEmpty({ message: 'VALIDATION.LOGIN_USER.CORREO_ELECTRONICO_NO_PUEDE_ESTAR_VACIO' })
  @MaxLength(254, { message: 'VALIDATION.LOGIN_USER.EMAIL_NO_PUEDE_TENER_MAS_254_CARACTERES_RFC' })
  email: string;

  @ApiProperty({ example: 'SecureP@ssw0rd', description: 'User password' })
  @IsString({ message: 'VALIDATION.LOGIN_USER.CONTRASENA_DEBE_TEXTO' })
  @IsNotEmpty({ message: 'VALIDATION.LOGIN_USER.CONTRASENA_NO_PUEDE_ESTAR_VACIA' })
  password: string;

  @ApiProperty({ example: false, description: 'Remember session', required: false })
  @IsBoolean()
  @IsOptional()
  rememberMe?: boolean;

  @IsRecaptchaToken()
  recaptchaToken: string;

  @ApiProperty({ example: '123456', description: '2FA Code if enabled', required: false })
  @IsString()
  @IsOptional()
  twoFactorCode?: string;
}

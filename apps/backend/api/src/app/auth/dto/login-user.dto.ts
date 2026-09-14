import { IsRecaptchaToken } from './recaptcha-token.decorator';
import { IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/transformers/normalize-email.transformer';
import { ApiProperty } from '@nestjs/swagger';

export class LoginUserDto {
  @ApiProperty({ example: 'user@example.com', description: 'User email address' })
  // Same canonicalisation as registration, so a customer who signed up as `Juan@x.com` still
  // authenticates when their keyboard offers `juan@x.com`.
  @NormalizeEmail()
  @IsEmail({}, { message: 'validation.login_user.email_address_not_valid' })
  @IsNotEmpty({ message: 'validation.login_user.email_address_cannot_empty' })
  @MaxLength(254, { message: 'validation.login_user.email_cannot_longer_than_254_characters' })
  email: string;

  @ApiProperty({ example: 'SecureP@ssw0rd', description: 'User password' })
  @IsString({ message: 'validation.login_user.password_must_text' })
  @IsNotEmpty({ message: 'validation.login_user.password_cannot_empty' })
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

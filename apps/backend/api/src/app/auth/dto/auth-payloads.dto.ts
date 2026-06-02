import { IsString, IsNotEmpty, IsUUID, Length, MaxLength, Matches, IsEmail, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// Fase 2.3: explicit DTOs for endpoints that previously used `@Body('field')` primitives or
// inline-typed `@Body() body: { ... }`. Plain TS types carry no validation metadata, so the
// global ValidationPipe could not whitelist/bound them — arbitrary, oversized payloads passed
// straight through. These DTOs enforce type, length and format so every auth mutation is
// validated and self-documented in Swagger (OWASP ASVS V5; CWE-20).

// E.164 phone format (e.g. +18091234567). Shared with the controller's anti-SMS-bombing checks.
export const E164_PHONE_REGEX = /^\+[1-9]\d{6,14}$/;
const E164_MESSAGE = 'Phone number must be in E.164 format (e.g. +18091234567)';

export class ImpersonateDto {
  @ApiProperty({ description: 'UUID of the user to impersonate', format: 'uuid' })
  @IsUUID()
  userId!: string;
}

export class VerifyEmailCodeDto {
  @ApiProperty({ description: 'Email verification code for 2FA setup', example: '123456' })
  @IsString()
  @Length(4, 12)
  code!: string;
}

export class SendPhoneOtpDto {
  @ApiProperty({ description: 'Destination phone number in E.164 format', example: '+18091234567' })
  @IsString()
  @Matches(E164_PHONE_REGEX, { message: E164_MESSAGE })
  phoneNumber!: string;
}

export class VerifyPhoneOtpDto {
  @ApiProperty({ description: 'OTP code sent via SMS', example: '123456' })
  @IsString()
  @Length(4, 12)
  code!: string;

  @ApiProperty({ description: 'Phone number the OTP was sent to (E.164)', example: '+18091234567' })
  @IsString()
  @Matches(E164_PHONE_REGEX, { message: E164_MESSAGE })
  phoneNumber!: string;
}

export class ConfirmEmailMagicLinkDto {
  // The token is a signed JWT (reg_email_magic_link); bound the length to reject abusive payloads
  // while leaving headroom for legitimately large tokens.
  @ApiProperty({ description: 'Signed registration email magic-link token (JWT)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  token!: string;
}

export class WebAuthnLoginOptionsDto {
  @ApiPropertyOptional({ description: 'Optional email to scope passkey discovery' })
  @IsOptional()
  @IsEmail()
  @MaxLength(320)
  email?: string;
}

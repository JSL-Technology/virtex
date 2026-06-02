import { IsString, Length, IsEnum, IsObject, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationType } from '../entities/verification-code.entity';

// H-03 FIX: tempToken removed — pending session is tracked via httpOnly cookie only.
export class Verify2faDto {
  @ApiProperty({ description: '6-digit MFA code' })
  @IsString()
  @Length(6, 12)
  code!: string;
}

// H-02 FIX: Invitation token submitted in POST body, never in URL path or query string.
// This prevents token leakage in server logs, access logs, browser history, and Referer headers
// (OWASP ASVS 2.1.7; CWE-598; RFC 3986 §3.5).
export class InvitationDetailsDto {
  @ApiProperty({ description: 'SHA-256 invitation token' })
  @IsString()
  @Length(64, 64)
  token!: string;
}

export class SendPublicVerificationDto {
  @ApiProperty({ description: 'Email or phone number' })
  @IsString()
  @Length(3, 320)
  target!: string;

  @ApiProperty({ enum: VerificationType })
  @IsEnum(VerificationType)
  type!: VerificationType;

  @ApiPropertyOptional({ description: 'Google reCAPTCHA v3 response token' })
  @IsOptional()
  @IsString()
  recaptchaToken?: string;
}

export class VerifyPublicCodeDto extends SendPublicVerificationDto {
  @ApiProperty({ description: 'Verification code' })
  @IsString()
  @Length(4, 12)
  code!: string;
}

// H-02 FIX: Accept only planId — never trust client-supplied redirect URLs.
// successUrl/cancelUrl are built server-side from FRONTEND_URL so the backend
// controls the redirect destination (OWASP Unvalidated Redirects and Forwards
// Cheat Sheet; CWE-601 URL Redirection to Untrusted Site).
export class CreateCheckoutSessionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  planId!: string;
}

export class VerifyWebAuthnRegistrationDto {
    @ApiProperty()
    @IsObject()
    credential!: any;
}

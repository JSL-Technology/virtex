import { IsString, Length, IsEnum, IsObject, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationType } from '../entities/verification-code.entity';
import { IsVerificationTarget } from '../../common/validators/is-verification-target.validator';
import { BILLING_PERIODS, type BillingPeriod } from '../../saas/enums/billing-period.enum';

// H-03 FIX: tempToken removed — pending session is tracked via httpOnly cookie only.
export class Verify2faDto {
  @ApiProperty({ description: '6-digit MFA code' })
  @IsString()
  @Length(6, 12, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":6,"max":12}' })
  code!: string;
}

// H-02 FIX: Invitation token submitted in POST body, never in URL path or query string.
// This prevents token leakage in server logs, access logs, browser history, and Referer headers
// (OWASP ASVS 2.1.7; CWE-598; RFC 3986 §3.5).
export class InvitationDetailsDto {
  @ApiProperty({ description: 'SHA-256 invitation token' })
  @IsString()
  @Length(64, 64, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":64,"max":64}' })
  token!: string;
}

export class SendPublicVerificationDto {
  /**
   * Where the code goes: an email address for EMAIL_VERIFY, an E.164 number for PHONE_VERIFY.
   *
   * This was `@IsString() @Length(3, 320, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":320}' })` and nothing else, on an UNAUTHENTICATED endpoint that
   * hands the value straight to Twilio. Any string reached the SMS provider, which is the exact
   * shape of SMS pumping — an operator drives traffic to premium-rate ranges they are paid for and
   * the bill lands on this account. `SmsAbuseGuardService` contains the damage, but the first line
   * of defence is refusing input that is not a phone number at all.
   */
  @ApiProperty({ description: 'Email address or E.164 phone number' })
  @IsString()
  @Length(3, 320, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":3,"max":320}' })
  @IsVerificationTarget()
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
  @Length(4, 12, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":4,"max":12}' })
  code!: string;
}

// H-02 FIX: Accept only planId — never trust client-supplied redirect URLs.
// successUrl/cancelUrl are built server-side from FRONTEND_URL so the backend
// controls the redirect destination (OWASP Unvalidated Redirects and Forwards
// Cheat Sheet; CWE-601 URL Redirection to Untrusted Site).
export class CreateCheckoutSessionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80, { message: 'VALIDATION.CONSTRAINTS.LENGTH|{"min":1,"max":80}' })
  planId!: string;

  /** Monthly or annual. Defaults to monthly. */
  @ApiProperty({ enum: BILLING_PERIODS, required: false, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_PERIODS, { message: 'VALIDATION.SECURITY_AUDIT.PERIODO_FACTURACION_NO_VALIDO' })
  billingPeriod?: BillingPeriod;
}

export class VerifyWebAuthnRegistrationDto {
    @ApiProperty()
    @IsObject()
    credential!: any;
}

import { IsString, Length, IsEnum, IsObject, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationType } from '../entities/verification-code.entity';
import { IsVerificationTarget } from '../../common/validators/is-verification-target.validator';
import { NormalizeContactTarget } from '../../common/transformers/normalize-email.transformer';
import { BILLING_PERIODS, type BillingPeriod } from '../../saas/enums/billing-period.enum';

// H-03 FIX: tempToken removed — pending session is tracked via httpOnly cookie only.
export class Verify2faDto {
  @ApiProperty({ description: '6-digit MFA code' })
  @IsString()
  @Length(6, 12, { message: 'validation.constraints.length|{"min":6,"max":12}' })
  code!: string;
}

// H-02 FIX: Invitation token submitted in POST body, never in URL path or query string.
// This prevents token leakage in server logs, access logs, browser history, and Referer headers
// (OWASP ASVS 2.1.7; CWE-598; RFC 3986 §3.5).
export class InvitationDetailsDto {
  @ApiProperty({ description: 'SHA-256 invitation token' })
  @IsString()
  @Length(64, 64, { message: 'validation.constraints.length|{"min":64,"max":64}' })
  token!: string;
}

export class SendPublicVerificationDto {
  /**
   * Where the code goes: an email address for EMAIL_VERIFY, an E.164 number for PHONE_VERIFY.
   *
   * This was `@IsString() @Length(3, 320, { message: 'validation.constraints.length|{"min":3,"max":320}' })` and nothing else, on an UNAUTHENTICATED endpoint that
   * hands the value straight to Twilio. Any string reached the SMS provider, which is the exact
   * shape of SMS pumping — an operator drives traffic to premium-rate ranges they are paid for and
   * the bill lands on this account. `SmsAbuseGuardService` contains the damage, but the first line
   * of defence is refusing input that is not a phone number at all.
   */
  @ApiProperty({ description: 'Email address or E.164 phone number' })
  // Canonicalised so the code stored against this target on send is found on verify, and the
  // pre-verification token's `sub` matches the (equally canonical) email the checkout submits.
  // Lower-casing an E.164 number is a no-op, so a phone target is unaffected.
  @NormalizeContactTarget()
  @IsString()
  @Length(3, 320, { message: 'validation.constraints.length|{"min":3,"max":320}' })
  @IsVerificationTarget()
  target!: string;

  /**
   * The registrant's first name, for the greeting on the verification email.
   *
   * Optional because the endpoint is also used where no name has been given yet. When it is
   * absent the email greets without one rather than inventing a placeholder: it used to be called
   * with the literal `'Usuario'`, so every registration email in the product opened "Hola Usuario"
   * — in Spanish, to a reader who had chosen English, about a person whose name the wizard had
   * collected on the previous step.
   */
  @ApiProperty({ description: 'First name, for the greeting', required: false })
  @IsString()
  @IsOptional()
  @Length(1, 100, { message: 'validation.constraints.length|{"min":1,"max":100}' })
  firstName?: string;

  /**
   * The language the registrant is reading the product in.
   *
   * Decides both the language of the email and the language segment of the magic link inside it.
   * The link was built with no language at all, so it always pointed at `/es/…` — a reader who
   * had chosen English clicked the link in their English-language registration and landed on a
   * Spanish page.
   */
  @ApiProperty({ description: 'Preferred language (ISO 639-1)', required: false })
  @IsString()
  @IsOptional()
  @Length(2, 5, { message: 'validation.constraints.length|{"min":2,"max":5}' })
  language?: string;

  /**
   * The country the registrant is signing up in, for the country segment of the magic link.
   *
   * Defaults to the product's home market when absent, which is what it always did.
   */
  @ApiProperty({ description: 'Country (ISO 3166-1 alpha-2)', required: false })
  @IsString()
  @IsOptional()
  @Length(2, 2, { message: 'validation.constraints.country_code' })
  country?: string;

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
  @Length(4, 12, { message: 'validation.constraints.length|{"min":4,"max":12}' })
  code!: string;
}

// H-02 FIX: Accept only planId — never trust client-supplied redirect URLs.
// successUrl/cancelUrl are built server-side from FRONTEND_URL so the backend
// controls the redirect destination (OWASP Unvalidated Redirects and Forwards
// Cheat Sheet; CWE-601 URL Redirection to Untrusted Site).
export class AuthCreateCheckoutSessionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80, { message: 'validation.constraints.length|{"min":1,"max":80}' })
  planId!: string;

  /** Monthly or annual. Defaults to monthly. */
  @ApiProperty({ enum: BILLING_PERIODS, required: false, default: 'monthly' })
  @IsOptional()
  @IsIn(BILLING_PERIODS, { message: 'validation.security_audit.billing_period_not_valid' })
  billingPeriod?: BillingPeriod;
}

export class VerifyWebAuthnRegistrationDto {
    @ApiProperty()
    @IsObject()
    credential!: any;
}

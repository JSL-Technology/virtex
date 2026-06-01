import { IsString, Length, IsJWT, IsEnum, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VerificationType } from '../entities/verification-code.entity';

export class Verify2faDto {
  @ApiProperty({ description: '6-digit MFA code' })
  @IsString()
  @Length(6, 12)
  code!: string;

  @ApiProperty({ description: 'Temporary token from initial login' })
  @IsJWT()
  tempToken!: string;
}

export class SendPublicVerificationDto {
  @ApiProperty({ description: 'Email or phone number' })
  @IsString()
  @Length(3, 320)
  target!: string;

  @ApiProperty({ enum: VerificationType })
  @IsEnum(VerificationType)
  type!: VerificationType;
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

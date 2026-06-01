import { IsString, Length, IsJWT, IsEnum, IsUrl, Matches, IsObject } from 'class-validator';
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

export class CreateCheckoutSessionDto {
  @ApiProperty()
  @IsString()
  @Length(1, 80)
  planId!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  successUrl!: string;

  @ApiProperty()
  @IsUrl({ require_tld: false })
  cancelUrl!: string;
}

export class VerifyWebAuthnRegistrationDto {
    @ApiProperty()
    @IsObject()
    credential!: any;
}

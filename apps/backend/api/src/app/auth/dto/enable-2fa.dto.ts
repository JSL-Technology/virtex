import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EnableTwoFactorDto {
  @ApiProperty({
    description: 'The TOTP token from the authenticator app',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

  // H-05 FIX: Require current password as step-up when enabling 2FA to prevent
  // an attacker with a stolen session from registering their own TOTP device
  // (NIST SP 800-63B §4.2; OWASP ASVS 2.2.2; CWE-306).
  @ApiProperty({ description: 'Current account password for step-up verification' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;
}

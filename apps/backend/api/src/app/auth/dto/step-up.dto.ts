import { IsEnum, IsNotEmpty, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { StepUpScope } from '../enums/step-up-scope.enum';

/**
 * Re-authenticate for a specific sensitive action.
 *
 * Both factors are optional in the payload and neither is trusted to decide anything: the server
 * looks at the account and requires the strongest factor it holds — a TOTP or backup code when
 * 2FA is enabled, the password otherwise. Letting the caller choose would mean an attacker with
 * a stolen session could downgrade a 2FA-protected account to a password they had phished.
 */
export class StepUpDto {
  @ApiProperty({ enum: StepUpScope, description: 'Action the resulting token may authorise' })
  @IsEnum(StepUpScope, { message: 'Ámbito de verificación no válido.' })
  @IsNotEmpty()
  scope!: StepUpScope;

  @ApiPropertyOptional({ description: 'Account password. Used when 2FA is not enabled.' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional({ description: 'TOTP code or backup code. Used when 2FA is enabled.' })
  @IsOptional()
  @IsString()
  // A 6-digit TOTP or a backup code; both are short, alphanumeric and case-insensitive.
  @Length(6, 32)
  @Matches(/^[A-Za-z0-9-]+$/, { message: 'El código de verificación no es válido.' })
  otpCode?: string;
}

import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** The single-use token from the lockout email (QA C-09). Sent in the body, never in the URL. */
export class UnlockAccountDto {
  @ApiProperty({ description: 'Token from the unlock link' })
  @IsString({ message: 'auth.unlock_link_invalid_or_expired' })
  @IsNotEmpty({ message: 'auth.unlock_link_invalid_or_expired' })
  @MaxLength(256, { message: 'auth.unlock_link_invalid_or_expired' })
  token: string;
}

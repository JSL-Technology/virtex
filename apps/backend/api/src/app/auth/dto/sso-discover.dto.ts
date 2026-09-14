import { IsEmail, MaxLength } from 'class-validator';
import { NormalizeEmail } from '../../common/transformers/normalize-email.transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for the Home Realm Discovery endpoint: the user types their work email, and the
 * server replies whether an enterprise SSO connection exists for that domain.
 */
export class SsoDiscoverDto {
  @ApiProperty({ example: 'jane@acme.com' })
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(254, { message: 'validation.constraints.max_length|{"max":254}' })
  email: string;
}

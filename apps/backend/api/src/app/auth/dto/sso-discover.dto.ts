import { IsEmail, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Body for the Home Realm Discovery endpoint: the user types their work email, and the
 * server replies whether an enterprise SSO connection exists for that domain.
 */
export class SsoDiscoverDto {
  @ApiProperty({ example: 'jane@acme.com' })
  @IsEmail()
  @MaxLength(254)
  email: string;
}

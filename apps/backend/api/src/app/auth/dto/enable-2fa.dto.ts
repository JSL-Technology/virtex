import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Confirm a staged TOTP secret.
 *
 * Deliberately carries ONLY the code. Re-authentication is `StepUpGuard`'s job — the route
 * declares `@StepUp(StepUpScope.ENABLE_2FA)` and the guard runs before this payload is read.
 * A `currentPassword` field here used to be mandatory as well, which broke the feature for
 * every account (the client has no password to send after step-up) and made it unreachable
 * for federated identities, which have no local password at all.
 */
export class EnableTwoFactorDto {
  @ApiProperty({
    description: 'The TOTP token from the authenticator app',
    example: '123456',
  })
  @IsString()
  @IsNotEmpty()
  token!: string;

}

import { ApiProperty } from '@nestjs/swagger';
import { UserResponseDto } from '../user-response.dto';

/**
 * The answer to "what session does this browser have?" — the SPA's entire bootstrap contract.
 *
 * Every field is here so the client never has to guess by probing. It used to guess: it asked a
 * protected endpoint, read 401 as "maybe my access token just expired", and fired a refresh to
 * find out. For a visitor who had simply never signed in, both requests were errors, and the
 * login screen greeted every user with a red console.
 */
export class SessionResponseDto {
  @ApiProperty({
    description: 'True when a valid access token accompanied the request.',
    example: false,
  })
  authenticated: boolean;

  @ApiProperty({
    type: UserResponseDto,
    nullable: true,
    description: 'The signed-in principal, or null when there is no session.',
  })
  user: UserResponseDto | null;

  @ApiProperty({
    description:
      'True when the browser still holds a refresh token, so `POST /auth/refresh` is worth ' +
      'attempting. False means signed out: the client must not call refresh, because it can ' +
      'only fail. Always false while `authenticated` is true — there is nothing to renew yet.',
    example: false,
  })
  refreshable: boolean;
}

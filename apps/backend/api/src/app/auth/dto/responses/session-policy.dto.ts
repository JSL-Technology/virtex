import { ApiProperty } from '@nestjs/swagger';
import { AuthConfig } from '../../auth.config';

/**
 * The rules the current session lives under, so the client enforces the SAME ones as the server.
 *
 * The client used to hard-code a fifteen-minute inactivity sign-out that the server knew nothing
 * about — and applied it whether or not the person had asked to be remembered. The server now
 * decides, from the session's own "remember me" fact, and tells the client.
 */
export class SessionPolicyDto {
  @ApiProperty({
    description:
      'True when the person chose "remember me": the session survives the browser closing and ' +
      'is not ended for short inactivity.',
  })
  persistent!: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Milliseconds without activity after which the client must sign out (warning first). ' +
      'Null for a remembered session, which is not signed out for inactivity.',
  })
  inactivityTimeoutMs!: number | null;

  static for(rememberMe: boolean): SessionPolicyDto {
    return {
      persistent: rememberMe,
      inactivityTimeoutMs: rememberMe ? null : AuthConfig.SESSION_CLIENT_IDLE_TIMEOUT,
    };
  }
}

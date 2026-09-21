import {
  Controller,
  Post,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Param,
  Ip,
} from '@nestjs/common';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { PERMISSIONS } from '../shared/permissions';
import { AuthenticatedUser } from '../security/principal';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';

/**
 * Session (device) management: list the active sessions and revoke them.
 *
 * Split out of the monolithic `AuthController` so each cohesive slice of the auth surface owns its
 * own file. Every route keeps the exact guards, scopes and throttles it carried before.
 *
 * `@AllowInactiveSubscription` for the same reason the rest of authentication carries it: ending a
 * session is a security control, not a paid feature, and must work for a tenant whose subscription
 * has lapsed.
 */
@ApiTags('Auth')
@AllowInactiveSubscription()
@Controller('auth')
@AuthenticatedOnly(
  'Listing and revoking your own sessions. This is the screen a person opens when they suspect\n' +
  'someone else is signed in as them; gating it behind a role would lock the door from inside.\n' +
  'Revoking ANOTHER user\'s session lives in UsersController and declares USERS_SESSIONS_REVOKE.',
)
export class AuthSessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditTrailService: AuditTrailService,
  ) {}

  @Get('sessions')
  @ApiOperation({ summary: 'List active sessions (devices)' })
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async getUserSessions(@CurrentUser() user: AuthenticatedUser) {
      // The current session comes from the access token's `sessionId` claim.
      //
      // This previously decoded the refresh-token cookie to read its `jti`, which could never
      // work: that cookie is path-scoped to /api/v1/auth/refresh, so the browser does not send it
      // to this endpoint. `currentRefreshTokenId` was therefore always undefined and every row
      // rendered with isCurrent=false, leaving the user unable to tell which device they were on.
      // The claim is always present and, since the session-family change, stable across rotation.
      return this.authService.getUserSessions(user.id, user.sessionId);
  }

  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke every session except the current one' })
  async revokeOtherSessions(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    await this.authService.terminateOtherSessions(user.id, user.sessionId);
    await this.auditTrailService.record(
      user.id, 'Session', user.id, ActionType.DELETE,
      { action: 'revoke-other-sessions' }, undefined, ip, user.organizationId,
    );
    return { messageKey: 'auth.other_sessions_have_closed' };
  }

  /**
   * Where a session was opened from, in the clear.
   *
   * The reader that `refresh_tokens.encrypted_ip` did not have. The column was written on every
   * issue and every refresh and read by NOTHING, so the purpose it states — "the encrypted copy
   * exists only for incident forensics" — could not be served: during an actual incident there
   * was no way to get the value out. Personal data collected for a purpose it cannot fulfil is a
   * liability, not a capability.
   *
   * Three gates, because this discloses a real person's address rather than administering an
   * account: a dedicated permission (NOT the one that revokes sessions — ending access and
   * disclosing data are different acts), a single-use step-up token, and an audit entry written
   * whether the read succeeds or fails. The session must belong to a member of the caller's
   * tenant; one that does not exist and one that belongs elsewhere answer identically, so this
   * cannot be used to probe for session ids.
   */
  @Get('sessions/:id/origin')
  @HasPermission(PERMISSIONS.USERS_SESSIONS_FORENSICS)
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.REVEAL_SESSION_ORIGIN)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reveal the IP a session was opened from (incident forensics)' })
  async revealSessionOrigin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
    @Ip() ip: string,
  ) {
    try {
      const origin = await this.authService.revealSessionOrigin(sessionId, user.organizationId);
      await this.auditTrailService.record(
        user.id, 'Session', sessionId, ActionType.READ,
        { action: 'reveal-session-origin', subjectUserId: origin.userId },
        undefined, ip, user.organizationId,
      );
      return origin;
    } catch (e) {
      // Recorded on failure too: an attempt to read somebody's address is worth seeing whether or
      // not it succeeded, and a refusal is exactly the shape probing takes.
      await this.auditTrailService.record(
        user.id, 'Session', sessionId, ActionType.READ,
        { action: 'reveal-session-origin', error: (e as Error).message },
        undefined, ip, user.organizationId,
      );
      throw e;
    }
  }

  @Post('sessions/:id/revoke') // Using POST or DELETE is fine, usually DELETE for resource removal
  @UseGuards(StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) sessionId: string,
    @Ip() ip: string
  ) {
    try {
      const result = await this.authService.revokeSession(user.id, sessionId);
      await this.auditTrailService.record(user.id, 'Session', sessionId, ActionType.DELETE, { action: 'revoke-session' }, undefined, ip, user.organizationId);
      return result;
    } catch (e) {
      await this.auditTrailService.record(user.id, 'Session', sessionId, ActionType.DELETE, { action: 'revoke-session', error: (e as Error).message }, undefined, ip, user.organizationId);
      throw e;
    }
  }
}

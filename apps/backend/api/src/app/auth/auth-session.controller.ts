import {
  Controller,
  Post,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
  Param,
  ParseUUIDPipe,
  Ip,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt/jwt.guard';
import { CsrfGuard } from './guards/csrf.guard';
import { StepUpGuard } from './guards/step-up.guard';
import { StepUp } from './decorators/step-up.decorator';
import { StepUpScope } from './enums/step-up-scope.enum';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AllowInactiveSubscription } from '../saas/decorators/allow-inactive-subscription.decorator';

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
export class AuthSessionController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditTrailService: AuditTrailService,
  ) {}

  @Get('sessions')
  @UseGuards(JwtAuthGuard)
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
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke every session except the current one' })
  async revokeOtherSessions(@CurrentUser() user: AuthenticatedUser, @Ip() ip: string) {
    await this.authService.terminateOtherSessions(user.id, user.sessionId);
    await this.auditTrailService.record(
      user.id, 'Session', user.id, ActionType.DELETE,
      { action: 'revoke-other-sessions' }, undefined, ip, user.organizationId,
    );
    return { messageKey: 'AUTH.HAN_CERRADO_DEMAS_SESIONES' };
  }

  @Post('sessions/:id/revoke') // Using POST or DELETE is fine, usually DELETE for resource removal
  @UseGuards(JwtAuthGuard, CsrfGuard, StepUpGuard)
  @StepUp(StepUpScope.REVOKE_SESSION)
  @ApiOperation({ summary: 'Revoke a specific session' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) sessionId: string,
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


import { Injectable, NotFoundException } from '@nestjs/common';
import { RegisterUserDto } from './dto/register-user.dto';
import { SocialUser } from './interfaces/social-user.interface';
import { SetPasswordFromInvitationDto } from './dto/set-password-from-invitation.dto';
import { User } from '../users/entities/user.entity/user.entity';
import { AuthService } from './auth.service';
import { RegistrationService } from './services/registration.service';
import { PasswordRecoveryService } from './services/password-recovery.service';
import { SocialAuthService } from './services/social-auth.service';
import { TokenService } from './services/token.service';
import { ImpersonationService } from './services/impersonation.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuthEvents, AuthImpersonateEvent } from './events/auth.events';
import { AuthenticatedUser } from '../security/principal';

@Injectable()
export class AuthFacade {
  constructor(
    private readonly authService: AuthService,
    private readonly registrationService: RegistrationService,
    private readonly passwordRecoveryService: PasswordRecoveryService,
    private readonly socialAuthService: SocialAuthService,
    private readonly tokenService: TokenService,
    private readonly impersonationService: ImpersonationService,
    private readonly eventEmitter: EventEmitter2
  ) {}

  /** Payment-first signup: validate + stash a pending registration (no account yet). */
  async createPendingRegistration(registerUserDto: RegisterUserDto, planSlug: string) {
    return this.registrationService.createPendingRegistration(registerUserDto, planSlug);
  }

  async attachSessionToPending(pendingId: string, sessionId: string) {
    return this.registrationService.attachSessionToPending(pendingId, sessionId);
  }

  /** Payment-first signup: materialize the account after payment is confirmed. */
  async completePendingRegistration(
    pendingId: string,
    subscription: Parameters<RegistrationService['completePendingRegistration']>[1]
  ) {
    return this.registrationService.completePendingRegistration(pendingId, subscription);
  }

  async socialLogin(socialUser: SocialUser, ip?: string, userAgent?: string) {
    return this.socialAuthService.validateOAuthLogin(socialUser, ip, userAgent);
  }

  async generateRegisterToken(socialUser: SocialUser): Promise<string> {
    return this.socialAuthService.generateRegisterToken(socialUser);
  }

  async getSocialRegisterInfo(token: string): Promise<SocialUser> {
    return this.socialAuthService.getSocialRegisterInfo(token);
  }

  async setPasswordFromInvitation(dto: SetPasswordFromInvitationDto) {
    const user = await this.passwordRecoveryService.setPasswordFromInvitation(dto);
    const { accessToken, refreshToken, user: safeUser } = await this.tokenService.generateAuthResponse(user);
    return { user: safeUser, accessToken, refreshToken };
  }

  async impersonate(adminUser: AuthenticatedUser, targetUserId: string) {
    const targetUser = await this.impersonationService.validateImpersonationRequest(adminUser, targetUserId);

    this.eventEmitter.emit(
        AuthEvents.IMPERSONATE,
        new AuthImpersonateEvent(adminUser.id, targetUserId, adminUser.email, targetUser.email)
    );

    // The operator's own session ends here. The browser's cookies are about to be replaced by
    // the impersonated ones, so the operator's session would otherwise live on server-side with
    // nothing holding it — an orphan in "active sessions" and a credential nobody is watching.
    // Ending the impersonation issues a fresh session for the operator.
    await this.endSessionQuietly(adminUser.id, adminUser.sessionId);

    // An impersonated session must not be a normal 7-30 day session. It is a short, deliberately
    // expiring window, pinned to the tenant it was authorised in. `TokenService` records both
    // facts on the session itself, so no rotation can drop them.
    return await this.tokenService.generateAuthResponse(
      targetUser,
      {
        isImpersonating: true,
        originalUserId: adminUser.id,
        organizationId: adminUser.organizationId,
      },
    );
  }

  async stopImpersonation(impersonatingUser: AuthenticatedUser) {
    const adminUser = await this.impersonationService.validateStopImpersonation(impersonatingUser);
    // The impersonated session is ended on the server, not just replaced in the browser: its
    // refresh token would otherwise stay valid until the window closed.
    await this.endSessionQuietly(impersonatingUser.id, impersonatingUser.sessionId);
    return await this.tokenService.generateAuthResponse(adminUser);
  }

  /**
   * Revoke one session family, tolerating that it is already gone. Never falls back to ending
   * every session of the user: without a session id there is nothing specific to end.
   */
  private async endSessionQuietly(userId: string, sessionId?: string): Promise<void> {
    if (!sessionId) return;
    try {
      await this.authService.revokeSession(userId, sessionId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
  }

  async generateTokens(user: User, ip?: string, userAgent?: string) {
      return this.tokenService.generateAuthResponse(user, {}, ip, userAgent);
  }
}

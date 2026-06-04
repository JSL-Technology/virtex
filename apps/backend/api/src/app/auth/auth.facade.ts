
import { Injectable } from '@nestjs/common';
import { RegisterUserDto } from './dto/register-user.dto';
import { LoginUserDto } from './dto/login-user.dto';
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

  async login(loginUserDto: LoginUserDto & { twoFactorCode?: string }, ip?: string, userAgent?: string) {
    return this.authService.login(loginUserDto, ip, userAgent);
  }

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

  async register(registerUserDto: RegisterUserDto, ip?: string, userAgent?: string) {
    // H18 FIX: Honeypot silent fail — return a flag without fake tokens.
    // Setting fake tokens as cookies pollutes the client state and can confuse telemetry/UX.
    if (registerUserDto.fax) {
      return {
        honeypot: true,
        user: {
          id: 'fake-id',
          email: registerUserDto.email,
          firstName: registerUserDto.firstName,
          lastName: registerUserDto.lastName,
        } as any,
      };
    }

    // 1. Register User
    const user = await this.registrationService.register(registerUserDto);
    // 2. Create Tokens
    const { accessToken, refreshToken, user: safeUser } = await this.tokenService.generateAuthResponse(user, {}, ip, userAgent);

    return { user: safeUser, accessToken, refreshToken };
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

  async impersonate(adminUser: User, targetUserId: string) {
    const targetUser = await this.impersonationService.validateImpersonationRequest(adminUser, targetUserId);

    this.eventEmitter.emit(
        AuthEvents.IMPERSONATE,
        new AuthImpersonateEvent(adminUser.id, targetUserId, adminUser.email, targetUser.email)
    );

    return await this.tokenService.generateAuthResponse(targetUser, {
      isImpersonating: true,
      originalUserId: adminUser.id,
    });
  }

  async stopImpersonation(impersonatingUser: User) {
    const adminUser = await this.impersonationService.validateStopImpersonation(impersonatingUser);
    return await this.tokenService.generateAuthResponse(adminUser);
  }

  async generateTokens(user: User, ip?: string, userAgent?: string) {
      return this.tokenService.generateAuthResponse(user, {}, ip, userAgent);
  }
}

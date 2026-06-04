
import {
  Injectable,
  UnauthorizedException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import * as crypto from 'crypto';

import { LoginUserDto } from './dto/login-user.dto';
import { User, UserStatus } from '../users/entities/user.entity/user.entity';
import { JwtPayload } from './interfaces/jwt-payload.interface';
import { AuthConfig } from './auth.config';
import { UsersService } from '../users/users.service';
import { SessionService } from './services/session.service';
import { SecurityAnalysisService } from './services/security-analysis.service';
import { TokenService } from './services/token.service';
import { MfaOrchestratorService } from './services/mfa-orchestrator.service';
import { PasswordService } from './services/password.service';
import { AuditTrailService } from '../audit/audit.service';
import { ActionType } from '../audit/entities/audit-log.entity';
import { AuthEvents, AuthLoginFailedEvent, AuthLoginSuccessEvent } from './events/auth.events';
import { SafeUser, AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuthError } from './enums/auth-error.enum';
import { AuthException } from './exceptions/auth.exception';
import { LoginResultDto, LoginResponseDto, TwoFactorRequiredResponseDto } from './dto/login-response.dto';

export type LoginResult = LoginResultDto;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private static readonly PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly PENDING_MAX_ATTEMPTS = 5;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly tokenService: TokenService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly passwordService: PasswordService,
    private readonly auditService: AuditTrailService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
  ) {}

  async login(loginUserDto: LoginUserDto & { twoFactorCode?: string }, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    const { email, password, twoFactorCode, rememberMe } = loginUserDto;
    const correlationId = crypto.randomUUID();

    const user = await this.usersService.findUserForAuth(email);

    if (user && user.security && user.security.lockoutUntil && new Date() < user.security.lockoutUntil) {
      throw new AuthException(AuthError.USER_BLOCKED, 401, {
        lockoutUntil: user.security.lockoutUntil
      });
    }

    let isPasswordValid = false;
    if (user && user.security && user.security.passwordHash) {
        isPasswordValid = await this.passwordService.verify(user.security.passwordHash, password);
    } else {
        await this.passwordService.verifyDummy(password);
        isPasswordValid = false;
    }

    if (!user || !isPasswordValid) {
          if (user) {
              await this.securityAnalysisService.handleFailedLoginAttempt(user);
              this.eventEmitter.emit(
                  AuthEvents.LOGIN_FAILED,
                  new AuthLoginFailedEvent(user.id, user.email, 'Invalid Credentials', ipAddress, userAgent, correlationId)
              );
          }
          await this.simulateDelay();
          throw new AuthException(AuthError.INVALID_CREDENTIALS);
    }

    if (user.status !== UserStatus.ACTIVE) {
       this.eventEmitter.emit(
           AuthEvents.LOGIN_FAILED,
           new AuthLoginFailedEvent(user.id, user.email, 'User Inactive/Blocked', ipAddress, userAgent, correlationId)
       );

       if (user.status === UserStatus.BLOCKED) {
           throw new AuthException(AuthError.USER_BLOCKED);
       } else {
           throw new AuthException(AuthError.USER_INACTIVE);
       }
    }

    // 2FA Check
    if (user.security && user.security.isTwoFactorEnabled) {
      if (!twoFactorCode) {
         // H-03 FIX: Store pending 2FA state server-side in cache; never return a bearer
         // tempToken to JavaScript. The pendingId is delivered only via an httpOnly cookie,
         // eliminating XSS-based session-hijacking (OWASP MFA Cheat Sheet; OWASP ASVS 2.8/3.4; CWE-922).
         const pendingId = await this.create2faPendingSession(user, ipAddress, userAgent);

         if (user.isPhoneVerified && user.phone) {
             await this.mfaOrchestratorService.sendLoginOtp(user);
         }

         return {
            require2fa: true,
            pendingId,
            message: '2FA verification required'
         };
      }

      const result = await this.mfaOrchestratorService.complete2faLogin(user, twoFactorCode, ipAddress, userAgent);
      await this.securityAnalysisService.checkImpossibleTravel(user.id, ipAddress);

    // Explicitly construct the result to satisfy type system without casting
    return {
        user: result.user,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        refreshTokenId: result.refreshTokenId
    };
    }

    await this.securityAnalysisService.checkImpossibleTravel(user.id, ipAddress);

    await this.securityAnalysisService.resetLoginAttempts(user);

    this.eventEmitter.emit(
        AuthEvents.LOGIN_SUCCESS,
        new AuthLoginSuccessEvent(user.id, user.email, ipAddress, userAgent, correlationId)
    );

    const authResponse = await this.tokenService.generateAuthResponse(user, {}, ipAddress, userAgent, rememberMe);
  return {
      user: authResponse.user,
      accessToken: authResponse.accessToken,
      refreshToken: authResponse.refreshToken,
      refreshTokenId: authResponse.refreshTokenId
  };
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    return this.tokenService.validateTokenAndGetUser(payload);
  }

  private async simulateDelay() {
    return new Promise((resolve) => setTimeout(resolve, AuthConfig.SIMULATED_DELAY_MS));
  }

  async refreshAccessToken(token: string, ipAddress?: string, userAgent?: string) {
    return this.sessionService.refreshAccessToken(token, ipAddress, userAgent);
  }

  async status(userFromJwt: AuthenticatedUser) {
    // We delegate status retrieval to TokenService as well, or just use what we have.
    // However, status often requires a fresh check.
    // Since we removed userCacheService injection, we need to decide:
    // 1. Re-inject UserCacheService (but this defeats the refactor purpose if TokenService handles validation)
    // 2. Move status logic to TokenService (best).
    return this.tokenService.getFreshUserStatus(userFromJwt);
  }

  async logoutCurrentSession(userId: string, sessionId?: string): Promise<void> {
    await this.sessionService.terminateCurrentSession(userId, sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    await this.sessionService.terminateAllSessions(userId);
  }

  async getUserSessions(userId: string, currentRefreshTokenId?: string) {
    return this.sessionService.getUserSessions(userId, currentRefreshTokenId);
  }

  async revokeSession(userId: string, sessionId: string) {
    return this.sessionService.revokeSession(userId, sessionId);
  }

  async verifyUserFromToken(token: string): Promise<User | null> {
    return this.sessionService.verifyUserFromToken(token);
  }

  async create2faPendingSession(user: User, ipAddress?: string, userAgent?: string): Promise<string> {
    const pendingId = crypto.randomUUID();
    const ipHash = ipAddress
      ? crypto.createHash('sha256').update(ipAddress).digest('hex').slice(0, 16)
      : 'unknown';
    const uaHash = userAgent
      ? crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 16)
      : 'unknown';

    await this.cacheManager.set(
      `2fa_pending:${pendingId}`,
      {
        userId: user.id,
        tokenVersion: user.security?.tokenVersion ?? 0,
        ipHash,
        uaHash,
        attempts: 0,
        expiresAt: Date.now() + AuthService.PENDING_TTL_MS,
      },
      AuthService.PENDING_TTL_MS,
    );
    return pendingId;
  }

  async consume2faPendingSession(
    pendingId: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<User> {
    const key = `2fa_pending:${pendingId}`;
    const session = await this.cacheManager.get<{
      userId: string;
      tokenVersion: number;
      ipHash: string;
      uaHash: string;
      attempts: number;
      expiresAt: number;
    }>(key);

    if (!session || Date.now() > session.expiresAt) {
      throw new UnauthorizedException('Invalid or expired 2FA session');
    }

    if (session.attempts >= AuthService.PENDING_MAX_ATTEMPTS) {
      await this.cacheManager.del(key);
      throw new UnauthorizedException('Too many 2FA attempts — please log in again');
    }

    const currentIpHash = ipAddress
      ? crypto.createHash('sha256').update(ipAddress).digest('hex').slice(0, 16)
      : 'unknown';

    if (session.ipHash !== 'unknown' && currentIpHash !== 'unknown' && session.ipHash !== currentIpHash) {
      this.logger.warn(`[SECURITY] 2FA pending session IP mismatch. Invalidating session.`);
      await this.cacheManager.del(key);
      throw new UnauthorizedException('Session context changed — please log in again');
    }

    const user = await this.usersService.findUserByIdForAuth(session.userId);
    if (!user || !user.security) {
      await this.cacheManager.del(key);
      throw new UnauthorizedException('User not found');
    }

    if ((user.security.tokenVersion ?? 0) !== session.tokenVersion) {
      await this.cacheManager.del(key);
      throw new UnauthorizedException('Session invalidated — please log in again');
    }

    // Consume the session (single-use)
    await this.cacheManager.del(key);
    return user;
  }

  async verifyPassword(userId: string, plain: string, scope: string): Promise<string> {
      const rateLimitKey = `step-up-rate-limit:${userId}`;
      const attempts = await this.cacheManager.get<number>(rateLimitKey) || 0;

      if (attempts >= 5) {
          throw new AuthException(AuthError.USER_BLOCKED, 429, 'Too many attempts. Please try again in 15 minutes.');
      }

      const user = await this.usersService.findUserByIdForAuth(userId);
      let isValid = false;

      if (user && user.security && user.security.passwordHash) {
          isValid = await this.passwordService.verify(user.security.passwordHash, plain);
      } else {
          await this.passwordService.verifyDummy(plain);
          isValid = false;
      }

      if (!isValid) {
          await this.cacheManager.set(rateLimitKey, attempts + 1, 15 * 60 * 1000);

          await this.auditService.record(
            userId,
            'STEP_UP_VERIFY',
            userId,
            ActionType.LOGIN_FAILED,
            { scope, status: 'failed', attempts: attempts + 1 }
          );

          throw new AuthException(AuthError.INVALID_CREDENTIALS, 401);
      }

      await this.cacheManager.del(rateLimitKey);
      return this.tokenService.generateStepUpToken(userId, scope);
  }

  async changePassword(userId: string, currentPass: string, newPass: string): Promise<void> {
      const userWithSec = await this.usersService.findUserByIdForAuth(userId);

      if (!userWithSec?.security?.passwordHash) {
          throw new AuthException(AuthError.INVALID_CREDENTIALS, 400, 'User has no password set (Social Login?)');
      }

      const isValid = await this.passwordService.verify(userWithSec.security.passwordHash, currentPass);
      if (!isValid) {
          throw new AuthException(AuthError.INVALID_CREDENTIALS, 401, 'Invalid current password');
      }

      const newHash = await this.passwordService.hash(newPass);
      userWithSec.security.passwordHash = newHash;
      userWithSec.security.tokenVersion = (userWithSec.security.tokenVersion || 0) + 1; // Invalidate other sessions

      await this.usersService.save(userWithSec);
      // Revoke ALL sessions on password change — the tokenVersion bump above already invalidates
      // all JWTs; this also removes the refresh tokens from the DB (NIST SP 800-63B §7.1).
      await this.sessionService.terminateAllSessions(userId);
  }
}

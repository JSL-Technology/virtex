
import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ForbiddenException,
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
import { TwoFactorAuthService } from './services/two-factor-auth.service';
import { PasswordService } from './services/password.service';
import { AuthEvents, AuthLoginFailedEvent, AuthLoginSuccessEvent } from './events/auth.events';
import { SafeUser, AuthenticatedUser } from './interfaces/authenticated-user.interface';
import { AuthError } from './enums/auth-error.enum';
import { AuthException } from './exceptions/auth.exception';
import { LoginResultDto } from './dto/login-response.dto';
import { StepUpScope } from './enums/step-up-scope.enum';
import { EnterpriseSsoService } from './services/enterprise-sso.service';
import { OidcProviderService } from './services/oidc-provider.service';
import { AtomicCacheService } from '../cache/atomic-cache.service';

export type LoginResult = LoginResultDto;

/**
 * Which credential the server will accept to re-authenticate this account.
 *
 * `sso` is the case that used to be reported as `none`: an account with no local password and no
 * TOTP secret is not un-verifiable, it is verifiable somewhere else.
 */
export type StepUpFactor = 'otp' | 'password' | 'sso' | 'none';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  private static readonly PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly PENDING_MAX_ATTEMPTS = 5;

  /** Re-authentication attempts allowed per user before a cooling-off period (CWE-307). */
  private static readonly STEP_UP_MAX_ATTEMPTS = 5;
  private static readonly STEP_UP_WINDOW_MS = 5 * 60 * 1000;

  private static stepUpAttemptKey(userId: string): string {
    return `step-up-attempts:${userId}`;
  }

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
    private readonly securityAnalysisService: SecurityAnalysisService,
    private readonly tokenService: TokenService,
    private readonly mfaOrchestratorService: MfaOrchestratorService,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    private readonly passwordService: PasswordService,
    private readonly eventEmitter: EventEmitter2,
    private readonly enterpriseSsoService: EnterpriseSsoService,
    private readonly oidcProviderService: OidcProviderService,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly atomicCache: AtomicCacheService,
  ) {}

  async login(loginUserDto: LoginUserDto & { twoFactorCode?: string }, ipAddress?: string, userAgent?: string): Promise<LoginResult> {
    const { email, password, twoFactorCode, rememberMe } = loginUserDto;
    const correlationId = crypto.randomUUID();

    const user = await this.usersService.findUserForAuth(email);

    // ------------------------------------------------------------------------------------
    // ACCOUNT ENUMERATION
    //
    // The password is verified FIRST, before any account-state check, and every rejection
    // below this point returns the same INVALID_CREDENTIALS error.
    //
    // The previous order leaked account state to anyone who could POST an email address: the
    // lockout check ran before the password check and threw USER_BLOCKED, and inactive accounts
    // threw USER_INACTIVE. An attacker submitting a junk password could therefore map which
    // addresses were registered and which were locked or disabled — useful both for targeting
    // and as confirmation that a stuffing list is landing.
    //
    // Distinct states are still reported, but ONLY to a caller who has already proved they hold
    // the password, at which point they are not learning anything they did not already know.
    // ------------------------------------------------------------------------------------
    const isLockedOut = Boolean(
      user?.security?.lockoutUntil && new Date() < user.security.lockoutUntil,
    );

    let isPasswordValid = false;
    if (user?.security?.passwordHash) {
        isPasswordValid = await this.passwordService.verify(user.security.passwordHash, password);
    } else {
        // Equalise timing so an unknown address is not measurably faster than a real one.
        await this.passwordService.verifyDummy(password);
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

    // Credentials are correct from here on, so revealing account state is safe.
    if (isLockedOut) {
      this.eventEmitter.emit(
          AuthEvents.LOGIN_FAILED,
          new AuthLoginFailedEvent(user.id, user.email, 'Account Locked', ipAddress, userAgent, correlationId)
      );
      throw new AuthException(AuthError.USER_BLOCKED, 401, {
        lockoutUntil: user.security?.lockoutUntil,
      });
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

    // Login is the only moment the plaintext is legitimately available, so it is the only
    // chance to transparently upgrade a hash created under weaker Argon2 parameters.
    await this.upgradePasswordHashIfNeeded(user, password);

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

  /** Revoke every session except the caller's own. */
  async terminateOtherSessions(userId: string, currentSessionId?: string): Promise<void> {
    if (!currentSessionId) {
      // Without a session anchor we cannot single out "the current one"; ending everything is
      // the safe interpretation and forces a clean re-login.
      await this.sessionService.terminateAllSessions(userId);
      return;
    }
    await this.sessionService.terminateOtherSessions(userId, currentSessionId);
  }

  async getUserSessions(userId: string, currentRefreshTokenId?: string) {
    return this.sessionService.getUserSessions(userId, currentRefreshTokenId);
  }

  /**
   * Whether a session was opened with "remember me".
   *
   * It is not in the token — it is in how long the stored row was given — so it is re-derived
   * from the row's own lifetime, the same way `SessionService` does across a rotation. Without
   * it, switching organization silently downgraded a thirty-day session to a seven-day one.
   */
  async isRememberedSession(sessionId?: string): Promise<boolean> {
      if (!sessionId) return false;
      return this.sessionService.isRememberedSession(sessionId);
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

    const currentUaHash = userAgent
      ? crypto.createHash('sha256').update(userAgent).digest('hex').slice(0, 16)
      : 'unknown';

    // Both halves of the binding are enforced. `uaHash` was previously computed and stored when
    // the pending session was created but never compared on consumption, so half the intended
    // device binding did nothing: a stolen pendingId could be redeemed from another browser.
    const ipChanged =
      session.ipHash !== 'unknown' && currentIpHash !== 'unknown' && session.ipHash !== currentIpHash;
    const uaChanged =
      session.uaHash !== 'unknown' && currentUaHash !== 'unknown' && session.uaHash !== currentUaHash;

    if (ipChanged || uaChanged) {
      this.logger.warn(
        { event: '2fa_pending_context_mismatch', ipChanged, uaChanged },
        '[SECURITY] 2FA pending session context changed. Invalidating session.',
      );
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

    // Count this attempt. The session is NOT deleted here.
    //
    // It previously was: `consume2faPendingSession` deleted the entry and only afterwards did the
    // controller verify the OTP. A single mistyped digit therefore destroyed the pending session
    // and forced the user to restart the whole login — and because the entry was gone, the
    // `attempts` counter it carried could never be incremented, making the 5-attempt brute-force
    // limit dead code. The session is now cleared explicitly on SUCCESS, via
    // clear2faPendingSession, and survives a wrong code so the counter can do its job.
    await this.cacheManager.set(
      key,
      { ...session, attempts: session.attempts + 1 },
      Math.max(session.expiresAt - Date.now(), 1000),
    );

    return user;
  }

  /** Invalidate a pending 2FA session once the second factor has actually been verified. */
  async clear2faPendingSession(pendingId: string): Promise<void> {
    await this.cacheManager.del(`2fa_pending:${pendingId}`);
  }

  /**
   * Re-hash a password in place when the stored hash uses weaker parameters than currently
   * configured. Failures are swallowed: an upgrade is an optimisation, never a reason to fail a
   * login the user has already legitimately passed.
   */
  private async upgradePasswordHashIfNeeded(user: User, plainPassword: string): Promise<void> {
    try {
      const hash = user.security?.passwordHash;
      if (!hash || !this.passwordService.needsRehash(hash)) return;

      user.security.passwordHash = await this.passwordService.hash(plainPassword);
      await this.usersService.save(user);
      this.logger.log({ event: 'password_hash_upgraded', userId: user.id }, 'Password hash upgraded to current Argon2 parameters');
    } catch (error) {
      this.logger.warn(`Password hash upgrade failed: ${(error as Error).message}`);
    }
  }

  async changePassword(userId: string, currentPass: string, newPass: string): Promise<void> {
      const userWithSec = await this.usersService.findUserByIdForAuth(userId);

      if (!userWithSec?.security?.passwordHash) {
          throw new AuthException(AuthError.INVALID_CREDENTIALS, 400, { reason: 'no_password_set' });
      }

      const isValid = await this.passwordService.verify(userWithSec.security.passwordHash, currentPass);
      if (!isValid) {
          throw new AuthException(AuthError.INVALID_CREDENTIALS, 401, { reason: 'invalid_current_password' });
      }

      await this.passwordService.assertNotBreached(newPass);
      const newHash = await this.passwordService.hash(newPass);
      userWithSec.security.passwordHash = newHash;
      userWithSec.security.tokenVersion = (userWithSec.security.tokenVersion || 0) + 1; // Invalidate other sessions

      await this.usersService.save(userWithSec);
      // Revoke ALL sessions on password change — the tokenVersion bump above already invalidates
      // all JWTs; this also removes the refresh tokens from the DB (NIST SP 800-63B §7.1).
      await this.sessionService.terminateAllSessions(userId);
  }

  /**
   * Mint a step-up token after re-authenticating the caller with the strongest factor their
   * account actually has.
   *
   * This replaces two mechanisms that did not work together. `StepUpGuard` read a token from an
   * httpOnly cookie, while `TwoFactorVerifiedGuard` expected the raw password or a TOTP code in
   * an `x-reauth-password` / `x-otp-code` request header — headers no client ever sent, so every
   * endpoint it guarded (the whole user-administration surface, plus change-password, disable
   * 2FA, impersonation and session revocation) answered 403 to the real product. The header
   * design was also wrong on its own terms: it put a plaintext password into a header that
   * `pino-http` serialises in full, and it contradicted the rule the rest of the module follows,
   * that a credential capable of authorising these actions never enters JavaScript.
   *
   * There is now one path. The caller proves identity once, at `POST /auth/step-up`, and the
   * proof comes back as an httpOnly cookie the browser attaches by itself.
   *
   * Which factor is required is decided here, not by the caller:
   *   - 2FA enabled  → a TOTP code or a backup code. A password alone is not a second factor.
   *   - otherwise    → the account password.
   *   - neither available (a federated identity with no local password) → refused, with an
   *     instruction to enrol a second factor. Failing open here would leave exactly those
   *     accounts unprotected on the most sensitive operations in the product.
   */
  async createStepUpToken(
      userId: string,
      credentials: { password?: string; otpCode?: string },
      scope: StepUpScope,
  ): Promise<{ stepUpToken: string; maxAgeMs: number }> {
      await this.assertWithinStepUpAttemptBudget(userId);

      const userWithSec = await this.usersService.findUserByIdForAuth(userId);
      if (!userWithSec) {
          throw new UnauthorizedException('Invalid credentials');
      }

      const twoFactorEnabled = Boolean(userWithSec.security?.isTwoFactorEnabled);
      let isValid = false;

      if (twoFactorEnabled) {
          if (!credentials.otpCode) {
              throw new BadRequestException(
                  'Se requiere un código de verificación para confirmar esta acción.',
              );
          }
          isValid = await this.twoFactorAuthService.verifyCode(userWithSec, credentials.otpCode);
      } else if (userWithSec.security?.passwordHash) {
          if (!credentials.password) {
              throw new BadRequestException('Se requiere tu contraseña para confirmar esta acción.');
          }
          isValid = await this.passwordService.verify(
              userWithSec.security.passwordHash,
              credentials.password,
          );
      } else {
          // A federated identity has no local password and no TOTP secret, so there is nothing to
          // verify HERE — but that does not mean it cannot be re-authenticated. It means the proof
          // has to come from the identity provider that owns the account, via
          // `GET /auth/step-up/sso`, which sends the user back to their IdP with `prompt=login`.
          //
          // This used to refuse outright, telling the user to "activar la verificación en dos
          // pasos" — an instruction they could not follow, because enabling 2FA is itself a
          // step-up-gated action. Every SSO-provisioned account was therefore permanently unable
          // to invite a colleague, edit a user, revoke a session, create a subsidiary, open the
          // billing portal, change its own email, or enrol any second factor at all. For a product
          // sold to enterprises, that is the whole enterprise segment with no administration.
          await this.passwordService.verifyDummy(credentials.password ?? '');
          throw new ForbiddenException(
              'Esta cuenta se autentica con tu proveedor de identidad. Confirma la acción volviendo a iniciar sesión con él.',
          );
      }

      if (!isValid) {
          throw new UnauthorizedException(
              twoFactorEnabled ? 'Código de verificación inválido.' : 'Contraseña incorrecta.',
          );
      }

      // Only a successful challenge clears the budget, so failures keep accumulating.
      await this.atomicCache.reset(AuthService.stepUpAttemptKey(userId));

      const stepUpToken = this.jwtService.sign(
          { sub: userId, stepup: true, scope, jti: crypto.randomUUID() },
          {
              secret: AuthConfig.JWT_STEP_UP_SECRET,
              expiresIn: AuthConfig.JWT_STEP_UP_EXPIRATION as `${number}m`,
              // A distinct audience prevents a step-up token from ever being accepted by the
              // access-token path (and vice versa) even if the secrets were misconfigured.
              issuer: 'virteex-api',
              audience: 'virteex-step-up',
          },
      );

      // Returned to the controller, which delivers it as an httpOnly cookie. It is deliberately
      // NOT part of the HTTP response body — see StepUpGuard.
      return { stepUpToken, maxAgeMs: AuthConfig.STEP_UP_TOKEN_TTL };
  }

  /**
   * Whether the caller ALREADY holds a valid step-up proof for a scope.
   *
   * This is what makes federated re-authentication usable. The IdP round-trip is a full page
   * navigation, so the closure the client wanted to run does not survive it — but the proof
   * does, as an httpOnly cookie the client cannot read. Without a way to ask, the client would
   * prompt again on return and send the user back to the IdP in a loop.
   *
   * Deliberately does NOT consume a single-use token: `StepUpGuard` burns the jti on the guarded
   * route, and burning it here would spend the proof on the question rather than the action.
   */
  verifyStepUpToken(
      token: string | undefined,
      userId: string,
      scope: StepUpScope,
  ): { valid: boolean; expiresInMs: number } {
      if (!token) return { valid: false, expiresInMs: 0 };
      try {
          const payload = this.jwtService.verify<{
              sub: string;
              stepup: boolean;
              scope: StepUpScope;
              exp: number;
          }>(token, {
              secret: AuthConfig.JWT_STEP_UP_SECRET,
              issuer: 'virteex-api',
              audience: 'virteex-step-up',
          });
          if (!payload.stepup || payload.sub !== userId || payload.scope !== scope) {
              return { valid: false, expiresInMs: 0 };
          }
          return { valid: true, expiresInMs: Math.max(payload.exp * 1000 - Date.now(), 0) };
      } catch {
          return { valid: false, expiresInMs: 0 };
      }
  }

  /**
   * Describe the step-up challenge for a user, so the client knows which factor to collect.
   *
   * Deliberately reports only the *kind* of factor. It is called with a valid session, so it
   * reveals nothing an attacker holding that session could not already discover, and it never
   * leaks whether a password exists for an account that has 2FA on.
   */
  async describeStepUpChallenge(
      userId: string,
  ): Promise<{ factor: StepUpFactor; ssoStartPath?: string; idpName?: string }> {
      const user = await this.usersService.findUserByIdForAuth(userId);
      if (user?.security?.isTwoFactorEnabled) return { factor: 'otp' };
      if (user?.security?.passwordHash) return { factor: 'password' };

      // No local credential. If the account is federated, the identity provider IS the factor —
      // it is the one that authenticated this person in the first place, and it can be asked to
      // do so again with `prompt=login`. Returning 'none' here is what dead-ended every SSO
      // account: the client showed an "enrol a second factor" prompt for an action that itself
      // required a second factor.
      if (user) {
          // Resolved ONCE. The provider is named so the prompt can say where the user is being
          // sent — "Continue" with no destination is exactly the redirect people are taught not
          // to accept — and the organization's IdP takes precedence over a social provider.
          const enterprise = await this.enterpriseSsoService.discoverByEmail(user.email);
          if (enterprise) {
              return {
                  factor: 'sso',
                  ssoStartPath: '/auth/step-up/sso',
                  idpName: enterprise.idpName,
              };
          }
          if (user.authProvider && this.oidcProviderService.isProviderConfigured(user.authProvider)) {
              const labels: Record<string, string> = { google: 'Google', microsoft: 'Microsoft' };
              return {
                  factor: 'sso',
                  ssoStartPath: '/auth/step-up/sso',
                  idpName: labels[user.authProvider] ?? user.authProvider,
              };
          }
      }

      return { factor: 'none' };
  }

  /**
   * Whether the account can be re-authenticated against an identity provider.
   *
   * Enterprise SSO first (resolved from the organization's configured IdP by verified email
   * domain), then a social provider recorded on the user at sign-up. Either is a real factor: the
   * user proves possession of an account at a provider we already trust for this identity.
   */
  /** Load the full user record for a step-up decision that needs fields the principal omits. */
  async findUserForStepUp(userId: string): Promise<User | null> {
      return this.usersService.findUserByIdForAuth(userId);
  }

  async hasFederatedIdentity(user: User): Promise<boolean> {
      if (await this.enterpriseSsoService.discoverByEmail(user.email)) return true;
      return Boolean(
          user.authProvider && this.oidcProviderService.isProviderConfigured(user.authProvider),
      );
  }

  /**
   * Mint a step-up token after the identity provider has re-authenticated the user.
   *
   * Called only from the SSO step-up callback, which has already validated the IdP's response —
   * state, PKCE, nonce, signature — and confirmed that the returned subject is the signed-in user.
   * It is deliberately separate from `createStepUpToken` so the two proofs cannot be confused: no
   * request body reaches this path, so there is nothing a caller could supply to reach it.
   */
  issueStepUpTokenAfterFederatedReauth(
      userId: string,
      scope: StepUpScope,
  ): { stepUpToken: string; maxAgeMs: number } {
      const stepUpToken = this.jwtService.sign(
          { sub: userId, stepup: true, scope, jti: crypto.randomUUID() },
          {
              secret: AuthConfig.JWT_STEP_UP_SECRET,
              expiresIn: AuthConfig.JWT_STEP_UP_EXPIRATION as `${number}m`,
              issuer: 'virteex-api',
              audience: 'virteex-step-up',
          },
      );
      return { stepUpToken, maxAgeMs: AuthConfig.STEP_UP_TOKEN_TTL };
  }

  /**
   * Rate-limit re-authentication attempts.
   *
   * The counter is incremented BEFORE the factor is verified, so an attempt that fails or throws
   * still consumes budget. Reading the counter and then writing `attempts + 1` afterwards would
   * let a burst of parallel guesses all observe the same low count.
   */
  private async assertWithinStepUpAttemptBudget(userId: string): Promise<void> {
      const key = AuthService.stepUpAttemptKey(userId);
      const attempts = await this.incrementAttempts(key, AuthService.STEP_UP_WINDOW_MS);

      if (attempts > AuthService.STEP_UP_MAX_ATTEMPTS) {
          this.logger.warn(
              { event: 'step_up_rate_limited', userId },
              '[SECURITY] Step-up re-authentication rate limit reached',
          );
          throw new ForbiddenException(
              'Demasiados intentos de verificación. Espera 5 minutos e inténtalo de nuevo.',
          );
      }
  }

  /**
   * Count one attempt and return the new total, atomically.
   *
   * The counter is the whole brute-force control, so a read-then-write would let a burst of
   * parallel guesses all observe the same low count. `AtomicCacheService` performs a Redis `INCR`
   * with `PEXPIRE` on first use, so the window starts at the first attempt rather than sliding
   * forward with every one.
   *
   * This used to reach into `cacheManager.store` for a client itself — a property cache-manager 7
   * does not expose — so the atomic branch was never taken and the budget was, in practice, per
   * process. Centralising it also means the service refuses to boot a deployment where no shared
   * client exists, instead of silently approximating one.
   */
  private async incrementAttempts(key: string, windowMs: number): Promise<number> {
      return this.atomicCache.increment(key, windowMs);
  }
}

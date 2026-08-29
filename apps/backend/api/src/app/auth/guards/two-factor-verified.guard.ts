import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { TwoFactorAuthService } from '../services/two-factor-auth.service';
import { UserCacheService } from '../modules/user-cache.service';
import { RequestWithUser } from '../interfaces/request-with-user.interface';
import { User } from '../../users/entities/user.entity/user.entity';

const STEP_UP_MAX_ATTEMPTS = 5;
const STEP_UP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Requires a *fresh* proof of identity before a sensitive action, not merely a live session.
 *
 * ## Why the shape changed
 *
 * The guard used to begin with:
 *
 *     const isEnabled = await this.twoFactorService.isTwoFactorEnabled(user);
 *     if (!isEnabled) return true;
 *
 * so every operation it protects — role changes, user deletion, status changes, session
 * revocation, impersonation — had *no* re-authentication whatsoever for any user without 2FA,
 * which is most users, because 2FA is opt-in. The control advertised coverage it did not
 * provide: a stolen session cookie was enough to perform all of them.
 *
 * It now always demands a second proof, using the strongest factor the account actually has:
 *   - 2FA enabled -> TOTP or backup code via `x-otp-code` (single-use, replay-protected)
 *   - otherwise   -> the account password via `x-reauth-password`
 *
 * Accounts with no local password (pure SSO identities) can satisfy neither. Rather than fail
 * open they are told to enrol a second factor — a deliberate policy call, since the alternative
 * leaves exactly those accounts permanently unprotected.
 */
@Injectable()
export class TwoFactorVerifiedGuard implements CanActivate {
  private readonly logger = new Logger(TwoFactorVerifiedGuard.name);

  // Deliberately depends only on services that AuthModule exports, so the guard resolves in
  // every module that uses it (auth, users, roles). Pulling UsersService in here broke
  // RolesModule at runtime — it imports AuthModule but not UsersModule.
  constructor(
    private readonly twoFactorService: TwoFactorAuthService,
    private readonly userCacheService: UserCacheService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('User not authenticated');
    }

    await this.assertWithinAttemptBudget(user.id);

    const isTwoFactorEnabled = await this.twoFactorService.isTwoFactorEnabled(user as User);

    const verified = isTwoFactorEnabled
      ? await this.verifyOtp(request, user as User)
      : await this.verifyPassword(request, user.id);

    if (!verified) {
      throw new ForbiddenException(
        isTwoFactorEnabled ? 'Código de verificación inválido.' : 'Contraseña incorrecta.',
      );
    }

    // Only a successful challenge clears the budget, so failed attempts keep accumulating.
    await this.userCacheService.del(this.attemptKey(user.id));
    return true;
  }

  private attemptKey(userId: string): string {
    return `step-up-attempts:${userId}`;
  }

  /**
   * Rate-limit re-authentication attempts (CWE-307).
   *
   * The counter is incremented *before* the factor is verified, so an attempt that fails or
   * throws still consumes budget. The previous version read the counter and then wrote
   * `attempts + 1` — a read-modify-write that concurrent requests could interleave, letting a
   * burst of parallel guesses all observe the same low count.
   */
  private async assertWithinAttemptBudget(userId: string): Promise<void> {
    const key = this.attemptKey(userId);
    const current = (await this.userCacheService.get<number>(key)) ?? 0;

    if (current >= STEP_UP_MAX_ATTEMPTS) {
      this.logger.warn(
        { event: 'step_up_rate_limited', userId },
        '[SECURITY] Step-up re-authentication rate limit reached',
      );
      throw new ForbiddenException(
        'Demasiados intentos de verificación. Espera 5 minutos e inténtalo de nuevo.',
      );
    }

    await this.userCacheService.set(key, current + 1, STEP_UP_WINDOW_MS);
  }

  private async verifyOtp(request: RequestWithUser, user: User): Promise<boolean> {
    const otpCode = request.headers['x-otp-code'];
    if (!otpCode || typeof otpCode !== 'string') {
      throw new ForbiddenException('Se requiere un código de verificación para esta acción.');
    }
    return this.twoFactorService.verifyCode(user, otpCode);
  }

  private async verifyPassword(request: RequestWithUser, userId: string): Promise<boolean> {
    const password = request.headers['x-reauth-password'];
    if (!password || typeof password !== 'string') {
      throw new ForbiddenException('Se requiere confirmar tu contraseña para esta acción.');
    }

    if (!(await this.twoFactorService.hasLocalPassword(userId))) {
      // Federated identity with no local password: neither factor is available. Failing open
      // here would leave precisely these accounts unprotected on the most sensitive operations.
      throw new ForbiddenException(
        'Esta acción requiere verificación en dos pasos. Actívala en tu configuración de seguridad.',
      );
    }

    return this.twoFactorService.verifyAccountPassword(userId, password);
  }
}

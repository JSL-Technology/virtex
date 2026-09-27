import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as crypto from 'crypto';
import * as ms from 'ms';
import { User } from '../../users/entities/user.entity/user.entity';
import { MailService } from '../../mail/mail.service';
import { UserCacheService } from '../modules/user-cache.service';
import { ForgotPasswordDto } from '../dto/forgot-password.dto';
import { ResetPasswordDto } from '../dto/reset-password.dto';
import { SetPasswordFromInvitationDto } from '../dto/set-password-from-invitation.dto';
import { AuthConfig } from '../auth.config';
import { UserStatus } from '../../users/entities/user.entity/user.entity';
import { UserSecurity } from '../../users/entities/user-security.entity';
import { PasswordService } from './password.service';
import { TwoFactorAuthService } from './two-factor-auth.service';
import { SessionInvalidatorPort } from '../ports/session-invalidator.port';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../i18n/localized.exception';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService,
    private readonly passwordService: PasswordService,
    private readonly twoFactorAuthService: TwoFactorAuthService,
    // The narrow port rather than SessionService itself, so this file does not widen the
    // dependency graph for one method (see SessionInvalidatorPort).
    private readonly sessionInvalidator: SessionInvalidatorPort,
  ) {}

  public async sendPasswordResetLink(forgotPasswordDto: ForgotPasswordDto): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;
    const genericMessage = 'Si existe una cuenta con ese correo, se ha enviado un enlace para restablecer la contraseña.';

    const user = await this.userRepository.findOne({ where: { email }, relations: ['security'] });
    if (!user) {
      await this.simulateDelay();
      return { message: genericMessage };
    }

    const rawToken = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expirationTime = AuthConfig.JWT_RESET_PASSWORD_EXPIRATION;
    if (!user.security) user.security = new UserSecurity();
    user.security.passwordResetToken = tokenHash;
    user.security.passwordResetExpires = new Date(Date.now() + this.convertToMs(expirationTime));
    await this.userRepository.save(user);

    await this.mailService.sendPasswordResetEmail(user, rawToken, expirationTime);

    return { message: genericMessage };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<User> {
    const { token, password, twoFactorCode } = resetPasswordDto;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.userRepository
      // tenant-scope-guard-allow: recuperación de contraseña. Se busca por correo, que es global, y
      // ocurre sin sesión: no hay empresa activa por la que filtrar.
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.security', 'security')
      .leftJoinAndSelect('user.roles', 'roles')
      .where('security.passwordResetToken = :tokenHash', { tokenHash })
      .andWhere('security.passwordResetExpires > :now', { now: new Date() })
      .getOne();

    if (!user || !user.security) {
      throw new UnauthorizedError('auth.verification_token_invalid_or_expired');
    }

    if (!user.security.passwordHash) {
      throw new BadRequestError('auth.no_previous_password_found_user');
    }

    // The second factor still applies here.
    //
    // Recovery was the one flow that replaced a credential on the strength of mailbox access
    // alone: an attacker holding the inbox of an account with 2FA enabled could set a new
    // password without ever presenting the factor. That did not hand them a session — sign-in
    // still asks for the code — but it did let them lock the owner out of their own account, and
    // NIST SP 800-63B §6.1.2.3 asks the verifier to reconfirm the binding to the authenticator
    // during recovery rather than only at sign-in.
    //
    // A backup code satisfies this too (`verifyCode` routes on the shape), so losing the phone
    // does not mean losing the account.
    if (user.security.isTwoFactorEnabled) {
      if (!twoFactorCode) {
        throw new BadRequestError('auth.2_fa_verification_required');
      }
      const isValidSecondFactor = await this.twoFactorAuthService.verifyCode(user, twoFactorCode);
      if (!isValidSecondFactor) {
        throw new UnauthorizedError('auth.invalid_2_fa_code');
      }
    }

    // Through PasswordService, not `argon2.verify` directly.
    //
    // `argon2.verify` THROWS on a malformed or unsupported stored hash rather than returning
    // false — which is the entire reason `PasswordService.verify` exists and catches. Calling the
    // library here turned a data problem (a truncated column, a legacy bcrypt row) into a 500 on
    // the recovery path, i.e. into an outage for exactly the user who already cannot sign in.
    // Two lines below, this same method was already using `passwordService` for hashing.
    const isSamePassword = await this.passwordService.verify(user.security.passwordHash, password);
    if (isSamePassword) {
      throw new BadRequestError('auth.new_password_cannot_same_previous_one');
    }

    // Routed through PasswordService so the configured Argon2id parameters actually apply.
    // Calling argon2.hash() directly here silently ignored ARGON2_* config — the same class of
    // dead-configuration bug that was already fixed inside PasswordService.
    await this.passwordService.assertNotBreached(password);
    user.security.passwordHash = await this.passwordService.hash(password);
    user.security.passwordResetToken = null;
    user.security.passwordResetExpires = null;
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    await this.userCacheService.clearUserSession(user.id);
    const saved = await this.userRepository.save(user);

    // End every session, exactly as `AuthService.changePassword` does.
    //
    // This used to bump `tokenVersion` and stop there. The cryptographic effect is similar —
    // both the access path and the refresh path compare the version — but the refresh rows kept
    // `is_revoked = false` and a future `expires_at`, so `getUserSessions` went on listing dead
    // sessions as live. That is the opposite of what this flow is for: a reset requested after a
    // suspected compromise is followed by opening "Sesiones activas" to check nobody is left, and
    // the screen showed sessions the user could not tell apart from an intruder's.
    //
    // NIST SP 800-63B §7.1 — which `changePassword` already cites — does not distinguish between
    // the two ways of changing a password.
    await this.sessionInvalidator.terminateAllSessions(user.id);

    return saved;
  }

  async getInvitationDetails(token: string) {
    // M-03 FIX: invitation tokens are stored hashed; look up by the SHA-256 of the raw token.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.userRepository.findOne({
      where: {
        invitationToken: tokenHash,
        status: UserStatus.PENDING,
        invitationTokenExpires: MoreThan(new Date()),
      },
    });

    if (!user) {
        throw new NotFoundError('auth.token_invalid_has_expired');
    }

    return { firstName: user.firstName };
  }

  async setPasswordFromInvitation(setPasswordDto: SetPasswordFromInvitationDto): Promise<User> {
    const { token, password } = setPasswordDto;

    // M-03 FIX: match against the stored SHA-256 hash of the invitation token.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.userRepository.findOne({
      where: {
        invitationToken: tokenHash,
        status: UserStatus.PENDING,
        invitationTokenExpires: MoreThan(new Date()),
      },
      relations: ['roles', 'security'],
    });

    if (!user) {
      throw new UnauthorizedError('auth.invitation_token_invalid_has_expired');
    }

    if (!user.security) user.security = new UserSecurity();

    // Routed through PasswordService so the configured Argon2id parameters actually apply.
    // Calling argon2.hash() directly here silently ignored ARGON2_* config — the same class of
    // dead-configuration bug that was already fixed inside PasswordService.
    await this.passwordService.assertNotBreached(password);
    user.security.passwordHash = await this.passwordService.hash(password);
    user.status = UserStatus.ACTIVE;
    //  Llegar aquí ES la prueba de que la dirección funciona: el token de invitación se envió por
    //  correo a esa dirección y sólo quien la lee ha podido presentarlo. La cuenta quedaba con
    //  `is_email_verified = false`, de modo que el producto le pedía verificar un correo que
    //  acababa de demostrar que controla, y cualquier regla que dependiera de la verificación
    //  —avisos, recuperación— la trataba como no confirmada para siempre.
    user.isEmailVerified = true;
    user.invitationToken = undefined;
    user.invitationTokenExpires = undefined;

    await this.userRepository.save(user);
    return user;
  }

  private async simulateDelay() {
    return new Promise((resolve) => setTimeout(resolve, AuthConfig.SIMULATED_DELAY_MS));
  }

  private convertToMs(time: string): number {
    return (ms as unknown as (value: string) => number)(time);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as argon2 from 'argon2';
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
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../i18n/localized.exception';

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService,
    private readonly passwordService: PasswordService
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
    const { token, password } = resetPasswordDto;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await this.userRepository
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

    const isSamePassword = await argon2.verify(user.security.passwordHash, password);
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
    return this.userRepository.save(user);
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

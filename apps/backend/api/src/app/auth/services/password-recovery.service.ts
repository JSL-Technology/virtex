import { Injectable, NotFoundException, UnauthorizedException, BadRequestException, Logger } from '@nestjs/common';
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

@Injectable()
export class PasswordRecoveryService {
  private readonly logger = new Logger(PasswordRecoveryService.name);

  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService
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
      throw new UnauthorizedException('Token inválido o expirado');
    }

    if (!user.security.passwordHash) {
      throw new BadRequestException('No se encontró una contraseña previa para este usuario.');
    }

    const isSamePassword = await argon2.verify(user.security.passwordHash, password);
    if (isSamePassword) {
      throw new BadRequestException('La nueva contraseña no puede ser igual a la anterior');
    }

    user.security.passwordHash = await argon2.hash(password);
    user.security.passwordResetToken = null;
    user.security.passwordResetExpires = null;
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    await this.userCacheService.clearUserSession(user.id);
    return this.userRepository.save(user);
  }

  async getInvitationDetails(token: string) {
    const user = await this.userRepository.findOne({
      where: {
        invitationToken: token,
        status: UserStatus.PENDING,
        invitationTokenExpires: MoreThan(new Date()),
      },
    });

    if (!user) {
      throw new NotFoundException('Invitación no encontrada o expirada.');
    }

    return { firstName: user.firstName };
  }

  async setPasswordFromInvitation(setPasswordDto: SetPasswordFromInvitationDto): Promise<User> {
    const { token, password } = setPasswordDto;

    const user = await this.userRepository.findOne({
      where: {
        invitationToken: token,
        status: UserStatus.PENDING,
        invitationTokenExpires: MoreThan(new Date()),
      },
      relations: ['roles', 'security'],
    });

    if (!user) {
      throw new UnauthorizedException('El token de invitación es inválido o ha expirado.');
    }

    if (!user.security) user.security = new UserSecurity();

    user.security.passwordHash = await argon2.hash(password);
    user.status = UserStatus.ACTIVE;
    user.invitationToken = undefined;
    user.invitationTokenExpires = undefined;

    await this.userRepository.save(user);
    return user;
  }

  private async simulateDelay() {
    return new Promise((resolve) => setTimeout(resolve, AuthConfig.SIMULATED_DELAY_MS));
  }

  private convertToMs(time: string): number {
    return ms(time) as number;
  }
}

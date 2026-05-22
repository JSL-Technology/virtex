import { Injectable, BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
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

interface PasswordResetJwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class PasswordRecoveryService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly mailService: MailService,
    private readonly userCacheService: UserCacheService
  ) {}

  public async sendPasswordResetLink(
    forgotPasswordDto: ForgotPasswordDto,
  ): Promise<{ message: string }> {
    const { email } = forgotPasswordDto;
    const genericMessage = 'Si existe una cuenta con ese correo, se ha enviado un enlace para restablecer la contraseña.';

    const user = await this.userRepository.findOne({ where: { email }, relations: ['security'] });
    if (!user) {
      await this.simulateDelay();
      return { message: genericMessage };
    }

    const expirationTime = AuthConfig.JWT_RESET_PASSWORD_EXPIRATION;

    const token = await this._generatePasswordResetToken(
      user.id,
      user.email,
      expirationTime,
    );

    if (!user.security) user.security = new UserSecurity();

    user.security.passwordResetToken = token;
    user.security.passwordResetExpires = new Date(
      Date.now() + this.convertToMs(expirationTime),
    );
    await this.userRepository.save(user);

    await this.mailService.sendPasswordResetEmail(user, token, expirationTime);

    return { message: genericMessage };
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto): Promise<User> {
    const { token, password } = resetPasswordDto;

    let payload: PasswordResetJwtPayload;
    try {
      payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_RESET_PASSWORD_SECRET'),
      });
    } catch (error) {
      throw new UnauthorizedException('Token inválido o expirado');
    }

    // We need to query by reset token, which is now in UserSecurity
    const user = await this.userRepository.findOne({
        where: { id: payload.sub },
        relations: ['security']
    });

    if (!user || !user.security || user.security.passwordResetToken !== token ||
        (user.security.passwordResetExpires && user.security.passwordResetExpires <= new Date())) {
      throw new NotFoundException(
        'El token de restablecimiento es inválido o ha expirado.',
      );
    }

    if (password.length < 8) {
      throw new BadRequestException(
        'La contraseña debe tener al menos 8 caracteres.',
      );
    }

    if (!user.security.passwordHash) {
      throw new BadRequestException(
        'No se encontró una contraseña previa para este usuario.',
      );
    }

    const isSamePassword = await argon2.verify(user.security.passwordHash, password);
    if (isSamePassword) {
      throw new BadRequestException(
        'La nueva contraseña no puede ser igual a la anterior',
      );
    }

    user.security.passwordHash = await argon2.hash(password);
    user.security.passwordResetToken = null;
    user.security.passwordResetExpires = null;

    // Invalidate all existing sessions on password change
    user.security.tokenVersion = (user.security.tokenVersion || 0) + 1;

    // Invalidate cache explicitly
    await this.userCacheService.clearUserSession(user.id);

    const updatedUser = await this.userRepository.save(user);
    return updatedUser;
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

  async setPasswordFromInvitation(
    setPasswordDto: SetPasswordFromInvitationDto,
  ): Promise<User> {
    const { token, password } = setPasswordDto;

    const user = await this.userRepository.findOne({
      where: {
        invitationToken: token,
        status: UserStatus.PENDING,
        invitationTokenExpires: MoreThan(new Date()),
      },
      relations: ['roles', 'organization', 'security'],
    });

    if (!user) {
      throw new UnauthorizedException(
        'El token de invitación es inválido o ha expirado.',
      );
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

  private async _generatePasswordResetToken(
    userId: string,
    email: string,
    expiresIn: string,
  ): Promise<string> {
    const payload: PasswordResetJwtPayload = { sub: userId, email };
    return await this.jwtService.signAsync(payload, {
      secret: this.configService.get<string>('JWT_RESET_PASSWORD_SECRET'),
      expiresIn,
    });
  }

  private convertToMs(time: string): number {
    return ms(time) as number;
  }
}

import { Injectable } from '@nestjs/common';
import { MailerService } from '@nestjs-modules/mailer';
import { ConfigService } from '@nestjs/config';
import { User } from '../users/entities/user.entity/user.entity';
import { FrontendUrlService } from './frontend-url.service';

@Injectable()
export class MailService {
  constructor(
    private readonly mailerService: MailerService,
    private readonly configService: ConfigService,
    // Every link into the web client goes through this. Built inline at each call site, they
    // were all pointing at routes that do not exist — see FrontendUrlService for the list.
    private readonly links: FrontendUrlService,
  ) {}

  async sendPasswordResetEmail(user: User, token: string, expiration: string) {
    const resetLink = this.links.passwordReset(token, user.preferredLanguage);

    const expirationText = this.formatExpirationTime(expiration);

    await this.mailerService.sendMail({
      to: user.email,
      subject: 'Restablecimiento de Contraseña',
      template: './password-reset',
      context: {
        name: user.firstName,
        resetLink: resetLink,
        expirationTimeText: expirationText,
        appName: this.configService.get<string>('APP_NAME', 'Mi App Contable'),

        currentYear: new Date().getFullYear(),
      },
    });
  }

  private formatExpirationTime(time: string): string {
    if (typeof time !== 'string' || time.length < 2) return time;

    const value = parseInt(time.slice(0, -1));
    const unit = time.slice(-1).toLowerCase();

    if (isNaN(value)) return time;

    switch (unit) {
      case 'm':
        return `${value} minuto${value > 1 ? 's' : ''}`;
      case 'h':
        return `${value} hora${value > 1 ? 's' : ''}`;
      case 'd':
        return `${value} día${value > 1 ? 's' : ''}`;
      default:
        return time;
    }
  }

  async sendUserInvitation(user: User, token: string) {

    // Was `?token=` while the page reads only `#token=`, so the invitation arrived without one.
    const setPasswordUrl = this.links.setPasswordFromInvitation(token, user.preferredLanguage);

    await this.mailerService.sendMail({
      to: user.email,
      subject: '¡Has sido invitado a unirte a nuestra plataforma!',
      template: 'user-invitation',
      context: {
        name: user.firstName,
        url: setPasswordUrl,
      },
    });
  }

  async sendDuplicateRegistrationEmail(email: string, name: string) {
    const loginUrl = this.links.login();
    const resetPasswordUrl = this.links.forgotPassword();

    await this.mailerService.sendMail({
      to: email,
      subject: 'Intento de registro detectado',
      template: './duplicate-registration',
      context: {
        name: name || 'Usuario',
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        loginUrl,
        resetPasswordUrl,
        currentYear: new Date().getFullYear(),
      },
    });
  }

  async sendVerificationCodeEmail(email: string, code: string, name: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Código de verificación 2FA',
      template: './verification-code',
      context: {
        name: name || 'Usuario',
        code,
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        currentYear: new Date().getFullYear(),
      },
    });
  }

  // H-01 FIX: Sends a confirmation link to the *new* address before the change is applied.
  // The token is a 32-byte hex nonce — SHA-256 hash is stored in DB, raw value in link.
  async sendEmailChangeConfirmation(newEmail: string, rawToken: string, firstName: string) {
    const confirmUrl = this.links.confirmEmailChange(rawToken);

    await this.mailerService.sendMail({
      to: newEmail,
      subject: 'Confirma tu nuevo correo electrónico',
      template: './email-change-confirm',
      context: {
        name: firstName || 'Usuario',
        confirmUrl,
        expiresMinutes: 15,
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        currentYear: new Date().getFullYear(),
      },
    });
  }

  async sendRegistrationEmailVerification(
    email: string,
    code: string,
    name: string,
    magicLinkUrl: string,
    expiresMinutes: number,
  ) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'Confirma tu correo electrónico',
      template: './registration-email-verify',
      context: {
        name: name || 'Usuario',
        code,
        magicLinkUrl,
        expiresMinutes,
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        currentYear: new Date().getFullYear(),
      },
    });
  }
}

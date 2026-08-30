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

  /**
   * Tell somebody who already has an account that they now have access to another tenant.
   *
   * Distinct from `sendUserInvitation` on purpose: that one carries a set-your-password link, and
   * sending it to a person who already has a password is both confusing and a nudge towards
   * changing a credential they never asked to change. This one points at sign-in and says which
   * organization added them.
   */
  async sendAddedToOrganizationEmail(user: User, organizationName: string) {
    await this.mailerService.sendMail({
      to: user.email,
      subject: `Ahora tienes acceso a ${organizationName}`,
      template: 'organization-added',
      context: {
        name: user.firstName,
        organizationName,
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        url: this.links.login(undefined, user.preferredLanguage),
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

  /**
   * Tell somebody their payment went through but their account could not be created.
   *
   * Payment-first signup means the charge happens before the account exists, so this failure
   * leaves a real customer with a real charge and nothing to show for it. Silence was the
   * previous behaviour and it is the worst one: the screen told them to "sign in in a few
   * minutes" to an account that does not exist, with no reference to quote to support.
   */
  async sendRegistrationFailedEmail(email: string, name: string, reference: string) {
    await this.mailerService.sendMail({
      to: email,
      subject: 'No pudimos crear tu cuenta — tu pago fue reembolsado',
      template: './registration-failed',
      context: {
        name: name || 'Usuario',
        appName: this.configService.get<string>('APP_NAME', 'Virteex ERP'),
        registerUrl: this.links.register(),
        reference,
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

  /**
   * Warn the address that is losing the account.
   *
   * The confirmation above goes to the NEW address, which is the wrong side for the case that
   * actually needs a signal: a hijacked session changing the email silently redirects account
   * recovery, and the legitimate owner learns nothing. The old address is the one channel the
   * attacker no longer controls at that point.
   */
  async sendEmailChangedNotice(previousEmail: string, firstName: string, newEmail: string) {
    await this.mailerService.sendMail({
      to: previousEmail,
      subject: 'El correo de tu cuenta ha cambiado',
      template: './email-changed-notice',
      context: {
        name: firstName || 'Usuario',
        newEmail,
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

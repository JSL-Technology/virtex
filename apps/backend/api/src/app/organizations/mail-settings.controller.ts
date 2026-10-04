import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { MailService } from '../mail/mail.service';
import { BadRequestError } from '../i18n/localized.exception';
import { UserProfilePort } from '../users/ports/user-profile.port';
import { OrgSettingsService } from './services/org-settings.service';

/** An empty string or null clears a value back to its default. */
const present = (_: unknown, value: unknown) => value !== null && value !== undefined && value !== '';

export class UpdateMailSettingsDto {
  @IsOptional()
  @ValidateIf(present)
  @IsString()
  @MaxLength(100, { message: 'validation.constraints.max_length|{"max":100}' })
  senderName?: string | null;

  @IsOptional()
  @ValidateIf(present)
  @IsEmail({}, { message: 'validation.constraints.is_email' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  replyTo?: string | null;

  @IsOptional()
  @ValidateIf(present)
  @IsEmail({}, { message: 'validation.constraints.is_email' })
  @MaxLength(255, { message: 'validation.constraints.max_length|{"max":255}' })
  copyTo?: string | null;
}

/**
 * The company's identity on the documents it e-mails (QA M-09: «Servidor de correo (SMTP)» said
 * «En desarrollo»).
 *
 * Not a per-tenant SMTP server, deliberately. A company's own server sends with its own
 * reputation and its own SPF/DKIM, which most small companies have not set up — and a mail
 * relay holding each customer's SMTP password is a credential store an attacker would want. The
 * platform's authenticated domain carries the message; the company decides the name the
 * recipient sees, where replies go, and whether it keeps a copy.
 */
@Controller('organizations/mail-settings')
export class MailSettingsController {
  constructor(
    private readonly settings: OrgSettingsService,
    private readonly mail: MailService,
    private readonly profiles: UserProfilePort,
  ) {}

  @Get()
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  async get(@CurrentUser() user: AuthenticatedUser) {
    const identity = await this.settings.mailIdentity(user.organizationId);
    return { ...identity, platformAddress: this.mail.platformAddress };
  }

  @Patch()
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  async update(@Body() dto: UpdateMailSettingsDto, @CurrentUser() user: AuthenticatedUser) {
    const clean = (value: string | null | undefined) => (value === undefined ? undefined : value?.trim() || null);
    const patch = {
      ...(dto.senderName !== undefined && { mailSenderName: clean(dto.senderName) }),
      ...(dto.replyTo !== undefined && { mailReplyTo: clean(dto.replyTo)?.toLowerCase() ?? null }),
      ...(dto.copyTo !== undefined && { mailCopyTo: clean(dto.copyTo)?.toLowerCase() ?? null }),
    };
    await this.settings.update(user.organizationId, patch);
    return this.get(user);
  }

  /** A message to the caller, as a customer would receive a document. Throttled: it sends mail. */
  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  @HasPermission(PERMISSIONS.SETTINGS_EDIT_COMPANY)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async test(@CurrentUser() user: AuthenticatedUser) {
    const profile = await this.profiles.findUserByIdForAuth(user.id);
    if (!profile?.email) throw new BadRequestError('organizations.mail_settings.no_email');
    const identity = await this.settings.mailIdentity(user.organizationId);
    await this.mail.sendMailIdentityTest({
      to: profile.email,
      name: profile.firstName ?? '',
      language: profile.preferredLanguage ?? null,
      identity: { senderName: identity.senderName, replyTo: identity.replyTo, copyTo: null },
    });
    return { queued: true, to: profile.email };
  }
}

import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { ArrayMaxSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { hasPermission } from '@virteex/shared/util-auth';
import { Public } from '../security/decorators/public.decorator';
import { SkipCsrf } from '../security/decorators/skip-csrf.decorator';
import { HasPermission } from '../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../security/principal';
import { PERMISSIONS } from '../shared/permissions';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { BadRequestError, ForbiddenError, UnauthorizedError } from '../i18n/localized.exception';
import { INBOUND_MAIL_PURPOSES, InboundMailPurpose } from '../contracts/inbound-mail/inbound-mail.contract';
import { InboundMailService } from './inbound-mail.service';
import { InboundMessageStatus } from './entities/inbound-message.entity';
import { parseInboundMail, verifySignature } from './inbound-payload';

export class UpdateMailboxDto {
  @IsOptional()
  @IsBoolean({ message: 'validation.constraints.is_boolean' })
  active?: boolean;

  @IsOptional()
  @IsArray({ message: 'validation.constraints.is_array' })
  @ArrayMaxSize(100, { message: 'validation.constraints.array_max_size' })
  @IsString({ each: true, message: 'validation.constraints.is_string' })
  @MaxLength(320, { each: true, message: 'validation.constraints.max_length' })
  allowedSenders?: string[];
}

/** What reading, and acting on, each purpose's mail requires: the permissions of the records it becomes. */
const READ: Record<InboundMailPurpose, string> = { BILLS: PERMISSIONS.ACCOUNTS_PAYABLE_VIEW, ORDERS: PERMISSIONS.INVOICES_VIEW };
const ACT: Record<InboundMailPurpose, string> = { BILLS: PERMISSIONS.ACCOUNTS_PAYABLE_CREATE, ORDERS: PERMISSIONS.INVOICES_CREATE };

function purposeOf(value: string): InboundMailPurpose {
  const purpose = value?.toUpperCase() as InboundMailPurpose;
  if (!INBOUND_MAIL_PURPOSES.includes(purpose)) throw new BadRequestError('inbound_mail.unknown_purpose');
  return purpose;
}

function requirePermission(user: AuthenticatedUser, permission: string): void {
  if (!hasPermission(user.permissions ?? [], [permission])) throw new ForbiddenError('auth.you_do_not_have_permission_perform');
}

@ApiTags('Inbound mail')
@Controller('inbound-mail')
export class InboundMailController {
  constructor(
    private readonly inbound: InboundMailService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Where the mail receiver posts each message. Authenticated by an HMAC over the raw body and a
   * timestamp (see inbound-payload.ts), not by a session: no person is behind it.
   */
  @Public()
  @SkipCsrf()
  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  async webhook(@Headers('x-virtex-signature') signature: string | undefined, @Req() req: unknown) {
    const secret = this.config.get<string>('INBOUND_MAIL_WEBHOOK_SECRET') ?? '';
    const rawBody = (req as { rawBody?: Buffer }).rawBody;
    if (!secret || !Buffer.isBuffer(rawBody) || !verifySignature(secret, signature, rawBody)) {
      throw new UnauthorizedError('inbound_mail.invalid_signature');
    }
    let parsed;
    try {
      parsed = parseInboundMail(JSON.parse(rawBody.toString('utf8')));
    } catch {
      throw new BadRequestError('inbound_mail.invalid_message');
    }
    return this.inbound.receive(parsed);
  }

  @Get('mailboxes')
  @ApiBearerAuth()
  @HasPermission(PERMISSIONS.INBOUND_MAIL_MANAGE)
  @ApiOperation({ summary: "The company's addresses for supplier bills and customer orders." })
  async mailboxes(@CurrentUser() user: AuthenticatedUser) {
    return { configured: this.inbound.configured(), mailboxes: await this.inbound.listMailboxes(user.organizationId) };
  }

  @Post('mailboxes/:purpose/rotate')
  @ApiBearerAuth()
  @HasPermission(PERMISSIONS.INBOUND_MAIL_MANAGE)
  @ApiOperation({ summary: 'Create the address for a purpose, or replace it (the old one stops working at once).' })
  rotate(@CurrentUser() user: AuthenticatedUser, @Param('purpose') purpose: string) {
    return this.inbound.rotate(user.organizationId, purposeOf(purpose), user.id);
  }

  @Patch('mailboxes/:purpose')
  @ApiBearerAuth()
  @HasPermission(PERMISSIONS.INBOUND_MAIL_MANAGE)
  @ApiOperation({ summary: 'Turn an address on or off, or limit who may write to it.' })
  update(@CurrentUser() user: AuthenticatedUser, @Param('purpose') purpose: string, @Body() dto: UpdateMailboxDto) {
    return this.inbound.updateMailbox(user.organizationId, purposeOf(purpose), dto);
  }

  @Get(':purpose/messages')
  @ApiBearerAuth()
  @AuthenticatedOnly('Checked inside against the permission that reads the records the purpose produces (READ).')
  @ApiOperation({ summary: 'What arrived at the address, and what became of it.' })
  messages(@CurrentUser() user: AuthenticatedUser, @Param('purpose') raw: string, @Query('status') status?: string) {
    const purpose = purposeOf(raw);
    requirePermission(user, READ[purpose]);
    const statuses = (status ?? '').split(',').filter(Boolean) as InboundMessageStatus[];
    return this.inbound.list(user.organizationId, purpose, statuses);
  }

  @Post(':purpose/messages/:id/retry')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.ACCEPTED)
  @AuthenticatedOnly('Checked inside against the permission that creates the records the purpose produces (ACT).')
  retry(@CurrentUser() user: AuthenticatedUser, @Param('purpose') raw: string, @Param('id', UuidParamPipe) id: string) {
    const purpose = purposeOf(raw);
    requirePermission(user, ACT[purpose]);
    return this.inbound.retry(user.organizationId, purpose, id);
  }

  @Post(':purpose/messages/:id/dismiss')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @AuthenticatedOnly('Checked inside against the permission that creates the records the purpose produces (ACT).')
  dismiss(@CurrentUser() user: AuthenticatedUser, @Param('purpose') raw: string, @Param('id', UuidParamPipe) id: string) {
    const purpose = purposeOf(raw);
    requirePermission(user, ACT[purpose]);
    return this.inbound.dismiss(user.organizationId, purpose, id, user.id);
  }

  @Get(':purpose/messages/:id/attachments/:attachmentId')
  @ApiBearerAuth()
  @AuthenticatedOnly('Checked inside against the permission that reads the records the purpose produces (READ).')
  async attachment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('purpose') raw: string,
    @Param('id', UuidParamPipe) id: string,
    @Param('attachmentId', UuidParamPipe) attachmentId: string,
  ): Promise<StreamableFile> {
    const purpose = purposeOf(raw);
    requirePermission(user, READ[purpose]);
    const { attachment, file } = await this.inbound.attachment(user.organizationId, purpose, id, attachmentId);
    return new StreamableFile(file.stream, {
      type: attachment.mimeType,
      disposition: `inline; filename*=UTF-8''${encodeURIComponent(attachment.fileName)}`,
      length: file.fileSize,
    });
  }
}

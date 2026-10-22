import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { AuthenticatedOnly } from '../../security/decorators/authenticated-only.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { PERMISSIONS } from '../../shared/permissions';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { CheckFeature } from '../../saas/contracts/entitlements.contract';
import { currentLanguage } from '../../i18n/request-locale';
import { I18nService } from '../../i18n/i18n.service';
import { isLocalizedError } from '../../i18n/localized.exception';
import { CopilotService } from './copilot.service';
import { CopilotUser } from '../../contracts/copilot/copilot-tools.contract';
import { loadBranchScope } from '../../organizations/contracts/branch.contract';
import { ShortLivedConnections } from '../../shared/tenancy/short-lived-connections.decorator';
import { runAsTenantJob } from '../../shared/tenancy/tenant-job';
import { DataSource } from 'typeorm';
import { AI_RATE_LIMIT, TenantRateLimit, TenantRateLimitGuard } from '../../shared/rate-limit/tenant-rate-limit.guard';

export class CopilotMessageDto {
  @IsString({ message: 'validation.constraints.is_string' })
  @MinLength(1, { message: 'validation.constraints.min_length' })
  @MaxLength(4000, { message: 'validation.constraints.max_length' })
  text: string;
}

/** The person as the copilot sees them: their permissions, their language and the branches they are limited to. */
export async function asCopilotUser(dataSource: DataSource, user: AuthenticatedUser): Promise<CopilotUser> {
  const scope = await loadBranchScope(dataSource.manager, user.organizationId, user.id);
  return {
    id: user.id,
    organizationId: user.organizationId,
    permissions: user.permissions ?? [],
    language: currentLanguage(),
    branches: scope.allowed,
  };
}

/**
 * The copilot's HTTP surface. A message is answered as a server-sent event stream — text as it is
 * written, each tool as it is called, each proposal as it is made — because a question that needs
 * three tool rounds takes long enough that a silent spinner reads as a hang.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/copilot')
@HasPermission(PERMISSIONS.AI_COPILOT_USE)
@CheckFeature('ai_assistant')
export class CopilotController {
  private readonly logger = new Logger(CopilotController.name);

  constructor(
    private readonly copilot: CopilotService,
    private readonly i18n: I18nService,
    private readonly dataSource: DataSource,
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: "The user's own copilot conversations, most recent first." })
  async list(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.list(await asCopilotUser(this.dataSource, user));
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'The tools this user may have the copilot use.' })
  async capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.capabilities(await asCopilotUser(this.dataSource, user));
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start a conversation.' })
  async create(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.create(await asCopilotUser(this.dataSource, user));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'A conversation: what was said, the tools behind each answer, and the proposals.' })
  async transcript(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.transcript(await asCopilotUser(this.dataSource, user), id);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.remove(await asCopilotUser(this.dataSource, user), id);
  }

  @TenantRateLimit(AI_RATE_LIMIT)
  @UseGuards(TenantRateLimitGuard)
  @Post('conversations/:id/messages')
  @ShortLivedConnections()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ask; the answer streams back as server-sent events (text, tool, proposal, chart, done, error).' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CopilotMessageDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const stream = new PassThrough();
    const emit = (event: string, data: unknown) => {
      if (!stream.writableEnded) stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    // The person closed the panel or pressed Stop: the model call in flight is aborted and no
    // further turn is paid for. The socket closing is the only signal the browser can give.
    const abort = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) abort.abort();
    });
    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no')
      .send(stream);

    try {
      const who = await runAsTenantJob(this.dataSource, user.organizationId, () => asCopilotUser(this.dataSource, user));
      const result = await this.copilot.send(
        who,
        id,
        dto.text,
        {
          text: (delta) => emit('text', { delta }),
          tool: (call) => emit('tool', call),
          proposal: (action) => emit('proposal', action),
          chart: (chart) => emit('chart', chart),
        },
        abort.signal,
      );
      emit('done', result);
    } catch (error) {
      // The status line is already sent; the error travels as an event, localised like any other.
      const localized = isLocalizedError(error);
      const key = localized ? error.messageKey : 'ai.provider_error';
      const params = localized ? error.params : {};
      if (!localized) {
        this.logger.error(`Copilot turn failed: ${(error as Error)?.message ?? error}`);
      }
      emit('error', { key, message: this.i18n.translate(key, currentLanguage(), params) });
    } finally {
      stream.end();
    }
  }

  @Get('charts/pinned')
  @ApiOperation({ summary: "The user's pinned charts, each drawn now from live data with the user's own permissions." })
  async pinned(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.pinned(await asCopilotUser(this.dataSource, user));
  }

  @Post('charts/:id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keep a chart the copilot drew on the dashboard.' })
  async pin(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.pin(await asCopilotUser(this.dataSource, user), id);
  }

  @Delete('charts/:id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unpin(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.unpin(await asCopilotUser(this.dataSource, user), id);
  }

  @Post('proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create, as a draft, the document the copilot proposed.' })
  async confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.confirm(await asCopilotUser(this.dataSource, user), id);
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  async reject(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.reject(await asCopilotUser(this.dataSource, user), id);
  }
}

/**
 * A person's own copilot data, theirs to take or erase: available to anyone signed in, whatever
 * their role or their company's plan today — losing the permission or the plan must not trap the
 * data the copilot kept about them. Only the caller's own conversations, in the company they act in.
 */
@ApiTags('AI')
@ApiBearerAuth()
@Controller('ai/copilot/my-data')
@AuthenticatedOnly("A person's own conversations; the service reads and deletes only rows with the caller's user and organization.")
export class CopilotDataController {
  constructor(
    private readonly copilot: CopilotService,
    private readonly dataSource: DataSource,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Everything the copilot keeps about the caller in this company: conversations and proposals.' })
  async export(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.exportAll(await asCopilotUser(this.dataSource, user));
  }

  @Delete()
  @ApiOperation({ summary: "Delete all of the caller's conversations in this company. Proposals are kept as the record of what was decided." })
  async remove(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.removeAll(await asCopilotUser(this.dataSource, user));
  }
}

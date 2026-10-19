import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, Post, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { HasPermission } from '../../security/decorators/permissions.decorator';
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

export class CopilotMessageDto {
  @IsString({ message: 'validation.constraints.is_string' })
  @MinLength(1, { message: 'validation.constraints.min_length' })
  @MaxLength(4000, { message: 'validation.constraints.max_length' })
  text: string;
}

function asCopilotUser(user: AuthenticatedUser): CopilotUser {
  return { id: user.id, organizationId: user.organizationId, permissions: user.permissions ?? [], language: currentLanguage() };
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
  ) {}

  @Get('conversations')
  @ApiOperation({ summary: "The user's own copilot conversations, most recent first." })
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.list(asCopilotUser(user));
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'The tools this user may have the copilot use.' })
  capabilities(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.capabilities(asCopilotUser(user));
  }

  @Post('conversations')
  @ApiOperation({ summary: 'Start a conversation.' })
  create(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.create(asCopilotUser(user));
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: 'A conversation: what was said, the tools behind each answer, and the proposals.' })
  transcript(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.transcript(asCopilotUser(user), id);
  }

  @Delete('conversations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.remove(asCopilotUser(user), id);
  }

  @Post('conversations/:id/messages')
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
    const emit = (event: string, data: unknown) => stream.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    reply
      .header('Content-Type', 'text/event-stream; charset=utf-8')
      .header('Cache-Control', 'no-cache, no-transform')
      .header('X-Accel-Buffering', 'no')
      .send(stream);

    try {
      const result = await this.copilot.send(asCopilotUser(user), id, dto.text, {
        text: (delta) => emit('text', { delta }),
        tool: (call) => emit('tool', call),
        proposal: (action) => emit('proposal', action),
        chart: (chart) => emit('chart', chart),
      });
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
  pinned(@CurrentUser() user: AuthenticatedUser) {
    return this.copilot.pinned(asCopilotUser(user));
  }

  @Post('charts/:id/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Keep a chart the copilot drew on the dashboard.' })
  pin(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.pin(asCopilotUser(user), id);
  }

  @Delete('charts/:id/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  unpin(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.unpin(asCopilotUser(user), id);
  }

  @Post('proposals/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create, as a draft, the document the copilot proposed.' })
  confirm(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.confirm(asCopilotUser(user), id);
  }

  @Post('proposals/:id/reject')
  @HttpCode(HttpStatus.OK)
  reject(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    return this.copilot.reject(asCopilotUser(user), id);
  }
}

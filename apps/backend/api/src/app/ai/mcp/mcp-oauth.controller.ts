import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { hasPermission } from '@virteex/shared/util-auth';
import { Public } from '../../security/decorators/public.decorator';
import { SkipCsrf } from '../../security/decorators/skip-csrf.decorator';
import { HasPermission } from '../../security/decorators/permissions.decorator';
import { CurrentUser } from '../../security/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../security/principal';
import { UuidParamPipe } from '../../common/pipes/uuid-param.pipe';
import { ForbiddenError } from '../../i18n/localized.exception';
import { AI_PERMISSIONS } from '../../shared/ai.permissions';
import { EntitlementsPort } from '../../saas/contracts/entitlements.contract';
import { AuthorizeParams, McpOAuthService, OAuthError } from './mcp-oauth.service';
import { publicOrigin } from './mcp-urls';

export class McpConsentDto implements AuthorizeParams {
  @IsString() @MaxLength(16) response_type!: string;
  @IsString() @MaxLength(64) client_id!: string;
  @IsString() @MaxLength(2000) redirect_uri!: string;
  @IsString() @MaxLength(128) code_challenge!: string;
  @IsString() @MaxLength(8) code_challenge_method!: string;
  @IsOptional() @IsString() @MaxLength(200) scope?: string;
  @IsOptional() @IsString() @MaxLength(500) state?: string;
  @IsBoolean() approve!: boolean;
}

/**
 * OAuth 2.1 for MCP agents. Registration, the token and the revocation endpoints are called by the
 * agent (no session, no cookie, no CSRF); authorisation is a page in Virtex where the signed-in
 * person sees which agent asks for what, in which company, and says yes or no.
 */
@ApiTags('MCP')
@Controller('mcp/oauth')
export class McpOAuthController {
  constructor(
    private readonly oauth: McpOAuthService,
    private readonly entitlements: EntitlementsPort,
    private readonly config: ConfigService,
  ) {}

  private fail(reply: FastifyReply, error: unknown) {
    if (error instanceof OAuthError) {
      return reply.status(error.error === 'invalid_client' ? 401 : 400).header('cache-control', 'no-store').send({ error: error.error, error_description: error.description });
    }
    throw error;
  }

  @Public()
  @SkipCsrf()
  @Post('register')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 3_600_000 } })
  @ApiExcludeEndpoint()
  async register(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      return reply.status(201).send(await this.oauth.register(body ?? {}));
    } catch (error) {
      return this.fail(reply, error);
    }
  }

  /** The agent sends the person here; after checking the request, they go on to Virtex's consent page. */
  @Public()
  @Get('authorize')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async authorize(@Query() query: AuthorizeParams, @Res() reply: FastifyReply) {
    try {
      await this.oauth.validateAuthorize(query);
    } catch (error) {
      // An unverified client or address gets an error page, never a redirect to it.
      return this.fail(reply, error);
    }
    const params = new URLSearchParams(Object.entries(query).filter(([, value]) => typeof value === 'string') as Array<[string, string]>);
    return reply.redirect(`${this.oauth.frontendUrl()}/oauth/consent?${params.toString()}`, 302);
  }

  @Get('consent')
  @ApiBearerAuth()
  @HasPermission(AI_PERMISSIONS.AI_COPILOT_USE)
  @ApiOperation({ summary: 'What an MCP agent asks for, to show the person before they decide.' })
  async consentInfo(@Query() query: AuthorizeParams) {
    const { client, scopes, redirectUri } = await this.oauth.validateAuthorize(query).catch((error) => {
      throw error instanceof OAuthError ? new ForbiddenError('ai.mcp.invalid_request') : error;
    });
    return { clientName: client.name, redirectHost: new URL(redirectUri).host, scopes };
  }

  @Post('consent')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @HasPermission(AI_PERMISSIONS.AI_COPILOT_USE)
  @ApiOperation({ summary: "The person's answer: where to send their browser back to the agent." })
  async consent(@CurrentUser() user: AuthenticatedUser, @Body() dto: McpConsentDto, @Req() request: FastifyRequest) {
    try {
      await this.oauth.validateAuthorize(dto);
    } catch (error) {
      throw error instanceof OAuthError ? new ForbiddenError('ai.mcp.invalid_request') : error;
    }
    const iss = publicOrigin(this.config, request);
    if (!dto.approve) return { redirect: this.oauth.redirectWith(dto.redirect_uri, { error: 'access_denied', state: dto.state, iss }) };
    if (!hasPermission(user.permissions ?? [], [AI_PERMISSIONS.AI_COPILOT_USE]) || !(await this.entitlements.checkFeature(user.organizationId, 'ai_assistant'))) {
      throw new ForbiddenError('auth.you_do_not_have_permission_perform');
    }
    const code = await this.oauth.issueCode(dto, user.id, user.organizationId);
    return { redirect: this.oauth.redirectWith(dto.redirect_uri, { code, state: dto.state, iss }) };
  }

  @Public()
  @SkipCsrf()
  @Post('token')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async token(@Body() body: Record<string, unknown>, @Res() reply: FastifyReply) {
    try {
      return reply.header('cache-control', 'no-store').send(await this.oauth.token(body ?? {}));
    } catch (error) {
      return this.fail(reply, error);
    }
  }

  @Public()
  @SkipCsrf()
  @Post('revoke')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiExcludeEndpoint()
  async revoke(@Body() body: Record<string, unknown>) {
    await this.oauth.revoke(String(body?.['token'] ?? ''));
    return {};
  }

  @Get('grants')
  @ApiBearerAuth()
  @HasPermission(AI_PERMISSIONS.AI_COPILOT_USE)
  @ApiOperation({ summary: 'The agents this person has connected in this company.' })
  grants(@CurrentUser() user: AuthenticatedUser) {
    return this.oauth.grants(user.id, user.organizationId);
  }

  @Delete('grants/:id')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @HasPermission(AI_PERMISSIONS.AI_COPILOT_USE)
  @ApiOperation({ summary: 'Disconnect an agent: its tokens stop working at once.' })
  async revokeGrant(@CurrentUser() user: AuthenticatedUser, @Param('id', UuidParamPipe) id: string) {
    await this.oauth.revokeGrant(user.id, user.organizationId, id);
  }
}

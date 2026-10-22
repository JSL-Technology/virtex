import { All, Controller, Headers, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Public } from '../../security/decorators/public.decorator';
import { SkipCsrf } from '../../security/decorators/skip-csrf.decorator';
import { McpService } from './mcp.service';
import { McpOAuthService } from './mcp-oauth.service';
import { publicOrigin } from './mcp-urls';

const REFUSAL_MESSAGE: Record<string, string> = {
  not_a_member: 'This person no longer belongs to the company.',
  no_permission: 'This person may not use the assistant.',
  not_in_plan: "The company's plan does not include the assistant.",
  disabled_by_company: 'The company has turned the assistant off.',
};

/**
 * The MCP endpoint (Streamable HTTP, stateless): one JSON-RPC exchange per request, authenticated
 * by an OAuth access token. Not a session: no cookie, so no CSRF; the token is the credential.
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  constructor(
    private readonly mcp: McpService,
    private readonly oauth: McpOAuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @SkipCsrf()
  @Post()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async handle(@Headers('authorization') authorization: string | undefined, @Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1] ?? '';
    const principal = await this.mcp.principal(token);
    if (principal === 'invalid_token') {
      const metadata = `${publicOrigin(this.config, request)}/.well-known/oauth-protected-resource`;
      return reply
        .status(401)
        .header('www-authenticate', `Bearer error="invalid_token", resource_metadata="${metadata}"`)
        .send({ error: 'invalid_token' });
    }
    if (typeof principal === 'string') {
      return reply.status(403).send({ jsonrpc: '2.0', error: { code: -32001, message: REFUSAL_MESSAGE[principal] }, id: null });
    }
    const server = this.mcp.server(principal, (id) => `${this.oauth.frontendUrl()}/ai/proposals/${id}`);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  /** Stateless: no stream to open (GET) and no session to end (DELETE). */
  @Public()
  @SkipCsrf()
  @All()
  notAllowed(@Res() reply: FastifyReply, @Req() request: FastifyRequest) {
    return reply.status(405).header('allow', 'POST').send({ jsonrpc: '2.0', error: { code: -32000, message: `${request.method} is not supported; POST JSON-RPC.` }, id: null });
  }
}

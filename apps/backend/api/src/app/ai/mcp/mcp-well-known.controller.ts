import { Controller, Get, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import { Public } from '../../security/decorators/public.decorator';
import { apiBase, oauthMetadata, publicOrigin } from './mcp-urls';

/**
 * OAuth discovery at the origin's root (outside the API prefix, see main.ts): RFC 8414 for the
 * authorisation server, RFC 9728 for the MCP resource. With and without a path suffix, because
 * agents ask for both forms.
 */
@ApiExcludeController()
@Controller('.well-known')
export class McpWellKnownController {
  constructor(private readonly config: ConfigService) {}

  private metadata(request: FastifyRequest) {
    return oauthMetadata(apiBase(this.config, request), publicOrigin(this.config, request));
  }

  @Public()
  @Get(['oauth-authorization-server', 'oauth-authorization-server/*', 'openid-configuration'])
  authorizationServer(@Req() request: FastifyRequest) {
    return this.metadata(request).authorizationServer;
  }

  @Public()
  @Get(['oauth-protected-resource', 'oauth-protected-resource/*'])
  protectedResource(@Req() request: FastifyRequest) {
    return this.metadata(request).protectedResource;
  }
}

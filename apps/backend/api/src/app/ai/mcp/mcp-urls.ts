import type { FastifyRequest } from 'fastify';
import type { ConfigService } from '@nestjs/config';

/**
 * Where the API is reached from outside, for OAuth metadata and the MCP resource identifier:
 * API_PUBLIC_URL when set (it should be, in production), else the request's own origin as the
 * proxy reports it (`trustProxy` decides whether X-Forwarded-* is believed).
 */
export function publicOrigin(config: ConfigService, request: Pick<FastifyRequest, 'protocol' | 'hostname'> & { host?: string }): string {
  const configured = config.get<string>('API_PUBLIC_URL')?.trim();
  if (configured) return new URL(configured).origin;
  return `${request.protocol}://${request.host ?? request.hostname}`;
}

export function apiBase(config: ConfigService, request: Parameters<typeof publicOrigin>[1]): string {
  return `${publicOrigin(config, request)}/${(config.get<string>('API_PREFIX') ?? 'api/v1').replace(/^\/|\/$/g, '')}`;
}

/** The OAuth metadata, from one origin. */
export function oauthMetadata(base: string, origin: string) {
  return {
    authorizationServer: {
      issuer: origin,
      authorization_endpoint: `${base}/mcp/oauth/authorize`,
      token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`,
      revocation_endpoint: `${base}/mcp/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['erp:read', 'erp:draft'],
    },
    protectedResource: {
      resource: `${base}/mcp`,
      authorization_servers: [origin],
      scopes_supported: ['erp:read', 'erp:draft'],
      bearer_methods_supported: ['header'],
      resource_name: 'Virtex ERP',
    },
  };
}

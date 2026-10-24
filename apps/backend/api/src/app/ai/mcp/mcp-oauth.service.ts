import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import { In, IsNull, MoreThan, Repository } from 'typeorm';
import { McpOAuthClient } from './entities/mcp-oauth-client.entity';
import { McpOAuthCode } from './entities/mcp-oauth-code.entity';
import { McpOAuthToken } from './entities/mcp-oauth-token.entity';

export const MCP_SCOPES = ['erp:read', 'erp:draft'] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

const CODE_TTL_MS = 60_000;
export const ACCESS_TTL_SECONDS = 3600;
const REFRESH_TTL_MS = 30 * 24 * 3600_000;
const MAX_REDIRECT_URIS = 10;

/** An OAuth error as RFC 6749 §5.2 spells it. */
export class OAuthError extends Error {
  constructor(
    readonly error: 'invalid_request' | 'invalid_client' | 'invalid_grant' | 'unsupported_grant_type' | 'invalid_scope' | 'invalid_redirect_uri' | 'access_denied' | 'invalid_client_metadata',
    readonly description: string,
  ) {
    super(description);
  }
}

export interface AuthorizeParams {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  scope?: string;
  state?: string;
}

export interface ResolvedToken {
  userId: string;
  organizationId: string;
  clientId: string;
  scopes: McpScope[];
  familyId: string;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const base64url = (buffer: Buffer) => buffer.toString('base64url');

/** S256: BASE64URL(SHA256(verifier)) must equal the challenge (RFC 7636). */
export function pkceMatches(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  const computed = Buffer.from(base64url(createHash('sha256').update(verifier).digest()));
  const given = Buffer.from(challenge);
  return computed.length === given.length && timingSafeEqual(computed, given);
}

/**
 * Where an agent may be sent back: HTTPS anywhere, plain HTTP only to this machine (a desktop
 * agent's loopback listener), or a native app's own scheme. Never `javascript:`, `data:` or `file:`.
 */
export function redirectUriAllowed(uri: string): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash) return false;
  if (url.protocol === 'https:') return true;
  if (url.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && !['javascript:', 'data:', 'file:', 'vbscript:', 'blob:'].includes(url.protocol);
}

export function parseScopes(scope: string | undefined): McpScope[] {
  const asked = (scope ?? '').split(/\s+/).filter(Boolean);
  if (!asked.length) return ['erp:read'];
  if (asked.some((value) => !(MCP_SCOPES as readonly string[]).includes(value))) throw new OAuthError('invalid_scope', 'Unknown scope.');
  return [...new Set(asked as McpScope[])];
}

/**
 * OAuth 2.1 for external agents reaching the ERP over MCP: dynamic registration of public clients,
 * authorisation codes with PKCE (S256 only), short access tokens and rotating refresh tokens.
 * Tokens are random and opaque; only their SHA-256 is stored. A refresh token used twice is taken
 * as stolen and its whole family is revoked.
 */
@Injectable()
export class McpOAuthService {
  constructor(
    @InjectRepository(McpOAuthClient) private readonly clients: Repository<McpOAuthClient>,
    @InjectRepository(McpOAuthCode) private readonly codes: Repository<McpOAuthCode>,
    @InjectRepository(McpOAuthToken) private readonly tokens: Repository<McpOAuthToken>,
    private readonly config: ConfigService,
  ) {}

  frontendUrl(): string {
    return (this.config.get<string>('FRONTEND_URL') ?? 'http://localhost:4200').replace(/\/$/, '');
  }

  // ── Registration (RFC 7591) ─────────────────────────────────────────────────

  async register(body: Record<string, unknown>) {
    const name = typeof body['client_name'] === 'string' && body['client_name'].trim() ? body['client_name'].trim().slice(0, 200) : 'MCP client';
    const uris = Array.isArray(body['redirect_uris']) ? body['redirect_uris'].filter((uri): uri is string => typeof uri === 'string') : [];
    if (!uris.length || uris.length > MAX_REDIRECT_URIS || uris.some((uri) => uri.length > 2000 || !redirectUriAllowed(uri))) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must be https, loopback http, or a native app scheme.');
    }
    const method = body['token_endpoint_auth_method'];
    if (method !== undefined && method !== 'none') throw new OAuthError('invalid_client_metadata', 'Only public clients (token_endpoint_auth_method "none") are supported.');
    const client = await this.clients.save(this.clients.create({ clientId: `mcp_${randomBytes(16).toString('hex')}`, name, redirectUris: uris }));
    return {
      client_id: client.clientId,
      client_name: client.name,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    };
  }

  // ── Authorisation ───────────────────────────────────────────────────────────

  /** Checks an authorisation request; throws before anything can be sent to an unverified address. */
  async validateAuthorize(
    params: AuthorizeParams,
  ): Promise<{ client: McpOAuthClient; scopes: McpScope[]; redirectUri: string; codeChallenge: string }> {
    const client = params.client_id ? await this.clients.findOne({ where: { clientId: params.client_id } }) : null;
    if (!client) throw new OAuthError('invalid_client', 'Unknown client.');
    if (!params.redirect_uri || !client.redirectUris.includes(params.redirect_uri)) throw new OAuthError('invalid_redirect_uri', 'redirect_uri is not registered for this client.');
    if (params.response_type !== 'code') throw new OAuthError('invalid_request', 'response_type must be "code".');
    if (params.code_challenge_method !== 'S256' || !params.code_challenge || !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge)) {
      throw new OAuthError('invalid_request', 'PKCE with S256 is required.');
    }
    return { client, scopes: parseScopes(params.scope), redirectUri: params.redirect_uri, codeChallenge: params.code_challenge };
  }

  /** The person said yes: a one-minute code bound to everything they agreed to. */
  async issueCode(params: AuthorizeParams, userId: string, organizationId: string): Promise<string> {
    const { client, scopes, redirectUri, codeChallenge } = await this.validateAuthorize(params);
    const code = base64url(randomBytes(32));
    await this.codes.save(
      this.codes.create({
        codeHash: sha256(code),
        clientId: client.clientId,
        userId,
        organizationId,
        redirectUri,
        codeChallenge,
        scope: scopes.join(' '),
        expiresAt: new Date(Date.now() + CODE_TTL_MS),
        usedAt: null,
      }),
    );
    return code;
  }

  redirectWith(redirectUri: string, values: Record<string, string | undefined>): string {
    const url = new URL(redirectUri);
    for (const [key, value] of Object.entries(values)) if (value !== undefined) url.searchParams.set(key, value);
    return url.toString();
  }

  // ── Tokens ──────────────────────────────────────────────────────────────────

  async token(body: Record<string, unknown>) {
    const grant = body['grant_type'];
    if (grant === 'authorization_code') return this.exchangeCode(body);
    if (grant === 'refresh_token') return this.refresh(body);
    throw new OAuthError('unsupported_grant_type', 'grant_type must be authorization_code or refresh_token.');
  }

  private async exchangeCode(body: Record<string, unknown>) {
    const code = String(body['code'] ?? '');
    const row = code ? await this.codes.findOne({ where: { codeHash: sha256(code) } }) : null;
    if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'The code is invalid, used or expired.');
    if (row.clientId !== body['client_id'] || row.redirectUri !== body['redirect_uri']) throw new OAuthError('invalid_grant', 'The code was issued to another client or address.');
    if (!pkceMatches(String(body['code_verifier'] ?? ''), row.codeChallenge)) throw new OAuthError('invalid_grant', 'code_verifier does not match.');
    // One use only, even under a race: the update that marks it used is the claim.
    const claimed = await this.codes.update({ codeHash: row.codeHash, usedAt: IsNull() }, { usedAt: new Date() });
    if (!claimed.affected) throw new OAuthError('invalid_grant', 'The code was already used.');
    return this.issueTokens(row.clientId, row.userId, row.organizationId, row.scope, randomUUID());
  }

  private async refresh(body: Record<string, unknown>) {
    const presented = String(body['refresh_token'] ?? '');
    const row = presented ? await this.tokens.findOne({ where: { tokenHash: sha256(presented), kind: 'REFRESH' } }) : null;
    if (!row || row.clientId !== body['client_id']) throw new OAuthError('invalid_grant', 'Unknown refresh token.');
    if (row.revokedAt) {
      // A spent refresh token presented again: someone else has a copy. Everything from it goes.
      await this.revokeFamily(row.familyId);
      throw new OAuthError('invalid_grant', 'The refresh token was already used; the authorisation has been revoked.');
    }
    if (row.expiresAt.getTime() < Date.now()) throw new OAuthError('invalid_grant', 'The refresh token expired.');
    const claimed = await this.tokens.update({ id: row.id, revokedAt: IsNull() }, { revokedAt: new Date() });
    if (!claimed.affected) {
      await this.revokeFamily(row.familyId);
      throw new OAuthError('invalid_grant', 'The refresh token was already used; the authorisation has been revoked.');
    }
    const asked = typeof body['scope'] === 'string' ? parseScopes(body['scope']) : null;
    const granted = row.scope.split(' ');
    if (asked && asked.some((scope) => !granted.includes(scope))) throw new OAuthError('invalid_scope', 'A refresh cannot widen the scope.');
    return this.issueTokens(row.clientId, row.userId, row.organizationId, (asked ?? granted).join(' '), row.familyId);
  }

  private async issueTokens(clientId: string, userId: string, organizationId: string, scope: string, familyId: string) {
    const access = base64url(randomBytes(32));
    const refresh = base64url(randomBytes(32));
    await this.tokens.save([
      this.tokens.create({ tokenHash: sha256(access), kind: 'ACCESS', familyId, clientId, userId, organizationId, scope, expiresAt: new Date(Date.now() + ACCESS_TTL_SECONDS * 1000), revokedAt: null }),
      this.tokens.create({ tokenHash: sha256(refresh), kind: 'REFRESH', familyId, clientId, userId, organizationId, scope, expiresAt: new Date(Date.now() + REFRESH_TTL_MS), revokedAt: null }),
    ]);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_SECONDS, refresh_token: refresh, scope };
  }

  /** RFC 7009: revoking either token ends the whole authorisation. Unknown tokens are not an error. */
  async revoke(token: string): Promise<void> {
    const row = token ? await this.tokens.findOne({ where: { tokenHash: sha256(token) } }) : null;
    if (row) await this.revokeFamily(row.familyId);
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.tokens.update({ familyId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async resolve(accessToken: string): Promise<ResolvedToken | null> {
    if (!accessToken) return null;
    const row = await this.tokens.findOne({ where: { tokenHash: sha256(accessToken), kind: 'ACCESS', revokedAt: IsNull(), expiresAt: MoreThan(new Date()) } });
    if (!row) return null;
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 5 * 60_000) await this.tokens.update({ id: row.id }, { lastUsedAt: new Date() });
    return { userId: row.userId, organizationId: row.organizationId, clientId: row.clientId, scopes: row.scope.split(' ') as McpScope[], familyId: row.familyId };
  }

  // ── A person's connected agents ─────────────────────────────────────────────

  async grants(userId: string, organizationId: string) {
    const rows = await this.tokens.find({ where: { userId, organizationId, revokedAt: IsNull(), expiresAt: MoreThan(new Date()) }, order: { createdAt: 'DESC' } });
    const clients = new Map((await this.clients.find({ where: { clientId: In([...new Set(rows.map((row) => row.clientId))]) } })).map((client) => [client.clientId, client]));
    const families = new Map<string, { id: string; client: string; scope: string; since: Date; lastUsedAt: Date | null }>();
    for (const row of rows) {
      const current = families.get(row.familyId);
      const lastUsedAt = [current?.lastUsedAt, row.lastUsedAt].filter((value): value is Date => !!value).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      families.set(row.familyId, {
        id: row.familyId,
        client: clients.get(row.clientId)?.name ?? row.clientId,
        scope: row.scope,
        since: current && current.since < row.createdAt ? current.since : row.createdAt,
        lastUsedAt,
      });
    }
    return [...families.values()];
  }

  async revokeGrant(userId: string, organizationId: string, familyId: string): Promise<void> {
    await this.tokens.update({ familyId, userId, organizationId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}

import { createHash } from 'crypto';
import { McpOAuthService, OAuthError, parseScopes, pkceMatches, redirectUriAllowed } from './mcp-oauth.service';

/** An in-memory stand-in for the three tables, enough for the OAuth flows. */
function repo<T extends Record<string, unknown>>(key: string) {
  const rows: T[] = [];
  const matches = (row: T, where: Record<string, unknown>) =>
    Object.entries(where).every(([field, value]) => {
      const actual = row[field];
      if (value && typeof value === 'object' && '_type' in (value as object)) {
        const op = value as { _type: string; _value: unknown };
        if (op._type === 'isNull') return actual === null || actual === undefined;
        if (op._type === 'moreThan') return (actual as Date) > (op._value as Date);
        if (op._type === 'in') return (op._value as unknown[]).includes(actual);
      }
      return actual === value;
    });
  return {
    rows,
    create: (row: T) => ({ ...row }),
    save: async (input: T | T[]) => {
      for (const row of Array.isArray(input) ? input : [input]) {
        (row as Record<string, unknown>)['createdAt'] ??= new Date();
        (row as Record<string, unknown>)['id'] ??= `${key}-${rows.length + 1}`;
        rows.push(row);
      }
      return input;
    },
    findOne: async ({ where }: { where: Record<string, unknown> }) => rows.find((row) => matches(row, where)) ?? null,
    find: async ({ where }: { where: Record<string, unknown> }) => rows.filter((row) => matches(row, where)),
    update: async (where: Record<string, unknown>, change: Partial<T>) => {
      const hit = rows.filter((row) => matches(row, where));
      hit.forEach((row) => Object.assign(row, change));
      return { affected: hit.length };
    },
  };
}

const verifier = 'v'.repeat(50);
const challenge = createHash('sha256').update(verifier).digest('base64url');

function build() {
  const service = new McpOAuthService(repo('client') as never, repo('code') as never, repo('token') as never, { get: () => 'https://app.virtex.test' } as never);
  return service;
}

describe('McpOAuthService', () => {
  it('accepts only redirect addresses an agent can safely be sent to', () => {
    expect(redirectUriAllowed('https://claude.ai/api/mcp/auth_callback')).toBe(true);
    expect(redirectUriAllowed('http://127.0.0.1:33418/callback')).toBe(true);
    expect(redirectUriAllowed('cursor://anysphere.cursor-retrieval/oauth')).toBe(true);
    expect(redirectUriAllowed('http://evil.com/cb')).toBe(false);
    expect(redirectUriAllowed('javascript:alert(1)')).toBe(false);
    expect(redirectUriAllowed('https://a.com/cb#frag')).toBe(false);
  });

  it('checks PKCE with S256 only, and known scopes', () => {
    expect(pkceMatches(verifier, challenge)).toBe(true);
    expect(pkceMatches('w'.repeat(50), challenge)).toBe(false);
    expect(parseScopes(undefined)).toEqual(['erp:read']);
    expect(() => parseScopes('erp:read admin')).toThrow(OAuthError);
  });

  it('registers a public client, issues a one-time code and exchanges it for tokens bound to the person', async () => {
    const service = build();
    const client = await service.register({ client_name: 'Claude', redirect_uris: ['https://claude.ai/cb'] });
    const params = { response_type: 'code', client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_challenge: challenge, code_challenge_method: 'S256', scope: 'erp:read erp:draft' };
    const code = await service.issueCode(params, 'user-1', 'org-1');
    const tokens = await service.token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: verifier });
    expect(tokens).toMatchObject({ token_type: 'Bearer', expires_in: 3600, scope: 'erp:read erp:draft' });
    expect(await service.resolve(tokens.access_token)).toMatchObject({ userId: 'user-1', organizationId: 'org-1', scopes: ['erp:read', 'erp:draft'] });
    // The same code twice is refused.
    await expect(service.token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://claude.ai/cb', code_verifier: verifier })).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('refuses a code without the right verifier, client or address, and a request without PKCE', async () => {
    const service = build();
    const client = await service.register({ redirect_uris: ['https://a.com/cb'] });
    await expect(service.validateAuthorize({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://a.com/cb' })).rejects.toMatchObject({ error: 'invalid_request' });
    await expect(service.validateAuthorize({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://b.com/cb', code_challenge: challenge, code_challenge_method: 'S256' })).rejects.toMatchObject({ error: 'invalid_redirect_uri' });
    const code = await service.issueCode({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://a.com/cb', code_challenge: challenge, code_challenge_method: 'S256' }, 'u', 'o');
    await expect(service.token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://a.com/cb', code_verifier: 'x'.repeat(50) })).rejects.toMatchObject({ error: 'invalid_grant' });
  });

  it('rotates refresh tokens and revokes the whole authorisation when a spent one comes back', async () => {
    const service = build();
    const client = await service.register({ redirect_uris: ['https://a.com/cb'] });
    const code = await service.issueCode({ response_type: 'code', client_id: client.client_id, redirect_uri: 'https://a.com/cb', code_challenge: challenge, code_challenge_method: 'S256' }, 'u', 'o');
    const first = await service.token({ grant_type: 'authorization_code', code, client_id: client.client_id, redirect_uri: 'https://a.com/cb', code_verifier: verifier });
    const second = await service.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id });
    expect(await service.resolve(second.access_token)).not.toBeNull();
    await expect(service.token({ grant_type: 'refresh_token', refresh_token: first.refresh_token, client_id: client.client_id })).rejects.toMatchObject({ error: 'invalid_grant' });
    expect(await service.resolve(second.access_token)).toBeNull();
    await expect(service.token({ grant_type: 'refresh_token', refresh_token: second.refresh_token, client_id: client.client_id, scope: 'erp:draft' })).rejects.toMatchObject({ error: 'invalid_grant' });
  });
});

import { Injectable, Logger, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Issuer } from 'openid-client';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { SocialUser } from '../interfaces/social-user.interface';

/**
 * A fully-resolved OIDC client configuration. Phase 1 builds these from environment
 * variables (Google, Microsoft); Phase 2 (enterprise SSO) will build the same shape from
 * a per-tenant IdentityProvider record, so the discovery / exchange / validation logic is
 * shared by both flows.
 */
export interface OidcClientConfig {
  /** Logical key — 'google', 'microsoft', or an enterprise IdP id. */
  key: string;
  /** OIDC issuer / discovery base URL (the `.well-known/openid-configuration` parent). */
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scope: string;
  /**
   * 'exact'                → the id_token `iss` must equal the discovered issuer (the normal case).
   * 'microsoft-multitenant'→ `common`/`organizations`: `iss` is per-tenant, validated against
   *                          `https://login.microsoftonline.com/<tid>/v2.0`.
   */
  issuerValidation: 'exact' | 'microsoft-multitenant';
  /** Provider-specific extra authorization parameters (e.g. Microsoft `prompt`). */
  extraAuthParams?: Record<string, string>;
}

// Azure AD "consumers" tenant (personal Microsoft accounts). Used to decide whether an
// account is organization-managed (and therefore email-verified by the tenant).
const MS_CONSUMERS_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

@Injectable()
export class OidcProviderService {
  private readonly logger = new Logger(OidcProviderService.name);
  // Discovery is network I/O; cache the resolved Issuer and JWKS per issuer URL so we do it
  // once per process, not per request.
  private readonly issuerCache = new Map<string, Promise<Issuer>>();
  private readonly jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

  constructor(private readonly configService: ConfigService) {}

  // ---------------------------------------------------------------------------
  // Phase 1: environment-based provider configs
  // ---------------------------------------------------------------------------

  /** Whether a built-in social provider has its credentials configured. */
  isProviderConfigured(provider: string): boolean {
    try {
      this.getProviderConfig(provider);
      return true;
    } catch {
      return false;
    }
  }

  /** Resolve a built-in social provider ('google' | 'microsoft') from env. */
  getProviderConfig(provider: string): OidcClientConfig {
    switch (provider) {
      case 'google':
        return {
          key: 'google',
          issuerUrl: 'https://accounts.google.com',
          clientId: this.required('GOOGLE_CLIENT_ID'),
          clientSecret: this.required('GOOGLE_CLIENT_SECRET'),
          redirectUri: this.required('GOOGLE_CALLBACK_URL'),
          scope: 'openid email profile',
          issuerValidation: 'exact',
        };
      case 'microsoft': {
        const tenant = this.configService.get<string>('MICROSOFT_TENANT', 'common');
        const isMultiTenant = ['common', 'organizations', 'consumers'].includes(tenant);
        return {
          key: 'microsoft',
          issuerUrl: `https://login.microsoftonline.com/${tenant}/v2.0`,
          clientId: this.required('MICROSOFT_CLIENT_ID'),
          clientSecret: this.required('MICROSOFT_CLIENT_SECRET'),
          redirectUri: this.required('MICROSOFT_CALLBACK_URL'),
          scope: 'openid email profile',
          issuerValidation: isMultiTenant ? 'microsoft-multitenant' : 'exact',
          // Force account selection so users can switch accounts/tenants explicitly.
          extraAuthParams: { prompt: 'select_account' },
        };
      }
      default:
        throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }
  }

  private required(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new BadRequestException(`Provider not configured: missing ${key}`);
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Discovery (cached)
  // ---------------------------------------------------------------------------

  private discover(issuerUrl: string): Promise<Issuer> {
    let cached = this.issuerCache.get(issuerUrl);
    if (!cached) {
      cached = Issuer.discover(issuerUrl).catch((err) => {
        // Don't cache failures — allow the next request to retry discovery.
        this.issuerCache.delete(issuerUrl);
        this.logger.error(`OIDC discovery failed for ${issuerUrl}: ${err?.message}`);
        throw new BadRequestException('Identity provider is temporarily unavailable.');
      });
      this.issuerCache.set(issuerUrl, cached);
    }
    return cached;
  }

  private getJwks(jwksUri: string) {
    let jwks = this.jwksCache.get(jwksUri);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(jwksUri));
      this.jwksCache.set(jwksUri, jwks);
    }
    return jwks;
  }

  // ---------------------------------------------------------------------------
  // Authorization URL
  // ---------------------------------------------------------------------------

  async buildAuthorizationUrl(
    config: OidcClientConfig,
    params: { state: string; nonce: string; codeChallenge: string },
  ): Promise<string> {
    const issuer = await this.discover(config.issuerUrl);
    const authEndpoint = issuer.metadata.authorization_endpoint;
    if (!authEndpoint) {
      throw new BadRequestException('Identity provider has no authorization endpoint.');
    }
    const url = new URL(authEndpoint);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', config.redirectUri);
    url.searchParams.set('scope', config.scope);
    url.searchParams.set('state', params.state);
    url.searchParams.set('nonce', params.nonce);
    url.searchParams.set('code_challenge', params.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('response_mode', 'query');
    for (const [k, v] of Object.entries(config.extraAuthParams ?? {})) {
      url.searchParams.set(k, v);
    }
    return url.toString();
  }

  // ---------------------------------------------------------------------------
  // Token exchange + id_token validation
  // ---------------------------------------------------------------------------

  /**
   * Exchange the authorization code (with PKCE) and fully validate the returned id_token:
   * signature via the issuer JWKS, audience = clientId, nonce binding, expiry, and issuer
   * (exact or Microsoft multi-tenant pattern). Returns the verified claims plus the raw
   * access token.
   */
  async exchangeAndValidate(
    config: OidcClientConfig,
    input: { code: string; codeVerifier: string; expectedNonce: string },
  ): Promise<{ claims: JWTPayload; accessToken?: string }> {
    const issuer = await this.discover(config.issuerUrl);
    const tokenEndpoint = issuer.metadata.token_endpoint;
    const jwksUri = issuer.metadata.jwks_uri;
    if (!tokenEndpoint || !jwksUri) {
      throw new BadRequestException('Identity provider metadata is incomplete.');
    }

    // --- 1. Exchange the code for tokens (confidential client + PKCE) ---
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: input.codeVerifier,
    });

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });

    if (!tokenRes.ok) {
      const detail = await tokenRes.text().catch(() => '');
      this.logger.warn(`Token exchange failed (${config.key}, ${tokenRes.status}): ${detail.slice(0, 200)}`);
      throw new UnauthorizedException('Failed to complete sign-in with the identity provider.');
    }

    const tokens = (await tokenRes.json()) as { id_token?: string; access_token?: string };
    if (!tokens.id_token) {
      throw new UnauthorizedException('Identity provider did not return an id_token.');
    }

    // --- 2. Cryptographically validate the id_token ---
    const jwks = this.getJwks(jwksUri);
    let payload: JWTPayload;
    try {
      const verifyOptions: Parameters<typeof jwtVerify>[2] = {
        audience: config.clientId,
        clockTolerance: 60, // tolerate minor clock skew
      };
      if (config.issuerValidation === 'exact') {
        verifyOptions.issuer = issuer.metadata.issuer;
      }
      ({ payload } = await jwtVerify(tokens.id_token, jwks, verifyOptions));
    } catch (err) {
      this.logger.warn(`id_token validation failed (${config.key}): ${(err as Error)?.message}`);
      throw new UnauthorizedException('Identity token validation failed.');
    }

    // Microsoft multi-tenant: validate the per-tenant issuer explicitly.
    if (config.issuerValidation === 'microsoft-multitenant') {
      const tid = payload['tid'] as string | undefined;
      const expectedIss = `https://login.microsoftonline.com/${tid}/v2.0`;
      if (!tid || payload.iss !== expectedIss) {
        throw new UnauthorizedException('Untrusted token issuer.');
      }
    }

    // --- 3. Nonce binding (replay protection) ---
    if (payload['nonce'] !== input.expectedNonce) {
      throw new UnauthorizedException('Identity token nonce mismatch.');
    }

    return { claims: payload, accessToken: tokens.access_token };
  }

  // ---------------------------------------------------------------------------
  // Claims → SocialUser
  // ---------------------------------------------------------------------------

  mapClaimsToSocialUser(provider: string, claims: JWTPayload, accessToken?: string): SocialUser {
    const sub = String(claims.sub ?? '');
    const email = this.extractEmail(claims);
    if (!email) {
      throw new UnauthorizedException('Identity provider did not return an email address.');
    }
    const { firstName, lastName } = this.extractName(claims);

    return {
      provider,
      providerId: sub,
      email: email.toLowerCase(),
      firstName,
      lastName,
      picture: (claims['picture'] as string) || undefined,
      emailVerified: this.extractEmailVerified(provider, claims),
      accessToken,
    };
  }

  private extractEmail(claims: JWTPayload): string | undefined {
    return (
      (claims['email'] as string) ||
      (claims['preferred_username'] as string) ||
      (claims['upn'] as string) ||
      undefined
    );
  }

  private extractName(claims: JWTPayload): { firstName: string; lastName: string } {
    const given = (claims['given_name'] as string) || '';
    const family = (claims['family_name'] as string) || '';
    if (given || family) {
      return { firstName: given, lastName: family };
    }
    const fullName = (claims['name'] as string) || '';
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
    };
  }

  private extractEmailVerified(provider: string, claims: JWTPayload): boolean {
    if (claims['email_verified'] === true || claims['email_verified'] === 'true') {
      return true;
    }
    if (provider === 'microsoft') {
      // Microsoft v2 id_tokens omit email_verified. Organization-managed accounts (a real
      // tenant id, not the personal-accounts tenant) have IdP-verified email addresses.
      const tid = claims['tid'] as string | undefined;
      const isOrgAccount = !!tid && tid !== MS_CONSUMERS_TENANT;
      // Microsoft also exposes `xms_edov` (email domain owner verified) on some tokens.
      return isOrgAccount || claims['xms_edov'] === true || claims['xms_edov'] === 'true';
    }
    return false;
  }
}

import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { OidcProviderService } from './oidc-provider.service';

function makeService(env: Record<string, string> = {}): OidcProviderService {
  const config = {
    get: (key: string, def?: unknown) => env[key] ?? def,
  } as unknown as ConfigService;
  return new OidcProviderService(config);
}

const FULL_ENV = {
  GOOGLE_CLIENT_ID: 'gid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/google/callback',
  MICROSOFT_CLIENT_ID: 'mid',
  MICROSOFT_CLIENT_SECRET: 'msecret',
  MICROSOFT_CALLBACK_URL: 'http://localhost:3000/api/v1/auth/microsoft/callback',
};

describe('OidcProviderService', () => {
  describe('getProviderConfig', () => {
    it('builds a Google config with exact issuer validation', () => {
      const service = makeService(FULL_ENV);
      const cfg = service.getProviderConfig('google');
      expect(cfg.issuerUrl).toBe('https://accounts.google.com');
      expect(cfg.clientId).toBe('gid');
      expect(cfg.issuerValidation).toBe('exact');
    });

    it('builds a Microsoft multi-tenant config for the common tenant', () => {
      const service = makeService({ ...FULL_ENV, MICROSOFT_TENANT: 'common' });
      const cfg = service.getProviderConfig('microsoft');
      expect(cfg.issuerUrl).toBe('https://login.microsoftonline.com/common/v2.0');
      expect(cfg.issuerValidation).toBe('microsoft-multitenant');
      expect(cfg.extraAuthParams?.prompt).toBe('select_account');
    });

    it('uses exact issuer validation for a specific Microsoft tenant', () => {
      const service = makeService({ ...FULL_ENV, MICROSOFT_TENANT: 'tenant-guid-123' });
      const cfg = service.getProviderConfig('microsoft');
      expect(cfg.issuerValidation).toBe('exact');
    });

    it('throws for an unsupported provider', () => {
      const service = makeService(FULL_ENV);
      expect(() => service.getProviderConfig('facebook')).toThrow(BadRequestException);
    });

    it('throws when provider credentials are missing', () => {
      const service = makeService({});
      expect(() => service.getProviderConfig('google')).toThrow(/missing GOOGLE_CLIENT_ID/);
    });
  });

  describe('isProviderConfigured', () => {
    it('returns true when configured, false otherwise', () => {
      expect(makeService(FULL_ENV).isProviderConfigured('google')).toBe(true);
      expect(makeService({}).isProviderConfigured('google')).toBe(false);
    });
  });

  describe('mapClaimsToSocialUser', () => {
    it('maps Google claims with verified email', () => {
      const service = makeService(FULL_ENV);
      const user = service.mapClaimsToSocialUser(
        'google',
        {
          sub: 'google-sub-1',
          email: 'Jane@Example.com',
          email_verified: true,
          given_name: 'Jane',
          family_name: 'Doe',
          picture: 'https://pic',
        } as any,
        'access-token',
      );
      expect(user.provider).toBe('google');
      expect(user.providerId).toBe('google-sub-1');
      expect(user.email).toBe('jane@example.com'); // normalized
      expect(user.firstName).toBe('Jane');
      expect(user.lastName).toBe('Doe');
      expect(user.emailVerified).toBe(true);
      expect(user.accessToken).toBe('access-token');
    });

    it('treats a Microsoft organization account (tid present) as email-verified', () => {
      const service = makeService(FULL_ENV);
      const user = service.mapClaimsToSocialUser('microsoft', {
        sub: 'ms-sub-1',
        preferred_username: 'bob@acme.com',
        name: 'Bob Smith',
        tid: 'a-real-tenant-guid',
      } as any);
      expect(user.email).toBe('bob@acme.com');
      expect(user.firstName).toBe('Bob');
      expect(user.lastName).toBe('Smith');
      expect(user.emailVerified).toBe(true);
    });

    it('does not auto-verify Microsoft personal accounts (consumers tenant)', () => {
      const service = makeService(FULL_ENV);
      const user = service.mapClaimsToSocialUser('microsoft', {
        sub: 'ms-sub-2',
        email: 'someone@outlook.com',
        name: 'Personal User',
        tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
      } as any);
      expect(user.emailVerified).toBe(false);
    });

    it('throws when no email claim is present', () => {
      const service = makeService(FULL_ENV);
      expect(() =>
        service.mapClaimsToSocialUser('google', { sub: 'x', name: 'No Email' } as any),
      ).toThrow(/email/i);
    });
  });
});

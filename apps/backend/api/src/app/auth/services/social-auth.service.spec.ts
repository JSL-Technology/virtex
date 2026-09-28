import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { SocialAuthService } from './social-auth.service';
import { UserStatus } from '../../users/entities/user.entity/user.entity';

/**
 * Linking a federated identity to an existing account.
 *
 * An email address is an attribute; the provider's subject (`sub`) is the identity. These tests
 * pin the two rules that keep a matching address from being enough:
 *
 *  - a new link needs an address the provider VERIFIED (see OidcProviderService for why a
 *    Microsoft organizational tenant is not, by itself, verification);
 *  - an account already bound to a subject at a provider is never re-bound to another one.
 */
describe('SocialAuthService — linking a federated identity', () => {
  const makeService = (existing: Record<string, unknown> | null) => {
    const usersService = {
      findUserForAuth: jest.fn().mockResolvedValue(existing),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const tokenService = { generateAuthResponse: jest.fn().mockResolvedValue({ accessToken: 'a' }) };
    const service = new SocialAuthService(
      usersService as never,
      {} as never,
      {} as never,
      { record: jest.fn() } as never,
      { checkImpossibleTravel: jest.fn() } as never,
      tokenService as never,
    );
    return { service, usersService, tokenService };
  };

  const account = (over: Record<string, unknown> = {}) => ({
    id: 'u1',
    email: 'ana@acme.com',
    status: UserStatus.ACTIVE,
    authProvider: 'microsoft',
    authProviderId: 'subject-ana',
    security: { isTwoFactorEnabled: false },
    ...over,
  });

  const signIn = (over: Record<string, unknown> = {}) => ({
    provider: 'microsoft',
    providerId: 'subject-ana',
    email: 'ana@acme.com',
    firstName: 'Ana',
    lastName: 'P',
    emailVerified: true,
    ...over,
  });

  it('signs in the subject the account is bound to', async () => {
    const { service, tokenService } = makeService(account());
    await expect(service.validateOAuthLogin(signIn() as never)).resolves.toMatchObject({ tokens: { accessToken: 'a' } });
    expect(tokenService.generateAuthResponse).toHaveBeenCalled();
  });

  it('refuses a different subject at the same provider, even with a verified matching address', async () => {
    const { service, usersService } = makeService(account());
    await expect(
      service.validateOAuthLogin(signIn({ providerId: 'someone-else' }) as never),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('refuses a first link when the provider has not verified the address', async () => {
    const { service, usersService } = makeService(account({ authProvider: null, authProviderId: null, security: {} }));
    await expect(
      service.validateOAuthLogin(signIn({ emailVerified: false }) as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('links a first federated identity whose address the provider verified', async () => {
    const { service, usersService } = makeService(account({ authProvider: 'microsoft', authProviderId: null, security: {} }));
    await service.validateOAuthLogin(signIn() as never);
    expect(usersService.update).toHaveBeenCalledWith('u1', expect.objectContaining({ authProviderId: 'subject-ana' }));
  });
});

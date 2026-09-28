import { AuthStepUpController } from './auth-step-up.controller';

/**
 * Re-authenticating at the identity provider for one sensitive action.
 *
 * The callback used to accept any identity the provider returned with the signed-in user's email.
 * It now requires what sign-in requires: an address the provider verified, and — for an account
 * bound to a subject at that provider — the same subject.
 */
describe('federated step-up callback', () => {
  const user = { id: 'u1', email: 'ana@acme.com' } as never;

  const build = (
    asserted: Record<string, unknown>,
    bound: Record<string, unknown> = {},
    options: { enterprise?: boolean } = {},
  ) => {
    const flow = options.enterprise ? 'sso-idp1' : 'microsoft';
    const authService = {
      findUserForStepUp: jest.fn().mockResolvedValue({ authProvider: 'microsoft', authProviderId: 'sub-ana', ...bound }),
      issueStepUpTokenAfterFederatedReauth: jest.fn().mockReturnValue({ stepUpToken: 't', maxAgeMs: 1000 }),
    };
    const oauthState = {
      readTransaction: jest.fn().mockReturnValue({
        flow: `stepup:${flow}:view_payroll_data`,
        state: 's', codeVerifier: 'v', nonce: 'n', returnTo: '/payroll',
      }),
      verifyState: jest.fn(),
      clearTransactionCookie: jest.fn(),
    };
    const oidc = {
      isProviderConfigured: jest.fn().mockReturnValue(true),
      getProviderConfig: jest.fn().mockReturnValue({ key: 'microsoft' }),
      stepUpRedirectUri: jest.fn().mockReturnValue('https://api/step-up/sso/callback'),
      exchangeAndValidate: jest.fn().mockResolvedValue({ claims: {} }),
      mapClaimsToSocialUser: jest.fn().mockReturnValue({
        provider: 'microsoft', providerId: 'sub-ana', email: 'ana@acme.com', emailVerified: true,
        ...asserted,
      }),
    };
    const cookies = { setStepUpCookie: jest.fn() };
    const links = { stepUpComplete: jest.fn().mockReturnValue('/ok'), stepUpFailed: jest.fn().mockReturnValue('/failed') };
    const controller = new AuthStepUpController(
      authService as never,
      {} as never,
      cookies as never,
      oauthState as never,
      oidc as never,
      {
        discoverByEmail: jest.fn().mockResolvedValue(options.enterprise ? { idpId: 'idp1' } : null),
        getEnabledIdpOrThrow: jest.fn().mockResolvedValue({ id: 'idp1' }),
        buildConfig: jest.fn().mockReturnValue({ key: 'sso:idp1' }),
      } as never,
      links as never,
    );
    const res = { redirect: jest.fn() };
    const run = () =>
      controller.stepUpSsoCallback(user, { query: { code: 'c', state: 's' } } as never, res as never);
    return { run, res, cookies, authService };
  };

  it('issues the proof when the provider re-authenticated the same, verified identity', async () => {
    const { run, res, cookies } = build({});
    await run();
    expect(cookies.setStepUpCookie).toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/ok');
  });

  it('refuses a different subject carrying the same address', async () => {
    const { run, res, cookies } = build({ providerId: 'sub-someone-else' });
    await run();
    expect(cookies.setStepUpCookie).not.toHaveBeenCalled();
    expect(res.redirect).toHaveBeenCalledWith('/failed');
  });

  it('accepts the bound subject even when the provider does not vouch for the address', async () => {
    // A Microsoft app registration without the `xms_edov` claim reports every address as
    // unverified. The subject is the identity, so an account bound to it is not locked out.
    const { run, cookies } = build({ emailVerified: false });
    await run();
    expect(cookies.setStepUpCookie).toHaveBeenCalled();
  });

  describe('an account re-authenticating at its organization\'s IdP, found by domain', () => {
    // Provisioned by SSO: bound to `sso`, which is not the `sso-<idp>` flow, so no subject is
    // compared — the organization's IdP is authoritative for its verified domains.
    const unbound = { authProvider: 'sso', authProviderId: 'sub-at-idp' };
    const enterprise = { enterprise: true };

    it('refuses an address the provider did not verify', async () => {
      const { run, res, cookies } = build({ emailVerified: false }, unbound, enterprise);
      await run();
      expect(cookies.setStepUpCookie).not.toHaveBeenCalled();
      expect(res.redirect).toHaveBeenCalledWith('/failed');
    });

    it('refuses another address altogether', async () => {
      const { run, cookies } = build({ email: 'mallory@acme.com' }, unbound, enterprise);
      await run();
      expect(cookies.setStepUpCookie).not.toHaveBeenCalled();
    });

    it('accepts the verified address of the signed-in user', async () => {
      const { run, cookies } = build({}, unbound, enterprise);
      await run();
      expect(cookies.setStepUpCookie).toHaveBeenCalled();
    });
  });
});

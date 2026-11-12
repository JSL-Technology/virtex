import { TransmissionConfigService } from './transmission-config.service';
import { checkPublicHttpsEndpoint, isBlockedAddress } from '../../common/net/outbound-address';

/**
 * FAC-EINV-04: the endpoint and credential of the authority were process-wide environment
 * variables, shared by every tenant of a market.
 */
describe('checkPublicHttpsEndpoint', () => {
  it.each([
    ['http://pac.example.com/stamp', 'scheme_not_allowed'],
    ['https://user:pw@pac.example.com/', 'credentials_in_url'],
    ['https://pac.example.com:22/', 'port_not_allowed'],
    ['https://127.0.0.1/stamp', 'private_address'],
    ['https://169.254.169.254/latest/meta-data', 'private_address'],
    ['https://[::1]/', 'private_address'],
    ['https://10.0.0.5/', 'private_address'],
    ['not a url', 'invalid_url'],
  ])('refuses %s (%s)', async (url, reason) => {
    await expect(checkPublicHttpsEndpoint(url)).resolves.toBe(reason);
  });

  it('accepts a public HTTPS address', async () => {
    await expect(checkPublicHttpsEndpoint('https://8.8.8.8/stamp')).resolves.toBeNull();
  });

  it('the address check is the same one the workflow webhooks use', () => {
    expect(isBlockedAddress('192.168.1.10')).toBe(true);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
  });
});

describe('TransmissionConfigService', () => {
  const build = (initial: Record<string, unknown> | null, env: Record<string, string> = {}) => {
    let stored = initial ? { ...initial } : null;
    const query = {
      addSelect: () => query,
      where: () => query,
      andWhere: () => query,
      getOne: async () => (stored ? { ...stored } : null),
    };
    const repository = {
      createQueryBuilder: () => query,
      create: (value: object) => ({ ...value }),
      save: jest.fn(async (value: Record<string, unknown>) => {
        stored = { ...value };
        return value;
      }),
    };
    // A reversible stand-in for the at-rest cipher: the service must store only what it returns.
    const crypto = { encrypt: (plain: string) => `enc(${plain})`, decrypt: (cipher: string) => cipher.slice(4, -1) };
    const config = { get: (key: string) => env[key] };
    const service = new TransmissionConfigService(repository as never, crypto as never, config as never);
    return { service, repository, stored: () => stored };
  };

  it('stores the credential encrypted and never returns it', async () => {
    const { service, stored } = build(null);
    const view = await service.save('org-1', 'MX', {
      transmissionEndpoint: 'https://8.8.8.8/stamp',
      credentialScheme: 'BEARER',
      credential: 'token-secreto',
    });
    expect(stored()?.['credentialCiphertext']).toBe('enc(token-secreto)');
    expect(JSON.stringify(view)).not.toContain('token-secreto');
    expect(view).toMatchObject({ configured: true, hasCredential: true, credentialScheme: 'BEARER' });
  });

  it('resolves the tenant target with the decrypted header', async () => {
    const { service } = build({ transmissionEndpoint: 'https://8.8.8.8/s', credentialScheme: 'BASIC', credentialCiphertext: 'enc(usuario:clave)' });
    await expect(service.resolve('org-1', 'MX')).resolves.toMatchObject({
      endpoint: 'https://8.8.8.8/s',
      authorization: `Basic ${Buffer.from('usuario:clave').toString('base64')}`,
      source: 'TENANT',
    });
  });

  it('refuses an endpoint inside the deployment', async () => {
    const { service, repository } = build(null);
    await expect(service.save('org-1', 'CO', { transmissionEndpoint: 'https://169.254.169.254/' })).rejects.toMatchObject({
      messageKey: 'einvoicing.transmission.endpoint_not_allowed',
    });
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('a shared process credential is used only when the deployment opts in', async () => {
    const env = { EINVOICE_MX_ENDPOINT: 'https://8.8.8.8/stamp', EINVOICE_MX_TOKEN: 'shared' };
    await expect(build(null, env).service.resolve('org-1', 'MX')).resolves.toBeNull();
    await expect(build(null, { ...env, EINVOICE_PROCESS_CREDENTIALS: 'allow' }).service.resolve('org-1', 'MX')).resolves.toMatchObject({ source: 'PROCESS' });
  });

  it('BASIC needs user:password, and a credential needs its scheme', async () => {
    const { service } = build(null);
    await expect(service.save('org-1', 'PE', { credential: 'x' })).rejects.toMatchObject({ messageKey: 'einvoicing.transmission.credential_scheme_required' });
    await expect(service.save('org-1', 'PE', { credential: 'sin-dos-puntos', credentialScheme: 'BASIC' })).rejects.toMatchObject({
      messageKey: 'einvoicing.transmission.basic_credential_format',
    });
  });
});

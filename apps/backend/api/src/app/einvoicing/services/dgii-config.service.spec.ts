import { DgiiConfigService } from './dgii-config.service';
import { FiscalEnvironment } from '../entities/fiscal-regime-settings.entity';

/**
 * EINV-04 (audit 2026-10-31): the DGII environment was one per process, CerteCF when unset, so a
 * SaaS could not have tenants in certification and in production at once — and a production
 * deployment that forgot the variable filed every tenant's e-CF where they have no validity.
 */
describe('DgiiConfigService — the environment is the tenant’s', () => {
  const originalNodeEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });
  function service(env: Record<string, string | undefined>, saved: Record<string, FiscalEnvironment>) {
    process.env['NODE_ENV'] = env['NODE_ENV'];
    const config = { get: (key: string) => env[key] };
    const settings = {
      findOne: jest.fn(async ({ where }: { where: { organizationId: string } }) =>
        saved[where.organizationId] ? { id: 'x', environment: saved[where.organizationId] } : null,
      ),
    };
    return new DgiiConfigService(config as never, settings as never);
  }
  const saved = { prod: FiscalEnvironment.PRODUCTION, cert: FiscalEnvironment.CERTIFICATION };

  it('sends each tenant to its own environment in production', async () => {
    const svc = service({ NODE_ENV: 'production' }, saved);
    expect(await svc.environmentFor('prod')).toBe('Produccion');
    expect(await svc.environmentFor('cert')).toBe('CerteCF');
    // A tenant that never saved its settings is certified first, never filed for real by default.
    expect(await svc.environmentFor('new')).toBe('CerteCF');
  });

  it('uses the process variable in production only where the deployment is allowed to, and only for tenants that never saved settings', async () => {
    // A deployment that configures fiscal channels process-wide says so once, with the same switch
    // every other regime reads (`EINVOICE_PROCESS_CREDENTIALS`).
    const allowed = service(
      { NODE_ENV: 'production', DGII_ECF_ENVIRONMENT: 'Produccion', EINVOICE_PROCESS_CREDENTIALS: 'allow' },
      saved,
    );
    expect(await allowed.environmentFor('new')).toBe('Produccion');
    // A tenant that saved its own settings is unaffected either way.
    expect(await allowed.environmentFor('cert')).toBe('CerteCF');

    // Without the switch the variable decides nothing: a SaaS tenant's channel is its own.
    const notAllowed = service({ NODE_ENV: 'production', DGII_ECF_ENVIRONMENT: 'Produccion' }, saved);
    expect(await notAllowed.environmentFor('new')).toBe('CerteCF');
    expect(await notAllowed.environmentFor('prod')).toBe('Produccion');
  });

  /**
   * The endpoint overrides are a deployment's lever for the day the DGII republishes a host or a
   * path — not a tenant's channel. They were read in every process, so one variable pointed every
   * tenant of a SaaS at one host; the DGII was the last regime whose channel a process variable
   * could decide (plan, fase 3).
   */
  describe('the endpoint overrides', () => {
    const urls = {
      DGII_ECF_BASE_URL: 'https://ecf.example.test/pinned',
      DGII_ECF_RECEPTION_URL: 'https://ecf.example.test/pinned/recepcion',
    };

    it('are ignored in a process that was not allowed to pin them', async () => {
      const svc = service({ NODE_ENV: 'production', ...urls }, saved);
      const endpoints = await svc.endpointsFor('prod');

      expect(endpoints.reception).toBe('https://ecf.dgii.gov.do/ecf/recepcion/api/FacturasElectronicas');
      expect(endpoints.seed.startsWith('https://ecf.dgii.gov.do/ecf/')).toBe(true);
    });

    it('are used where the deployment said so, and where it is development', async () => {
      const allowed = service(
        { NODE_ENV: 'production', ...urls, EINVOICE_PROCESS_CREDENTIALS: 'allow' },
        saved,
      );
      const pinned = await allowed.endpointsFor('prod');
      expect(pinned.reception).toBe(urls.DGII_ECF_RECEPTION_URL);
      // `baseUrl` pins the rest at once, which is what differs between the DGII's own environments.
      expect(pinned.seed).toBe('https://ecf.example.test/pinned/autenticacion/api/Autenticacion/Semilla');

      const development = service({ NODE_ENV: 'development', ...urls }, saved);
      expect((await development.endpointsFor('prod')).reception).toBe(urls.DGII_ECF_RECEPTION_URL);
    });

    it('says so when it ignores them, naming the variables', async () => {
      const svc = service({ NODE_ENV: 'production', ...urls }, saved);
      const warn = jest.spyOn((svc as unknown as { logger: { warn: (m: string) => void } }).logger, 'warn');

      await svc.endpointsFor('prod');
      await svc.endpointsFor('prod');

      // Once per process, naming what was ignored and how to allow it: an override that silently
      // does nothing is how a deployment believes it is filing somewhere it is not.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('DGII_ECF_BASE_URL');
      expect(warn.mock.calls[0][0]).toContain('DGII_ECF_RECEPTION_URL');
      expect(warn.mock.calls[0][0]).toContain('EINVOICE_PROCESS_CREDENTIALS=allow');
    });
  });

  it('lets development point every tenant at TesteCF', async () => {
    const svc = service({ NODE_ENV: 'development', DGII_ECF_ENVIRONMENT: 'TesteCF' }, saved);
    expect(await svc.environmentFor('prod')).toBe('TesteCF');
  });

  it('resolves the endpoints of the tenant’s environment', async () => {
    const svc = service({ NODE_ENV: 'production' }, saved);
    const prod = await svc.endpointsFor('prod');
    const cert = await svc.endpointsFor('cert');
    expect(prod.reception).not.toBe(cert.reception);
    expect(prod.reception.startsWith('https://ecf.dgii.gov.do/ecf/')).toBe(true);
    expect(cert.reception.startsWith('https://ecf.dgii.gov.do/certecf/')).toBe(true);
  });
});

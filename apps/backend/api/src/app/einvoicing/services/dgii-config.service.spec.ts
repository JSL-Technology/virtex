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

  it('uses the process variable in production only for tenants that never saved settings', async () => {
    const svc = service({ NODE_ENV: 'production', DGII_ECF_ENVIRONMENT: 'Produccion' }, saved);
    expect(await svc.environmentFor('new')).toBe('Produccion');
    expect(await svc.environmentFor('cert')).toBe('CerteCF');
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

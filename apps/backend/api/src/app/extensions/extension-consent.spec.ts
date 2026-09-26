import { ForbiddenException } from '@nestjs/common';

import { ExtensionsService } from './extensions.service';

/**
 * El consentimiento del inquilino se podía eludir por dos caminos distintos.
 *
 *  1. **Fijar versión.** `if (version) resolved = items.find(...)` corría ANTES de leer siquiera
 *     la fila de consentimiento. El inquilino consentía la versión X y
 *     `{"pluginName":"...","version":"Y"}` ejecutaba la Y. Las capacidades de Y sí se comprobaban
 *     después, así que el daño estaba acotado a lo ya concedido — pero «esta organización aprobó
 *     ESTE código» dejaba de ser cierto, y esa frase es todo el propósito de `consentedVersionId`.
 *
 *  2. **Una extensión sin capacidades.** El bloque de consentimiento estaba guardado por
 *     `if (dto.pluginName && requiredCapabilities.length > 0)`, de modo que una versión con
 *     `capabilities: []` no pasaba ni por `consent?.enabled`: cualquier inquilino podía ejecutar
 *     cualquier extensión del catálogo sin haberla instalado.
 */
describe('ExtensionsService.execute — el consentimiento no se elude', () => {
  const ORG = 'org-1';

  function build(options: {
    consent?: { enabled: boolean; consentedVersionId?: string; grantedCapabilities?: string[] } | null;
    versions?: Array<{ id: string; version: string; code: string; capabilities: string[]; createdAt: Date }>;
  }) {
    const versions = options.versions ?? [];
    const plugin = { id: 'plugin-1', name: 'demo', status: 'ACTIVE', versions };

    const sandbox = { run: jest.fn().mockResolvedValue({ success: true, logs: [] }) };

    // Constructor order: plugins, versions, consents, admission, sandbox, metering, billing.
    const service = new ExtensionsService(
      { findOne: jest.fn().mockResolvedValue(plugin) } as never,
      { find: jest.fn(), findOne: jest.fn() } as never,
      { findOne: jest.fn().mockResolvedValue(options.consent ?? null), find: jest.fn() } as never,
      { validatePlugin: jest.fn() } as never,
      sandbox as never,
      { recordExecution: jest.fn().mockResolvedValue('metering-1'), finishExecution: jest.fn() } as never,
      { reconcile: jest.fn() } as never,
    );

    return { service, sandbox };
  }

  const version = (over: Partial<{ id: string; version: string; capabilities: string[] }> = {}) => ({
    id: over.id ?? 'v1',
    version: over.version ?? '1.0.0',
    code: 'log("hi")',
    capabilities: over.capabilities ?? [],
    createdAt: new Date('2026-01-01'),
  });

  it('refuses a pinned version the tenant has not consented to', async () => {
    const { service, sandbox } = build({
      consent: { enabled: true, consentedVersionId: 'v1', grantedCapabilities: [] },
      versions: [version({ id: 'v1', version: '1.0.0' }), version({ id: 'v2', version: '2.0.0' })],
    });

    await expect(
      service.execute(ORG, { pluginName: 'demo', version: '2.0.0' } as never, []),
    ).rejects.toThrow(ForbiddenException);

    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('accepts a pin that names the consented version', async () => {
    const { service, sandbox } = build({
      consent: { enabled: true, consentedVersionId: 'v1', grantedCapabilities: [] },
      versions: [version({ id: 'v1', version: '1.0.0' }), version({ id: 'v2', version: '2.0.0' })],
    });

    await service.execute(ORG, { pluginName: 'demo', version: '1.0.0' } as never, []);

    expect(sandbox.run).toHaveBeenCalled();
  });

  it('refuses an extension the tenant has not enabled, even when it declares no capabilities', async () => {
    const { service, sandbox } = build({
      consent: null,
      versions: [version({ capabilities: [] })],
    });

    await expect(service.execute(ORG, { pluginName: 'demo' } as never, [])).rejects.toThrow(
      ForbiddenException,
    );

    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('refuses an extension whose consent row has been disabled', async () => {
    const { service, sandbox } = build({
      consent: { enabled: false, grantedCapabilities: [] },
      versions: [version({ capabilities: [] })],
    });

    await expect(service.execute(ORG, { pluginName: 'demo' } as never, [])).rejects.toThrow(
      ForbiddenException,
    );

    expect(sandbox.run).not.toHaveBeenCalled();
  });

  it('still refuses inline code to a caller without the platform right', async () => {
    const { service, sandbox } = build({ consent: null, versions: [] });

    await expect(
      service.execute(ORG, { code: 'while(true){}' } as never, ['*']),
    ).rejects.toThrow(ForbiddenException);

    expect(sandbox.run).not.toHaveBeenCalled();
  });
});

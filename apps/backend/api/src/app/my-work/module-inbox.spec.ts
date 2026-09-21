import { ModuleInboxService } from './module-inbox.service';
import { ModuleInboxRegistry } from '../shared/inbox/module-inbox.registry';
import { InboxItem, ModuleInboxPort } from '../shared/inbox/module-inbox.port';

/**
 * La bandeja tiene dos propiedades de las que depende que sirva para algo, y ninguna es obvia:
 * ordena por lo que lleva más tiempo parado, y un módulo caído no la vacía.
 */
describe('ModuleInboxService', () => {
  const ORG = 'org-1';
  const USER = 'user-1';

  const item = (blockedSince: string): InboxItem => ({
    id: blockedSince,
    titleKey: 'INBOX.TEST',
    route: '/x',
    blockedSince,
  });

  const proveedor = (
    moduleId: string,
    count: number,
    items: InboxItem[],
  ): ModuleInboxPort =>
    ({
      moduleId,
      pending: jest.fn().mockResolvedValue({ moduleId, count, items }),
    }) as unknown as ModuleInboxPort;

  const conProveedores = (...ps: ModuleInboxPort[]) => {
    const registry = new ModuleInboxRegistry();
    for (const p of ps) registry.register(p);
    return new ModuleInboxService(registry);
  };

  it('pone primero el módulo con la cosa más antigua esperando, no el que más tiene', async () => {
    const service = conProveedores(
      proveedor('ventas', 50, [item('2026-09-01T00:00:00.000Z')]),
      proveedor('contabilidad', 2, [item('2026-01-15T00:00:00.000Z')]),
    );

    const bandeja = await service.forTenant(ORG, USER);

    // Ordenar por cuenta pondría arriba al que más ruido hace; el coste de una cosa parada crece
    // con lo que lleva parada.
    expect(bandeja.map((b) => b.moduleId)).toEqual(['contabilidad', 'ventas']);
  });

  it('no muestra los módulos sin nada pendiente', async () => {
    const service = conProveedores(
      proveedor('ventas', 0, []),
      proveedor('compras', 3, [item('2026-05-01T00:00:00.000Z')]),
    );

    expect((await service.forTenant(ORG, USER)).map((b) => b.moduleId)).toEqual(['compras']);
  });

  it('un módulo que falla no vacía la bandeja de los demás', async () => {
    const roto = {
      moduleId: 'contabilidad',
      pending: jest.fn().mockRejectedValue(new Error('la consulta se rompió')),
    } as unknown as ModuleInboxPort;

    const service = conProveedores(roto, proveedor('ventas', 4, [item('2026-03-01T00:00:00.000Z')]));

    // Un 500 aquí dejaría a la persona sin saber qué tiene que hacer hoy, por un módulo.
    const bandeja = await service.forTenant(ORG, USER);
    expect(bandeja.map((b) => b.moduleId)).toEqual(['ventas']);
  });

  it('dos proveedores del mismo módulo serían dos números para la misma insignia', () => {
    const registry = new ModuleInboxRegistry();
    registry.register(proveedor('ventas', 1, []));
    registry.register(proveedor('ventas', 99, []));

    expect(registry.all()).toHaveLength(1);
  });

  it('sin ningún módulo registrado devuelve una bandeja vacía, no un error', async () => {
    expect(await new ModuleInboxService(new ModuleInboxRegistry()).forTenant(ORG, USER)).toEqual([]);
  });
});

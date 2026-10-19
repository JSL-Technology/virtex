import { UnitsOfMeasureService } from './units-of-measure.service';
import { ConflictError } from '../i18n/localized.exception';

/** A company's own units beside the shared catalogue (QA M-18). */
describe('UnitsOfMeasureService — unidades propias', () => {
  const shared = [{ id: 's1', symbol: 'KG', category: 'Weight', nameKey: 'uom.kilogram' }];
  let own: Array<{ id: string; organizationId: string; symbol: string; name: string; category: string }>;
  let productCount = 0;
  let service: UnitsOfMeasureService;

  beforeEach(() => {
    own = [{ id: 'c1', organizationId: 'org', symbol: 'SC50', name: 'Saco de 50 kg', category: 'Weight' }];
    productCount = 0;
    const sharedRepo = {
      find: async () => shared,
      exists: async ({ where }: { where: { symbol: string } }) => shared.some((u) => u.symbol === where.symbol),
    };
    const ownRepo = {
      find: async ({ where }: { where: { organizationId: string } }) => own.filter((u) => u.organizationId === where.organizationId),
      exists: async ({ where }: { where: { organizationId: string; symbol: string } }) =>
        own.some((u) => u.organizationId === where.organizationId && u.symbol === where.symbol),
      findOne: async ({ where }: { where: { id: string; organizationId: string } }) =>
        own.find((u) => u.id === where.id && u.organizationId === where.organizationId) ?? null,
      create: (v: object) => v,
      save: async (v: { symbol: string; name: string; category: string; organizationId: string }) => {
        const row = { ...v, id: 'new' };
        own.push(row);
        return row;
      },
      remove: async (v: { id: string }) => {
        own = own.filter((u) => u.id !== v.id);
      },
    };
    const dataSource = { query: async () => [{ count: productCount }] };
    service = new UnitsOfMeasureService(sharedRepo as never, ownRepo as never, dataSource as never);
  });

  it('lista el catálogo común y las propias de la empresa', async () => {
    const all = await service.findAll('org');
    expect(all.map((u) => `${u.scope}:${u.symbol}`)).toEqual(['platform:KG', 'company:SC50']);
    expect(await service.findAll('otra')).toHaveLength(1);
  });

  it('no deja que una unidad propia tape una del catálogo ni repita símbolo', async () => {
    await expect(service.createForTenant('org', { symbol: 'KG', name: 'Kilo', category: 'Weight' })).rejects.toBeInstanceOf(ConflictError);
    await expect(service.createForTenant('org', { symbol: 'SC50', name: 'Otro', category: 'Weight' })).rejects.toBeInstanceOf(ConflictError);
    const created = await service.createForTenant('org', { symbol: 'BUL', name: 'Bulto', category: 'Units' });
    expect(created).toMatchObject({ symbol: 'BUL', scope: 'company' });
  });

  it('no elimina una unidad que usan productos', async () => {
    productCount = 3;
    await expect(service.removeForTenant('org', 'c1')).rejects.toBeInstanceOf(ConflictError);
    productCount = 0;
    await service.removeForTenant('org', 'c1');
    expect(own).toHaveLength(0);
  });
});

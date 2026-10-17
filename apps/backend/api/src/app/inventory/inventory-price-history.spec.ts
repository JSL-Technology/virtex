import { InventoryService } from './inventory.service';
import { Product, ProductKind } from './entities/product.entity';
import { ProductPriceHistory } from './entities/product-price-history.entity';

/**
 * Historial de precio y costo.
 *
 * Editar un producto sobrescribía ambos valores sin dejar rastro. Ahora cada cambio real deja una
 * fila —de qué, a qué, quién— en la misma transacción; un guardado que no cambia nada no deja ninguna.
 */
describe('InventoryService — historial de precio y costo', () => {
  const build = (product: Partial<Product>) => {
    const saved: unknown[] = [];
    const manager = {
      findOne: jest.fn(async () => ({ ...product })),
      merge: (_: unknown, target: object, changes: object) => Object.assign(target, changes),
      create: (_: unknown, data: object) => ({ __entity: _, ...data }),
      save: jest.fn(async (entity: unknown) => {
        saved.push(entity);
        return entity;
      }),
    };
    const dataSource = { transaction: (work: (m: typeof manager) => unknown) => work(manager) };
    const categories = { assertUsable: jest.fn(async () => undefined) };
    const service = new InventoryService(
      {} as never,
      dataSource as never,
      {} as never,
      categories as never,
      {} as never,
      {} as never,
    );
    const history = () => saved.filter((e) => (e as { __entity?: unknown }).__entity === ProductPriceHistory);
    return { service, history };
  };

  const base = { id: 'p1', organizationId: 'org-1', price: 100, cost: 60, stock: 0, kind: ProductKind.GOOD };

  it('registra el cambio de precio con el usuario que lo hizo', async () => {
    const { service, history } = build(base);
    await service.update('p1', { price: 40 } as never, 'org-1', 'user-9');
    expect(history()).toEqual([
      expect.objectContaining({
        organizationId: 'org-1',
        productId: 'p1',
        oldPrice: 100,
        newPrice: 40,
        oldCost: null,
        newCost: null,
        changedByUserId: 'user-9',
      }),
    ]);
  });

  it('registra el cambio de costo de un producto sin existencias', async () => {
    const { service, history } = build(base);
    await service.update('p1', { cost: 75 } as never, 'org-1', 'user-9');
    expect(history()).toEqual([expect.objectContaining({ oldCost: 60, newCost: 75, oldPrice: null })]);
  });

  it('no deja fila si el precio y el costo no cambian', async () => {
    const { service, history } = build(base);
    await service.update('p1', { price: 100, cost: '60' as never, name: 'Otro nombre' } as never, 'org-1', 'user-9');
    expect(history()).toEqual([]);
  });
});

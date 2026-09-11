import { ManufacturingService } from './manufacturing.service';
import { NotFoundError } from '../i18n/localized.exception';

/**
 * Tenant isolation, pinned as a regression.
 *
 * `findAllOrders` used to be `this.productionOrderRepository.find()` with no argument — it returned
 * every tenant's production orders to any authenticated caller. These tests assert the opposite:
 * that every read is scoped to the organization it was asked for, and that the tenant is stamped on
 * a create rather than taken from the caller. They mock the repositories, so they need no database
 * and run in every environment.
 */
describe('ManufacturingService — tenant isolation', () => {
  const ORG = '11111111-1111-1111-1111-111111111111';
  const OTHER_ORG = '22222222-2222-2222-2222-222222222222';

  function build() {
    const productionOrderRepository = {
      findAndCount: jest.fn().mockResolvedValue([[], 0]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn((value) => value),
      save: jest.fn((value) => Promise.resolve({ id: 'new', ...value })),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const bomRepository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) } as any;
    const bomItemRepository = { create: jest.fn((v) => v) } as any;
    const workCenterRepository = { findAndCount: jest.fn().mockResolvedValue([[], 0]) } as any;

    const service = new ManufacturingService(
      productionOrderRepository as any,
      bomRepository,
      bomItemRepository,
      workCenterRepository,
    );
    return { service, productionOrderRepository };
  }

  it('scopes the order list to the caller organization', async () => {
    const { service, productionOrderRepository } = build();

    await service.findAllOrders(ORG, {});

    expect(productionOrderRepository.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: ORG } }),
    );
  });

  it('stamps the tenant on create and does not trust a body-supplied one', async () => {
    const { service, productionOrderRepository } = build();

    await service.createOrder(
      // A malicious body attempting to plant another tenant's id is overwritten by the argument.
      { organizationId: OTHER_ORG, orderNumber: 'PO-1', productId: 'p', quantityPlanned: 1 } as any,
      ORG,
    );

    const created = productionOrderRepository.create.mock.calls[0][0];
    expect(created.organizationId).toBe(ORG);
  });

  it('scopes a single-order lookup and 404s across tenants', async () => {
    const { service, productionOrderRepository } = build();
    productionOrderRepository.findOne.mockResolvedValue(null);

    await expect(service.findOneOrder('some-id', ORG)).rejects.toBeInstanceOf(NotFoundError);
    expect(productionOrderRepository.findOne).toHaveBeenCalledWith({
      where: { id: 'some-id', organizationId: ORG },
    });
  });

  it('scopes deletes by tenant, never by id alone', async () => {
    const { service, productionOrderRepository } = build();
    productionOrderRepository.findOne.mockResolvedValue({ id: 'x', organizationId: ORG });

    await service.removeOrder('x', ORG);

    expect(productionOrderRepository.delete).toHaveBeenCalledWith({ id: 'x', organizationId: ORG });
  });
});

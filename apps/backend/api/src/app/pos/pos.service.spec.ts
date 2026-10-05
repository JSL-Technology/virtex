import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosShiftStatus } from './entities/pos-shift.entity';
import { PosSaleStatus } from './entities/pos-sale.entity';

/**
 * The rules that make a till trustworthy.
 *
 *  - A terminal has at most one open shift.
 *  - A sale is atomic with the stock it consumes.
 *  - The SERVER prices the sale: from the catalogue, never from the till. The till's amounts are
 *    only what it showed the customer, and a sale whose customer was shown something else is refused.
 *  - A shift is its cashier's; somebody else needs `pos:manage_shifts`.
 *  - Closing a shift cashes it up against the expected drawer.
 */
describe('PosService', () => {
  const WIDGET = '11111111-1111-4111-8111-111111111111';
  const SERVICE = '22222222-2222-4222-8222-222222222222';
  const cashier = { id: 'cashier-1', organizationId: 'org-1', permissions: ['pos:operate'] } as never;
  const supervisor = {
    id: 'supervisor-1',
    organizationId: 'org-1',
    permissions: ['pos:operate', 'pos:manage_shifts'],
  } as never;

  const catalogue: Record<string, unknown> = {
    [WIDGET]: {
      id: WIDGET, name: 'Widget', price: 10, status: 'Active',
      kind: 'GOOD', taxTreatment: 'TAXED', taxRate: 0.18,
    },
    [SERVICE]: {
      id: SERVICE, name: 'Instalación', price: 50, status: 'Active',
      kind: 'SERVICE', taxTreatment: 'EXEMPT', taxRate: 0,
    },
  };

  const makeService = (overrides: { activeShift?: any; inventory?: any } = {}) => {
    const shift = overrides.activeShift ?? null;
    const shiftsRepo: any = {
      findOne: jest.fn().mockResolvedValue(shift),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (v) => ({ id: 'shift-1', ...v })),
    };
    const salesRepo: any = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    const inventory: any = overrides.inventory ?? { decreaseStock: jest.fn().mockResolvedValue(undefined) };
    const lockedQuery: any = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      setLock: jest.fn().mockReturnThis(),
      getOne: jest.fn(async () => shift),
    };
    const manager: any = {
      create: jest.fn((_e, v) => ({ id: 'sale-1', ...v })),
      save: jest.fn(async (_e, v) => v),
      findOne: jest.fn(async (_e, options: { where: { id: string } }) => catalogue[options.where.id] ?? null),
      createQueryBuilder: jest.fn(() => lockedQuery),
      // The tenant's standard rate, for a product marked taxed with no rate of its own (QA C-08).
      query: jest.fn(async () => [{ rate: 18 }]),
    };
    const dataSource: any = { transaction: jest.fn(async (cb) => cb(manager)) };
    const service = new PosService(shiftsRepo, salesRepo, inventory, dataSource);
    return { service, shiftsRepo, salesRepo, inventory, manager, lockedQuery };
  };

  const openShift = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    userId: 'cashier-1',
    status: PosShiftStatus.OPEN,
    openingBalance: 100,
    salesTotal: 0,
    salesCount: 0,
    cashSalesTotal: 0,
    ...over,
  });

  it('refuses a second open shift on the same terminal', async () => {
    const { service } = makeService({ activeShift: openShift() });
    await expect(
      service.openShift('org-1', 'cashier-1', { terminalId: 'main', openingBalance: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a sale when no shift is open', async () => {
    const { service } = makeService({ activeShift: null });
    await expect(
      service.processSale('org-1', cashier, {
        terminalId: 'main',
        items: [{ productId: WIDGET, price: 10, quantity: 1 }],
        subtotal: 10,
        tax: 1.8,
        total: 11.8,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prices every line from the catalogue, moves stock for goods only, and records it atomically', async () => {
    const shift = openShift();
    const { service, inventory, manager } = makeService({ activeShift: shift });

    const sale = await service.processSale('org-1', cashier, {
      terminalId: 'main',
      items: [
        { productId: WIDGET, price: 10, quantity: 2 },
        { productId: SERVICE, price: 50, quantity: 1 },
      ],
      subtotal: 70,
      tax: 3.6,
      total: 73.6,
    });

    expect(inventory.decreaseStock).toHaveBeenCalledTimes(1);
    // Out of the till's branch warehouse, on the kardex as this sale.
    expect(inventory.decreaseStock).toHaveBeenCalledWith(
      WIDGET,
      2,
      manager,
      'org-1',
      expect.objectContaining({ type: 'SALE_DISPATCH', sourceType: 'pos_sale', sourceId: sale.id }),
    );
    expect(sale).toMatchObject({ subtotal: 70, tax: 3.6, total: 73.6, cashierId: 'cashier-1' });
    expect(sale.items[0]).toMatchObject({ productName: 'Widget', lineSubtotal: 20, lineTax: 3.6, taxRate: 0.18 });
    expect(sale.status).toBe(PosSaleStatus.PAID);
    expect(shift.salesCount).toBe(1);
    expect(shift.salesTotal).toBe(73.6);
    expect(shift.cashSalesTotal).toBe(73.6);
  });

  it('refuses a price the catalogue does not hold — the till cannot choose what things cost', async () => {
    const { service, inventory } = makeService({ activeShift: openShift() });
    await expect(
      service.processSale('org-1', cashier, {
        terminalId: 'main',
        items: [{ productId: WIDGET, price: 0.01, quantity: 1 }],
        subtotal: 0.01,
        tax: 0,
        total: 0.01,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(inventory.decreaseStock).not.toHaveBeenCalled();
  });

  it('refuses totals that disagree with the lines', async () => {
    const { service } = makeService({ activeShift: openShift() });
    await expect(
      service.processSale('org-1', cashier, {
        terminalId: 'main',
        items: [{ productId: WIDGET, price: 10, quantity: 1 }],
        subtotal: 10,
        tax: 0,
        total: 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a product that is not in the catalogue or not active', async () => {
    const { service } = makeService({ activeShift: openShift() });
    await expect(
      service.processSale('org-1', cashier, {
        terminalId: 'main',
        items: [{ productId: '33333333-3333-4333-8333-333333333333', price: 5, quantity: 1 }],
        subtotal: 5,
        tax: 0,
        total: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a product the catalogue holds but no longer sells', async () => {
    const RETIRED = '44444444-4444-4444-8444-444444444444';
    catalogue[RETIRED] = { id: RETIRED, name: 'Retirado', price: 5, status: 'Inactive', kind: 'GOOD' };
    const { service, inventory } = makeService({ activeShift: openShift() });
    await expect(
      service.processSale('org-1', cashier, {
        terminalId: 'main',
        items: [{ productId: RETIRED, price: 5, quantity: 1 }],
        subtotal: 5,
        tax: 0,
        total: 5,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(inventory.decreaseStock).not.toHaveBeenCalled();
  });

  it('a card sale counts towards takings but not towards the drawer', async () => {
    const shift = openShift();
    const { service } = makeService({ activeShift: shift });
    await service.processSale('org-1', cashier, {
      terminalId: 'main',
      items: [{ productId: SERVICE, price: 50, quantity: 1 }],
      subtotal: 50,
      tax: 0,
      total: 50,
      paymentMethod: 'Card',
    });
    expect(shift.salesTotal).toBe(50);
    expect(shift.cashSalesTotal).toBe(0);
  });

  it('refuses to ring on somebody else\'s shift without the supervisor permission', async () => {
    const { service } = makeService({ activeShift: openShift({ userId: 'someone-else' }) });
    const sale = {
      terminalId: 'main',
      items: [{ productId: SERVICE, price: 50, quantity: 1 }],
      subtotal: 50,
      tax: 0,
      total: 50,
    };
    await expect(service.processSale('org-1', cashier, sale)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.processSale('org-1', supervisor, sale)).resolves.toBeDefined();
  });

  it('closing cashes up: expected drawer, counted cash and the variance', async () => {
    const shift = openShift({ cashSalesTotal: 250 });
    const { service } = makeService({ activeShift: shift });

    const closed = await service.closeShift('org-1', 's1', { closingBalance: 340 }, cashier);

    expect(closed).toMatchObject({
      status: PosShiftStatus.CLOSED,
      expectedBalance: 350,
      closingBalance: 340,
      closingVariance: -10,
      closedById: 'cashier-1',
    });
  });

  it('only the shift\'s cashier or a supervisor may close it', async () => {
    const { service } = makeService({ activeShift: openShift({ userId: 'someone-else' }) });
    await expect(
      service.closeShift('org-1', 's1', { closingBalance: 0 }, cashier),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

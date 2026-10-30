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
    const inventory: any = overrides.inventory ?? { decreaseStock: jest.fn().mockResolvedValue({ unitCost: 4 }) };
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
    const posting: any = { post: jest.fn().mockResolvedValue(undefined), reverse: jest.fn().mockResolvedValue(undefined) };
    const compliance: any = { findActiveSequence: jest.fn().mockResolvedValue(null), getNextNcf: jest.fn() };
    const service = new PosService(shiftsRepo, salesRepo, inventory, dataSource, posting, compliance);
    return { service, shiftsRepo, salesRepo, inventory, manager, lockedQuery, posting };
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

  // QA R3-C02: a till sale used to move stock and post nothing at all.
  it('posts the sale: revenue split by goods and services, tax, the tender, and the cost of the goods', async () => {
    const { service, posting } = makeService({ activeShift: openShift() });

    await service.processSale('org-1', cashier, {
      terminalId: 'main',
      items: [
        { productId: WIDGET, price: 10, quantity: 2 },
        { productId: SERVICE, price: 50, quantity: 1 },
      ],
      subtotal: 70,
      tax: 3.6,
      total: 73.6,
    });

    expect(posting.post).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ costOfSale: 8 }),
      { cash: 73.6, nonCash: 0, goodsRevenue: 20, servicesRevenue: 50, tax: 3.6, costOfSale: 8 },
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'cashier-1',
    );
  });
});

/** QA C-04: la caja registraba la venta sin preguntar cómo se pagó. */
describe('PosService.settleTenders', () => {
  it('sin pagos detallados se comporta como antes', () => {
    expect(PosService.settleTenders({}, 100)).toEqual({
      method: null,
      payments: [],
      amountTendered: null,
      changeDue: 0,
      cashKept: 0,
    });
  });

  it('en efectivo calcula el cambio y la caja se queda solo con el total', () => {
    const result = PosService.settleTenders({ payments: [{ method: 'cash', amount: 2000 }] }, 1770.59);
    expect(result.method).toBe('cash');
    expect(result.amountTendered).toBe(2000);
    expect(result.changeDue).toBe(229.41);
    expect(result.cashKept).toBe(1770.59);
  });

  it('un pago mixto solo cuenta como efectivo la parte en efectivo', () => {
    const result = PosService.settleTenders(
      { payments: [{ method: 'card', amount: 1000 }, { method: 'cash', amount: 800 }] },
      1770.59,
    );
    expect(result.method).toBe('mixed');
    expect(result.changeDue).toBe(29.41);
    expect(result.cashKept).toBe(770.59);
  });

  it('rechaza un pago que no cubre el total', () => {
    expect(() => PosService.settleTenders({ payments: [{ method: 'card', amount: 10 }] }, 100)).toThrow();
  });

  it('rechaza un cambio que la tarjeta no puede devolver', () => {
    expect(() => PosService.settleTenders({ payments: [{ method: 'card', amount: 150 }] }, 100)).toThrow();
  });
});

describe('PosService — reports and voids', () => {
  const PRODUCT = '33333333-3333-4333-8333-333333333333';
  const supervisor = { id: 'sup-1', organizationId: 'org-1', permissions: ['pos:manage_shifts'] } as never;

  const sale = (over: Record<string, unknown> = {}) => ({
    id: 'sale-1',
    organizationId: 'org-1',
    terminalId: 'main',
    shiftId: 's1',
    branchId: null,
    status: PosSaleStatus.PAID,
    subtotal: 100,
    tax: 18,
    total: 118,
    changeDue: 0,
    paymentMethod: 'cash',
    payments: [{ method: 'cash', amount: 118 }],
    items: [{ productId: PRODUCT, productName: 'Widget', price: 50, quantity: 2, taxRate: 0.18, lineSubtotal: 100, lineTax: 18 }],
    ...over,
  });

  const shift = (over: Record<string, unknown> = {}) => ({
    id: 's1',
    userId: 'cashier-1',
    status: PosShiftStatus.OPEN,
    openingBalance: 50,
    salesTotal: 118,
    salesCount: 1,
    cashSalesTotal: 118,
    voidedTotal: 0,
    voidedCount: 0,
    ...over,
  });

  it('the report breaks takings down by tender, net of change, and keeps voids apart', () => {
    const report = PosService.buildReport(shift() as never, [
      sale({ id: 'a', total: 118, payments: [{ method: 'cash', amount: 200 }], changeDue: 82 }),
      sale({ id: 'b', total: 59, subtotal: 50, tax: 9, payments: [{ method: 'card', amount: 40 }, { method: 'cash', amount: 19 }], items: [] }),
      sale({ id: 'c', total: 10, subtotal: 10, tax: 0, payments: [], paymentMethod: 'transfer', items: [] }),
      sale({ id: 'd', status: PosSaleStatus.CANCELLED, total: 30 }),
    ] as never);

    expect(report.salesCount).toBe(3);
    expect(report.total).toBe(187);
    expect(report.byMethod).toEqual({ cash: 137, card: 40, transfer: 10, other: 0 });
    expect(report.expectedCash).toBe(187); // 50 float + 137 cash kept
    expect(report.voidedCount).toBe(1);
    expect(report.voidedTotal).toBe(30);
    expect(report.itemsSold).toBe(2);
    expect(report.topProducts[0]).toMatchObject({ productId: PRODUCT, quantity: 2, total: 118 });
    expect(report.averageTicket).toBe(62.33);
  });

  const makeVoid = (found: { sale: any; shift: any }) => {
    const queries = [found.sale, found.shift];
    const manager: any = {
      createQueryBuilder: jest.fn(() => {
        const result = queries.shift();
        const query: any = {
          where: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          setLock: jest.fn().mockReturnThis(),
          getOne: jest.fn(async () => result),
        };
        return query;
      }),
      findOne: jest.fn(async () => ({ id: PRODUCT, kind: 'GOOD' })),
      save: jest.fn(async (_e, v) => v),
    };
    const inventory: any = { increaseStock: jest.fn().mockResolvedValue(undefined) };
    const dataSource: any = { transaction: jest.fn(async (cb) => cb(manager)) };
    const posting: any = { post: jest.fn(), reverse: jest.fn().mockResolvedValue(undefined) };
    const service = new PosService({} as never, {} as never, inventory, dataSource, posting, {} as never);
    return { service, inventory, manager, posting };
  };

  it('voiding returns the goods, takes the sale out of the takings and records who and why', async () => {
    const theShift = shift();
    const { service, inventory } = makeVoid({ sale: sale(), shift: theShift });

    const voided = await service.voidSale('org-1', 'sale-1', { reason: ' cobro duplicado ' }, supervisor);

    expect(inventory.increaseStock).toHaveBeenCalledWith(
      PRODUCT,
      2,
      expect.anything(),
      'org-1',
      expect.objectContaining({ type: 'SALE_RETURN', sourceType: 'pos_sale_void', sourceId: 'sale-1' }),
    );
    expect(voided).toMatchObject({ status: PosSaleStatus.CANCELLED, voidedById: 'sup-1', voidReason: 'cobro duplicado' });
    expect(theShift).toMatchObject({ salesTotal: 0, salesCount: 0, cashSalesTotal: 0, voidedTotal: 118, voidedCount: 1 });
  });

  it('refuses to void a sale twice', async () => {
    const { service, inventory } = makeVoid({ sale: sale({ status: PosSaleStatus.CANCELLED }), shift: shift() });
    await expect(service.voidSale('org-1', 'sale-1', { reason: 'otra vez' }, supervisor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inventory.increaseStock).not.toHaveBeenCalled();
  });

  it('refuses to void on a shift that has been cashed up', async () => {
    const { service, inventory } = makeVoid({ sale: sale(), shift: shift({ status: PosShiftStatus.CLOSED }) });
    await expect(service.voidSale('org-1', 'sale-1', { reason: 'tarde' }, supervisor)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(inventory.increaseStock).not.toHaveBeenCalled();
  });

  it('reverses the sale entries when it is voided', async () => {
    const { service, posting } = makeVoid({ sale: sale(), shift: shift() });
    await service.voidSale('org-1', 'sale-1', { reason: 'cobro duplicado' }, supervisor);
    expect(posting.reverse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: 'sale-1' }), expect.any(String), 'cobro duplicado', 'sup-1');
  });
});

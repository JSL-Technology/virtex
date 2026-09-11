import { BadRequestException, ConflictException } from '@nestjs/common';
import { PosService } from './pos.service';
import { PosShiftStatus } from './entities/pos-shift.entity';
import { PosSaleStatus } from './entities/pos-sale.entity';

/**
 * Proves the two rules that make a till trustworthy: a terminal has at most one open shift, and a
 * sale is atomic with the stock it consumes — the same transaction decrements inventory and records
 * the ticket, so they cannot diverge, and a sale outside an open shift is refused.
 */
describe('PosService', () => {
  const makeService = (overrides: {
    activeShift?: any;
    inventory?: any;
  } = {}) => {
    const shift = overrides.activeShift;
    const shiftsRepo: any = {
      findOne: jest.fn().mockResolvedValue(shift ?? null),
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (v) => ({ id: 'shift-1', ...v })),
    };
    const salesRepo: any = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    const inventory: any = overrides.inventory ?? { decreaseStock: jest.fn().mockResolvedValue(undefined) };
    const manager: any = {
      create: jest.fn((_e, v) => ({ id: 'sale-1', ...v })),
      save: jest.fn(async (_e, v) => v),
    };
    const dataSource: any = { transaction: jest.fn(async (cb) => cb(manager)) };
    const service = new PosService(shiftsRepo, salesRepo, inventory, dataSource);
    return { service, shiftsRepo, salesRepo, inventory, manager };
  };

  it('refuses a second open shift on the same terminal', async () => {
    const { service } = makeService({ activeShift: { id: 's1', status: PosShiftStatus.OPEN } });
    await expect(
      service.openShift('org-1', 'user-1', { terminalId: 'main', openingBalance: 0 }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses a sale when no shift is open', async () => {
    const { service } = makeService({ activeShift: null });
    await expect(
      service.processSale('org-1', {
        terminalId: 'main',
        items: [{ productId: 'p1', productName: 'X', price: 1, quantity: 1 }],
        subtotal: 1,
        tax: 0,
        total: 1,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('decrements stock for catalogue lines and records the sale atomically', async () => {
    const shift = { id: 's1', status: PosShiftStatus.OPEN, salesTotal: 0, salesCount: 0 };
    const productId = '11111111-1111-4111-8111-111111111111';
    const { service, inventory, manager } = makeService({ activeShift: shift });

    const sale = await service.processSale('org-1', {
      terminalId: 'main',
      items: [
        { productId, productName: 'Widget', price: 10, quantity: 2 },
        { productId: 'misc', productName: 'Manual item', price: 5, quantity: 1 }, // ad-hoc, no stock
      ],
      subtotal: 25,
      tax: 0,
      total: 25,
    });

    // Only the UUID line moves stock; the ad-hoc line is skipped.
    expect(inventory.decreaseStock).toHaveBeenCalledTimes(1);
    expect(inventory.decreaseStock).toHaveBeenCalledWith(productId, 2, manager, 'org-1');
    expect(sale.status).toBe(PosSaleStatus.PAID);
    expect(shift.salesCount).toBe(1);
    expect(shift.salesTotal).toBe(25);
  });
});

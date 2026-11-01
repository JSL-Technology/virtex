import { EntityManager } from 'typeorm';
import { PosPostingService } from './pos-posting.service';
import { PosSale } from './entities/pos-sale.entity';
import { LedgerPostingRegistry } from '../contracts/ledger-posting/ledger-posting.contract';

/** A till sale's entries, through the ledger-posting contract (QA R3-C02). */
describe('PosPostingService', () => {
  const settings = {
    organizationId: 'org-1',
    baseCurrency: 'DOP',
    defaultCashId: 'cash',
    defaultBankId: 'bank',
    defaultSalesRevenueId: 'revenue',
    defaultServiceRevenueId: 'services',
    defaultSalesTaxId: 'tax',
    defaultCostOfGoodsSoldId: 'cogs',
    defaultInventoryId: 'inventory',
  };
  const sale = { id: 'sale-1', organizationId: 'org-1', terminalId: 'main', fiscalNumber: 'B0200000001' } as PosSale;

  function build(found: object | null = settings) {
    const manager = { findOne: jest.fn(async () => found) } as unknown as EntityManager;
    const ledger = {
      describeAll: jest.fn(async (_m: unknown, _o: unknown, words: Record<string, unknown>) =>
        Object.fromEntries(Object.keys(words).map((k) => [k, k])),
      ),
      post: jest.fn(async (...args: unknown[]) => ({ id: `je-${(args[2] as { journalCode: string }).journalCode}` })),
      reverse: jest.fn(async (..._args: unknown[]) => undefined),
    };
    return { service: new PosPostingService(ledger as unknown as LedgerPostingRegistry), ledger, manager };
  }

  it('posts revenue to VENTAS and cost to GENERAL, balanced, once per sale', async () => {
    const { service, ledger, manager } = build();
    const target = { ...sale } as PosSale;
    await service.post(
      manager,
      target,
      { cash: 1000, nonCash: 475, goodsRevenue: 1000, servicesRevenue: 250, tax: 225, costOfSale: 695.24 },
      '2026-11-01',
      'cashier-1',
    );

    const [revenue, cost] = ledger.post.mock.calls.map((call) => call[2] as { journalCode: string; lines: Array<{ accountId: string; debit: number; credit: number }> });
    expect(revenue.journalCode).toBe('VENTAS');
    expect(revenue.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['cash', 1000, 0],
      ['bank', 475, 0],
      ['revenue', 0, 1000],
      ['services', 0, 250],
      ['tax', 0, 225],
    ]);
    expect(cost.journalCode).toBe('GENERAL');
    expect(cost.lines.map((l) => [l.accountId, l.debit, l.credit])).toEqual([
      ['cogs', 695.24, 0],
      ['inventory', 0, 695.24],
    ]);
    expect(ledger.post.mock.calls[0][3]).toMatchObject({ idempotencyKey: 'pos-sale:sale-1:revenue', module: 'accounts-receivable' });
    expect(target).toMatchObject({ journalEntryId: 'je-VENTAS', costJournalEntryId: 'je-GENERAL' });
  });

  it('refuses a sale it cannot post rather than selling off the books', async () => {
    const { service, ledger, manager } = build({ ...settings, defaultSalesTaxId: null });
    await expect(
      service.post(manager, { ...sale } as PosSale, { cash: 118, nonCash: 0, goodsRevenue: 100, servicesRevenue: 0, tax: 18, costOfSale: 0 }, '2026-11-01', 'c'),
    ).rejects.toMatchObject({ messageKey: 'pos.accounting_setup_incomplete' });
    expect(ledger.post).not.toHaveBeenCalled();
  });

  it('a void reverses both entries on the void date', async () => {
    const { service, ledger, manager } = build();
    await service.reverse(manager, { ...sale, journalEntryId: 'je-1', costJournalEntryId: 'je-2' } as PosSale, '2026-11-02', 'Error de cobro', 'sup-1');
    expect(ledger.reverse.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      ['je-1', { date: '2026-11-02', reason: 'Error de cobro' }],
      ['je-2', { date: '2026-11-02', reason: 'Error de cobro' }],
    ]);
  });
});

describe('LedgerPostingRegistry', () => {
  it('will not let a sale through unposted when accounting is not loaded', async () => {
    const registry = new LedgerPostingRegistry();
    expect(registry.available()).toBe(false);
    expect(() => registry.post({} as EntityManager, 'org-1', { journalCode: 'VENTAS', date: '2026-11-01', description: '', lines: [] }, { systemReason: 'x' })).toThrow(
      /No ledger posting gateway/,
    );
  });
});

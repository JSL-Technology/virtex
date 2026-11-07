import { InvoicePostingService } from './invoice-posting.service';

/**
 * INV-03 (audit 2026-10-31): an invoice for goods whose company had no cost-of-sales or inventory
 * account was posted without its cost — a log warning, and the inventory account stayed overstated
 * by exactly the goods that had just left the stock register. Issuing now refuses, which rolls the
 * stock movement back with it.
 */
describe('InvoicePostingService — cost of sale', () => {
  function service() {
    const posting = { createEntry: jest.fn() };
    const svc = new InvoicePostingService(
      posting as never, {} as never, {} as never, {} as never, {} as never, {} as never,
    );
    return { svc, posting };
  }
  const invoice = { invoiceNumber: 'INV-QA-1', organizationId: 'org-1', costOfSale: 1500, issueDate: '2026-11-07' };
  const postCost = (svc: InvoicePostingService, settings: Record<string, unknown>) =>
    (svc as unknown as { postCost: (...a: unknown[]) => Promise<string | null> }).postCost(
      invoice, { baseCurrency: 'DOP', ...settings }, {}, {}, false,
    );

  it.each([
    ['cost of sales', { defaultInventoryId: 'acc-inv' }],
    ['inventory', { defaultCostOfGoodsSoldId: 'acc-cogs' }],
  ])('refuses to post goods without the %s account', async (_label, settings) => {
    const { svc, posting } = service();
    await expect(postCost(svc, settings)).rejects.toMatchObject({
      messageKey: 'invoices.cost_accounts_not_configured',
    });
    expect(posting.createEntry).not.toHaveBeenCalled();
  });

  it('posts nothing, and asks for nothing, when the sale moved no stock', async () => {
    const { svc } = service();
    const none = (svc as unknown as { postCost: (...a: unknown[]) => Promise<string | null> }).postCost(
      { ...invoice, costOfSale: 0 }, { baseCurrency: 'DOP' }, {}, {}, false,
    );
    await expect(none).resolves.toBeNull();
  });
});

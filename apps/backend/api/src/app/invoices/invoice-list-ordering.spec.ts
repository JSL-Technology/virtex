import { INVOICE_LIST_SORT, InvoicesService } from './invoices.service';

/** QA B-01: the invoice list is ordered by the server, from a whitelist. */
describe('Invoice list ordering', () => {
  function invoiceQueryBuilder() {
    const calls: Array<[string, ...unknown[]]> = [];
    const qb: Record<string, jest.Mock> = {};
    for (const method of ['leftJoinAndSelect', 'where', 'andWhere', 'orderBy', 'addOrderBy', 'skip', 'take']) {
      qb[method] = jest.fn((...args: unknown[]) => {
        calls.push([method, ...args]);
        return qb;
      });
    }
    qb['getManyAndCount'] = jest.fn(async () => [[], 0]);
    return { qb, calls };
  }

  function invoicesWith(qb: unknown): InvoicesService {
    const service = Object.create(InvoicesService.prototype) as InvoicesService;
    Object.assign(service, { invoicesRepository: { createQueryBuilder: () => qb } });
    return service;
  }

  it('orders invoices by a whitelisted column, with the default order as tie-break', async () => {
    const { qb, calls } = invoiceQueryBuilder();
    await invoicesWith(qb).findAll('org-1', { sort: 'total', direction: 'desc' });
    const order = calls.filter(([method]) => method === 'orderBy' || method === 'addOrderBy');
    expect(order[0]).toEqual(['orderBy', INVOICE_LIST_SORT['total'], 'DESC', 'NULLS LAST']);
    expect(order.slice(1).map(([, column]) => column)).toEqual(['invoice.issueDate', 'invoice.createdAt', 'invoice.id']);
  });
  it('ignores a column that is not on the whitelist instead of putting it in the SQL', async () => {
    const { qb, calls } = invoiceQueryBuilder();
    await invoicesWith(qb).findAll('org-1', { sort: 'total; DROP TABLE invoices', direction: 'asc' });
    const columns = calls.filter(([method]) => method.endsWith('rderBy')).map(([, column]) => column);
    expect(columns).toEqual(['invoice.issueDate', 'invoice.createdAt', 'invoice.id']);
  });});

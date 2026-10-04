import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { In } from 'typeorm';
import { INVOICE_LIST_SORT, InvoicesService } from '../invoices/invoices.service';
import { JournalEntryListQueryDto } from '../journal-entries/dto/journal-entry-list-query.dto';
import { PayrollRunService } from '../payroll/services/payroll-run.service';
import { PayrollRunStatus, PayrollRunType } from '../payroll/entities/payroll-run.entity';

/**
 * QA B-01 and B-02: lists the server pages are ordered by the server, from a whitelist; an
 * employee's own payslips say which period they pay.
 */
describe('List ordering and my payslips', () => {
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
  });

  it('accepts only known journal-entry columns and directions', async () => {
    const ok = plainToInstance(JournalEntryListQueryDto, { sort: 'entryNumber', direction: 'desc', page: '2' });
    expect(await validate(ok)).toHaveLength(0);
    const bad = plainToInstance(JournalEntryListQueryDto, { sort: 'lines', direction: 'sideways' });
    expect((await validate(bad)).map((e) => e.property).sort()).toEqual(['direction', 'sort']);
  });

  it('gives an employee their approved payslips with the period each one pays', async () => {
    const find = jest.fn(async () => [
      {
        id: 'p-1',
        netPay: 100,
        run: {
          periodYear: 2026,
          periodMonth: 8,
          periodStart: '2026-08-01',
          periodEnd: '2026-08-31',
          payDate: '2026-08-30',
          runType: PayrollRunType.REGULAR,
          currencyCode: 'DOP',
        },
      },
    ]);
    const service = Object.create(PayrollRunService.prototype) as PayrollRunService;
    Object.assign(service, {
      employees: { findOne: jest.fn(async () => ({ id: 'emp-1' })) },
      payslips: { find },
    });

    const [slip] = await service.payslipsForUser('user-1', 'org-1');

    expect(slip.period).toEqual({
      year: 2026,
      month: 8,
      start: '2026-08-01',
      end: '2026-08-31',
      payDate: '2026-08-30',
      runType: PayrollRunType.REGULAR,
      currencyCode: 'DOP',
    });
    expect(slip).not.toHaveProperty('run');
    const [options] = find.mock.calls[0] as unknown as [{ where: { run: { status: unknown } } }];
    expect(options.where.run.status).toEqual(In([PayrollRunStatus.APPROVED, PayrollRunStatus.PAID]));
  });
});

import 'reflect-metadata';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * One ageing (IA-B02).
 *
 * `GET /reports/aging` was a second implementation — by ledger, in four fixed buckets — that
 * answered 500 whenever a tenant had an open invoice: it joined a `payment.journalEntry` relation the
 * payment entity does not have. Every screen used `GET /customer-payments/aging`. The broken route
 * is gone, and the report builder's `aging-report` is that same receivables ageing.
 */
describe('the receivables ageing has one implementation', () => {
  it('the reports controller no longer serves an ageing of its own', () => {
    const routes = Object.getOwnPropertyNames(ReportsController.prototype)
      .map((name) => (ReportsController.prototype as unknown as Record<string, unknown>)[name])
      .filter((handler): handler is object => typeof handler === 'function')
      .map((handler) => ({
        path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined,
        method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined,
      }))
      .filter((route) => route.path !== undefined);

    expect(routes.some((route) => route.method === RequestMethod.GET && route.path === 'aging')).toBe(false);
    expect(routes.some((route) => route.method === RequestMethod.POST && route.path === 'generate')).toBe(true);
  });

  it('the builder hands the cut-off, the branch and the reader to the receivables ageing', async () => {
    const report = { asOfDate: '2026-11-15', rows: [] };
    const customerPayments = { aging: jest.fn(async () => report) };
    const service = new ReportsService({} as never, customerPayments as never);

    await expect(
      service.receivablesAging('org-1', { asOfDate: '2026-11-15', branchId: 'branch-1' }, 'user-1'),
    ).resolves.toBe(report);
    expect(customerPayments.aging).toHaveBeenCalledWith('org-1', '2026-11-15', { branchId: 'branch-1', actorUserId: 'user-1' });
  });

  it('ages to today when no cut-off is given', async () => {
    const customerPayments = { aging: jest.fn(async () => ({})) };
    const service = new ReportsService({} as never, customerPayments as never);

    await service.receivablesAging('org-1', {}, 'user-1');
    const [, asOf] = customerPayments.aging.mock.calls[0] as unknown as [string, Date];
    expect(asOf).toBeInstanceOf(Date);
  });
});

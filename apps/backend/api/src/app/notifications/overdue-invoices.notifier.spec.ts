import { DataSource } from 'typeorm';
import { OverdueInvoicesNotifier } from './overdue-invoices.notifier';
import { NotificationsService } from './notifications.service';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';

describe('OverdueInvoicesNotifier (QA R3-M09)', () => {
  let query: jest.Mock;
  let create: jest.Mock;
  let notifier: OverdueInvoicesNotifier;

  beforeEach(() => {
    query = jest.fn();
    create = jest.fn().mockResolvedValue({});
    notifier = new OverdueInvoicesNotifier(
      { query } as unknown as DataSource,
      { createLocalizedNotification: create } as unknown as NotificationsService,
      {} as SchedulerLockService,
    );
  });

  it('looks a week back the first time, and tells who follows receivables', async () => {
    query
      .mockResolvedValueOnce([{ since: null }])
      .mockResolvedValueOnce([{ newCount: 1, newAmount: '1475', totalCount: 1, totalAmount: '1475', currency: 'DOP' }])
      .mockResolvedValueOnce([
        { id: 'acc-1', language: 'es', permissions: 'accounts_receivable:view' },
        { id: 'pos-1', language: 'es', permissions: 'pos:sell' },
      ]);
    await expect(notifier.notify('org-1', '2026-10-30')).resolves.toBe(1);
    expect(query.mock.calls[1][1]).toEqual(['org-1', '2026-10-30', '2026-10-23']);
    expect(create).toHaveBeenCalledWith('acc-1', 'es', expect.objectContaining({
      titleKey: 'notifications.overdue_invoices.title',
      link: '/collections',
      params: expect.objectContaining({ count: 1, totalCount: 1 }),
    }));
  });

  it('sends nothing on a day with nothing newly overdue', async () => {
    query
      .mockResolvedValueOnce([{ since: '2026-10-29' }])
      .mockResolvedValueOnce([{ newCount: 0, newAmount: '0', totalCount: 3, totalAmount: '9000', currency: 'DOP' }]);
    await expect(notifier.notify('org-1', '2026-10-30')).resolves.toBe(0);
    expect(query.mock.calls[1][1]).toEqual(['org-1', '2026-10-30', '2026-10-29']);
    expect(create).not.toHaveBeenCalled();
  });
});

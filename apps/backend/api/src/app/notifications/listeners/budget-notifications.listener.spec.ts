import { DataSource } from 'typeorm';
import { BudgetNotificationsListener } from './budget-notifications.listener';
import { NotificationsService } from '../notifications.service';
import { BudgetExceededEvent } from '../../contracts/business-events/budget.events';

/**
 * Under a budget control set to warn, the bell is the warning (FINB-20): the posting went through,
 * so this is how whoever looks after budgets — and the person who posted — learn it was over its line.
 */
describe('BudgetNotificationsListener', () => {
  const event: BudgetExceededEvent = {
    organizationId: 'org-1',
    budgetName: 'Marzo',
    period: '2026-03',
    accountId: 'acc-1',
    accountCode: '6101',
    budgeted: 1000,
    actual: 1500,
    amount: 1500,
    source: 'journal',
    actorUserId: 'poster-1',
  };
  let query: jest.Mock;
  let create: jest.Mock;
  let listener: BudgetNotificationsListener;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    runner = { connect: jest.fn(), query: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
    query = jest.fn(async (sql: string) =>
      sql.includes('JOIN user_roles')
        ? [
            { id: 'controller-1', language: 'en', permissions: 'budgets:manage' },
            { id: 'seller-1', language: 'es', permissions: 'invoices:view' },
          ]
        : [{ id: 'poster-1', language: 'es' }],
    );
    listener = new BudgetNotificationsListener(
      { createLocalizedNotification: create } as unknown as NotificationsService,
      {
        query,
        createQueryRunner: () => runner,
        createEntityManager: () => ({}),
        manager: { findOne: jest.fn(async () => ({ country: 'DO', baseCurrency: 'DOP' })) },
      } as unknown as DataSource,
    );
  });

  it('tells whoever manages budgets and the person who posted, nobody else', async () => {
    await listener.onExceeded(event);

    const recipients = create.mock.calls.map((call) => call[0]).sort();
    expect(recipients).toEqual(['controller-1', 'poster-1']);
    expect(create.mock.calls.find((call) => call[0] === 'controller-1')?.[2]).toMatchObject({
      titleKey: 'notifications.budget_exceeded.title',
      bodyKey: 'notifications.budget_exceeded.body',
      params: expect.objectContaining({ budget: 'Marzo', period: '2026-03', account: '6101' }),
      link: '/accounting/variance-analysis?from=2026-03&to=2026-03',
      organizationId: 'org-1',
    });
    // In a tenant context of its own: the posting's request has given its connection back.
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('app.current_organization'), ['org-1']);
  });

  it('a failure to notify is logged, never thrown: the posting stands', async () => {
    create.mockRejectedValue(new Error('bell is down'));
    await expect(listener.onExceeded(event)).resolves.toBeUndefined();
  });
});

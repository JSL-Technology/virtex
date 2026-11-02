import { DataSource } from 'typeorm';
import { OperationsNotificationsListener } from './operations-notifications.listener';
import { NotificationsService } from '../notifications.service';
import { PayrollRunEvent } from '../../contracts/business-events/payroll-run.events';

describe('OperationsNotificationsListener (QA R3-M09)', () => {
  const run: PayrollRunEvent = {
    organizationId: 'org-1',
    runId: 'run-1',
    name: 'Octubre 2026',
    totalNet: 51234.5,
    currencyCode: 'DOP',
    calculatedBy: 'calc-1',
    approvedBy: null,
    actorUserId: 'calc-1',
  };
  let query: jest.Mock;
  let create: jest.Mock;
  let listener: OperationsNotificationsListener;
  let runner: { connect: jest.Mock; query: jest.Mock; release: jest.Mock };

  beforeEach(() => {
    query = jest.fn();
    create = jest.fn().mockResolvedValue({});
    runner = { connect: jest.fn(), query: jest.fn(async () => undefined), release: jest.fn(async () => undefined) };
    listener = new OperationsNotificationsListener(
      { createLocalizedNotification: create } as unknown as NotificationsService,
      { query, createQueryRunner: () => runner, createEntityManager: () => ({}), manager: { findOne: jest.fn(async () => ({ country: 'DO', baseCurrency: 'DOP' })) } } as unknown as DataSource,
    );
  });

  it('tells whoever may approve a calculated run, never the person who calculated it', async () => {
    query.mockResolvedValue([
      { id: 'calc-1', language: 'es', permissions: 'payroll:approve' },
      { id: 'approver-1', language: 'en', permissions: 'payroll:approve' },
      { id: 'seller-1', language: 'es', permissions: 'invoices:view' },
    ]);
    await listener.onCalculated(run);
    // The query itself excludes the actor; what comes back is filtered by permission.
    expect(query.mock.calls[0][1]).toEqual(['org-1', 'calc-1']);
    const recipients = create.mock.calls.map((call) => call[0]);
    expect(recipients).toContain('approver-1');
    expect(recipients).not.toContain('seller-1');
    // In a tenant context of its own, released afterwards: the request's connection is gone by the
    // time the event is handled («Query runner already released», found re-verifying R3-M09).
    expect(runner.query).toHaveBeenCalledWith(expect.stringContaining('app.current_organization'), ['org-1']);
    expect(runner.release).toHaveBeenCalled();
    expect(create.mock.calls.find((call) => call[0] === 'approver-1')?.[2]).toMatchObject({
      titleKey: 'notifications.payroll.calculated.title',
      // As the company's screens write it: the reader's language, the company's country.
      params: expect.objectContaining({
        amount: new Intl.NumberFormat('en-DO', { style: 'currency', currency: 'DOP' }).format(51234.5),
      }),
      link: '/payroll/runs/run-1',
      organizationId: 'org-1',
    });
  });

  it('tells the calculator when the run is approved, and nobody when they approved it themselves', async () => {
    query.mockResolvedValue([{ id: 'calc-1', language: 'es' }]);
    await listener.onApproved({ ...run, actorUserId: 'approver-1', approvedBy: 'approver-1' });
    expect(create).toHaveBeenCalledWith('calc-1', 'es', expect.objectContaining({ titleKey: 'notifications.payroll.approved.title' }));

    create.mockClear();
    query.mockClear();
    await listener.onApproved({ ...run, actorUserId: 'calc-1' });
    expect(query).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('a new member reaches the company user administrators when no inviter is on record', async () => {
    query.mockResolvedValue([{ id: 'admin-1', language: 'es', permissions: 'users:edit' }]);
    await listener.onMemberJoined({ organizationId: 'org-1', userId: 'new-1', name: 'Ana', email: 'ana@example.com', invitedById: null });
    expect(create).toHaveBeenCalledWith('admin-1', 'es', expect.objectContaining({
      titleKey: 'notifications.member_joined.title',
      params: { name: 'Ana', email: 'ana@example.com' },
    }));
  });

  it('a failure to notify does not escape', async () => {
    query.mockRejectedValue(new Error('down'));
    await expect(listener.onPaid({ ...run, actorUserId: 'payer-1' })).resolves.toBeUndefined();
  });
});

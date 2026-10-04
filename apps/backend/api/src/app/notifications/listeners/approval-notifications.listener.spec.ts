import { ApprovalNotificationsListener } from './approval-notifications.listener';
import { ApprovalDecidedEvent, ApprovalRequestedEvent } from '../../workflows/events/approval.events';

/** QA B-02: approvals reach the people who must act on them, and the decision reaches the requester. */
describe('ApprovalNotificationsListener', () => {
  const notifications = { createLocalizedNotification: jest.fn() };
  const query = jest.fn();
  const listener = new ApprovalNotificationsListener(notifications as never, { query } as never);

  beforeEach(() => jest.clearAllMocks());

  const requested: ApprovalRequestedEvent = {
    organizationId: 'org-1',
    requestId: 'req-1',
    documentType: 'VENDOR_BILL',
    documentId: 'bill-1',
    amount: 15000,
    roleId: 'role-cfo',
    stepOrder: 2,
    requestedByUserId: 'clerk',
  };

  it('tells the approvers of the open step, and not the requester', async () => {
    query.mockResolvedValueOnce([
      { id: 'cfo-1', language: 'en' },
      { id: 'cfo-2', language: null },
    ]);
    await listener.onRequested(requested);

    const [sql, args] = query.mock.calls[0];
    expect(sql).toContain('u.id <> $3::uuid');
    expect(args).toEqual(['org-1', 'role-cfo', 'clerk']);
    expect(notifications.createLocalizedNotification).toHaveBeenCalledWith('cfo-1', 'en', {
      titleKey: 'notifications.approval.requested.title',
      bodyKey: 'notifications.approval.requested.body_step',
      params: { documentKey: 'notifications.document_type.vendor_bill', amount: '15,000.00', step: 2 },
      link: '/approvals',
      organizationId: 'org-1',
    });
    expect(notifications.createLocalizedNotification.mock.calls[1][1]).toBe('es');
  });

  const decided: ApprovalDecidedEvent = {
    organizationId: 'org-1',
    requestId: 'req-1',
    documentType: 'JOURNAL_ENTRY',
    documentId: 'je-1',
    decision: 'REJECTED',
    requestedByUserId: 'clerk',
    actorUserId: 'cfo-1',
    reason: 'Falta soporte',
  };

  it('tells the requester how it ended, with a link to the document', async () => {
    query.mockResolvedValueOnce([{ id: 'clerk', language: 'es' }]);
    await listener.onDecided(decided);
    expect(notifications.createLocalizedNotification).toHaveBeenCalledWith('clerk', 'es', {
      titleKey: 'notifications.approval.rejected.title',
      bodyKey: 'notifications.approval.rejected.body',
      params: { documentKey: 'notifications.document_type.journal_entry', reason: 'Falta soporte' },
      link: '/accounting/journal-entries/je-1/edit',
      organizationId: 'org-1',
    });
  });

  it('says nothing to somebody who decided their own request, or when nobody raised it', async () => {
    await listener.onDecided({ ...decided, actorUserId: 'clerk' });
    await listener.onDecided({ ...decided, requestedByUserId: null });
    expect(notifications.createLocalizedNotification).not.toHaveBeenCalled();
  });

  it('does not fail the approval when a notice cannot be written', async () => {
    query.mockRejectedValueOnce(new Error('db down'));
    await expect(listener.onRequested(requested)).resolves.toBeUndefined();
  });
});

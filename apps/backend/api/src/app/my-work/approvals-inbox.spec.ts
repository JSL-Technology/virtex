import { ApprovalSource, PendingDecision } from '../contracts/approvals/approval-source.contract';
import { ApprovalSourceRegistry } from '../contracts/approvals/approval-source.registry';
import { AuthenticatedUser } from '../security/principal';
import { ApprovalsInboxService } from './approvals-inbox.service';

/**
 * The approvals inbox (QA A-11): purchase orders and requisitions waiting for approval never reached
 * «Aprobaciones», which read only the workflow engine. Every domain now registers a source.
 */
describe('ApprovalsInboxService', () => {
  const decision = (source: string, id: string, canDecide: boolean): PendingDecision => ({
    source,
    id,
    documentTypeKey: `approvals.document_type.${source}`,
    number: id,
    party: null,
    amount: 100,
    currencyCode: 'DOP',
    requestedAt: null,
    route: null,
    step: null,
    canDecide,
    blockedReasonKey: canDecide ? null : 'approvals.blocked.own_request',
  });

  function source(sourceId: string, decidePermission: string, pending: PendingDecision[] | Error): jest.Mocked<ApprovalSource> {
    return {
      sourceId,
      decidePermission,
      pendingFor: jest.fn(async () => {
        if (pending instanceof Error) throw pending;
        return pending;
      }),
      approve: jest.fn(async () => undefined),
      reject: jest.fn(async () => undefined),
    } as unknown as jest.Mocked<ApprovalSource>;
  }

  const user = (permissions: string[]) =>
    ({ id: 'u-1', organizationId: 'org-1', permissions, roles: [{ id: 'role-1' }] }) as unknown as AuthenticatedUser;

  let registry: ApprovalSourceRegistry;
  let inbox: ApprovalsInboxService;
  let orders: jest.Mocked<ApprovalSource>;
  let workflows: jest.Mocked<ApprovalSource>;

  beforeEach(() => {
    registry = new ApprovalSourceRegistry();
    orders = source('purchase_order', 'procurement:approve', [decision('purchase_order', 'po-1', false), decision('purchase_order', 'po-2', true)]);
    workflows = source('workflow', 'workflows:decide', [decision('workflow', 'wf-1', true)]);
    registry.register(orders);
    registry.register(workflows);
    inbox = new ApprovalsInboxService(registry);
  });

  it('collects every source the user may decide on, actionable first', async () => {
    const pending = await inbox.pending(user(['procurement:approve', 'workflows:decide']));
    expect(pending.map((d) => d.id)).toEqual(['po-2', 'wf-1', 'po-1']);
    expect(orders.pendingFor).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u-1', organizationId: 'org-1', roleIds: ['role-1'] }),
    );
  });

  it('does not ask a source the user has no permission to decide on', async () => {
    const pending = await inbox.pending(user(['workflows:decide']));
    expect(pending.map((d) => d.source)).toEqual(['workflow']);
    expect(orders.pendingFor).not.toHaveBeenCalled();
  });

  it('keeps the rest of the inbox when one source fails', async () => {
    registry.register(source('broken', 'workflows:decide', new Error('boom')));
    const pending = await inbox.pending(user(['procurement:approve', 'workflows:decide']));
    expect(pending).toHaveLength(3);
  });

  it('routes the decision to the source that owns the document', async () => {
    await inbox.approve(user(['procurement:approve']), 'purchase_order', 'po-2', 'ok');
    expect(orders.approve).toHaveBeenCalledWith('po-2', expect.objectContaining({ userId: 'u-1' }), 'ok');

    await inbox.reject(user(['procurement:approve']), 'purchase_order', 'po-2', 'Precio fuera de contrato');
    expect(orders.reject).toHaveBeenCalledWith('po-2', expect.anything(), 'Precio fuera de contrato');
  });

  it('refuses an unknown source and a decision the user may not take', async () => {
    await expect(inbox.approve(user(['*']), 'nope', 'x')).rejects.toMatchObject({ messageKey: 'approvals.unknown_source' });
    await expect(inbox.approve(user(['workflows:decide']), 'purchase_order', 'po-2')).rejects.toMatchObject({
      messageKey: 'approvals.not_allowed_to_decide',
    });
    expect(orders.approve).not.toHaveBeenCalled();
  });
});

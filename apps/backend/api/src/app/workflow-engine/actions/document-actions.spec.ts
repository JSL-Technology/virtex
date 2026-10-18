import { ForbiddenError } from '../../i18n/localized.exception';
import { WorkflowAction, WorkflowActionContext } from '../workflow-action.registry';
import { DocumentWorkflowActions } from './document-actions';

/**
 * The step that makes a process the ERP's control rather than a diagram beside it (QA A-01): the
 * decision lands on the document, on behalf of whoever decided, and a refusal is an outcome the
 * author can route — never an exception that stops the run.
 */
describe('DocumentWorkflowActions', () => {
  const source = { approve: jest.fn(), reject: jest.fn() };
  const approvals = { get: jest.fn((id: string) => (id === 'purchase_order' ? source : undefined)) };
  const directory = {
    principal: jest.fn(async (_org: string, id: string) =>
      id === 'ana' ? { id: 'ana', name: 'Ana', roleIds: ['r1'], permissions: ['procurement:approve'] } : null,
    ),
  };
  let action: WorkflowAction;

  const ctx = (over: Partial<WorkflowActionContext> = {}): WorkflowActionContext =>
    ({
      organizationId: 'org',
      instanceId: 'run',
      nodeId: 'n',
      context: { lastActorUserId: 'ana', lastComment: 'Dentro de presupuesto' },
      params: { decision: 'approve', reason: '{{lastComment}}' },
      startedByUserId: 'starter',
      subjectLabel: 'PO-1',
      subject: { type: 'purchase_order', id: 'po-1', label: 'PO-1' },
      ...over,
    }) as WorkflowActionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    const registry = { register: (a: WorkflowAction) => (action = a) };
    new DocumentWorkflowActions(registry as never, approvals as never, directory as never).onModuleInit();
  });

  it('approves the document on behalf of whoever decided the last task, with their comment', async () => {
    const result = await action.run(ctx());

    expect(source.approve).toHaveBeenCalledWith(
      'po-1',
      { userId: 'ana', organizationId: 'org', permissions: ['procurement:approve'], roleIds: ['r1'] },
      'Dentro de presupuesto',
    );
    expect(result.outcome).toBe('ok');
    expect(result.summaryKey).toBe('workflow_engine.document_result.approved');
    expect(result.patch).toMatchObject({ document: { ok: true, decision: 'approve', by: 'ana' } });
  });

  it('rejects with a reason even when the comment is empty', async () => {
    await action.run(ctx({ params: { decision: 'reject', reason: '' } }));

    expect(source.reject).toHaveBeenCalledWith('po-1', expect.objectContaining({ userId: 'ana' }), 'workflow');
  });

  it('answers «error» with the refusal when the document service says no', async () => {
    source.approve.mockRejectedValueOnce(new ForbiddenError('approvals.segregation_of_duties'));

    const result = await action.run(ctx());

    expect(result.outcome).toBe('error');
    expect(result.summaryKey).toBe('approvals.segregation_of_duties');
    expect(result.patch).toMatchObject({ document: { ok: false } });
  });

  it('answers «error» when the process is not about a document, or one it cannot decide', async () => {
    expect((await action.run(ctx({ subject: null }))).summaryKey).toBe('workflow_engine.document_result.no_document');
    expect((await action.run(ctx({ subject: { type: 'invoice', id: 'i-1', label: 'F-1' } }))).summaryKey).toBe(
      'workflow_engine.document_result.unsupported',
    );
    expect(source.approve).not.toHaveBeenCalled();
  });

  it('answers «error» when nobody can be named as the one deciding', async () => {
    const result = await action.run(ctx({ context: {}, startedByUserId: null }));

    expect(result.summaryKey).toBe('workflow_engine.document_result.no_actor');
  });
});

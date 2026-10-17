import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { WorkflowGraph, WorkflowNodeType } from './contracts/workflow-graph';
import { WorkflowDefinition, WorkflowDefinitionStatus } from './entities/workflow-definition.entity';
import { WorkflowInstance, WorkflowInstanceStatus } from './entities/workflow-instance.entity';
import { WorkflowTask, WorkflowTaskStatus } from './entities/workflow-task.entity';
import { WorkflowTransition } from './entities/workflow-transition.entity';
import { WorkflowActionRegistry } from './workflow-action.registry';
import { WorkflowEngineService } from './workflow-engine.service';
import { WorkflowNotifier } from './workflow-notifier.service';

const USER = '11111111-1111-4111-8111-111111111111';

/**
 * The engine against a real PostgreSQL: the properties that only a database can prove — row locks
 * serialising a double completion, timers resuming past the wait, a failed run resuming in place.
 */
describeWithDb('WorkflowEngineService (integration)', () => {
  let dataSource: DataSource;
  let organizationId: string;
  let engine: WorkflowEngineService;
  const registry = new WorkflowActionRegistry();
  const notifier = { taskCreated: jest.fn(), taskClosed: jest.fn(), taskOverdue: jest.fn(), instanceFailed: jest.fn() };
  let failNext = true;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'Workflow engine');
    registry.register({
      key: 'flaky',
      labelKey: 'x',
      params: [],
      run: async () => {
        if (failNext) {
          failNext = false;
          throw new Error('downstream unavailable');
        }
        return { patch: { flaky: 'ok' } };
      },
    });
    registry.register({
      key: 'always_error',
      labelKey: 'x',
      outcomes: ['ok', 'error'],
      params: [],
      run: async () => ({ outcome: 'error', summaryKey: 'workflow_engine.webhook_result.private_address' }),
    });
    engine = new WorkflowEngineService(dataSource, registry, notifier as unknown as WorkflowNotifier);
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  async function publish(graph: WorkflowGraph): Promise<WorkflowDefinition> {
    const repo = dataSource.getRepository(WorkflowDefinition);
    return repo.save(
      repo.create({
        organizationId,
        key: `k-${Math.random().toString(36).slice(2, 10)}`,
        name: 'Proceso de prueba',
        description: null,
        version: 1,
        status: WorkflowDefinitionStatus.PUBLISHED,
        graph,
        trigger: { mode: 'manual' },
        createdByUserId: null,
        updatedByUserId: null,
        publishedAt: new Date(),
        publishedByUserId: null,
      }),
    );
  }

  const transitions = (instanceId: string) =>
    dataSource.getRepository(WorkflowTransition).find({ where: { instanceId }, order: { createdAt: 'ASC' } });

  it('resumes a timer past its wait instead of re-arming it', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 'w', type: WorkflowNodeType.TIMER, config: { timerMinutes: 1 } },
        { id: 'e', type: WorkflowNodeType.END, name: 'Hecho' },
      ],
      edges: [
        { id: '1', from: 's', to: 'w' },
        { id: '2', from: 'w', to: 'e' },
      ],
    });
    const started = await engine.start(definition, {}, organizationId);
    expect(started.status).toBe(WorkflowInstanceStatus.RUNNING);
    expect(started.nextWakeAt).not.toBeNull();

    const resumed = await engine.resumeDueTimers(organizationId, new Date(Date.now() + 2 * 60_000));
    expect(resumed).toBe(1);
    const after = await dataSource.getRepository(WorkflowInstance).findOneByOrFail({ id: started.id });
    expect(after.status).toBe(WorkflowInstanceStatus.COMPLETED);
    expect(after.result).toBe('Hecho');
    expect((await transitions(started.id)).map((t) => t.kind)).toEqual(['started', 'timer_set', 'timer_fired', 'completed']);

    // A second sweep finds nothing: the instance is done, not parked again.
    expect(await engine.resumeDueTimers(organizationId, new Date(Date.now() + 10 * 60_000))).toBe(0);
  });

  it('serialises concurrent completions: one wins, the other gets a conflict, the flow advances once', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 't', type: WorkflowNodeType.APPROVAL, name: 'Aprobar', config: { assigneeUserId: USER } },
        { id: 'x', type: WorkflowNodeType.ACTION, config: { action: 'flaky' } },
        { id: 'ok', type: WorkflowNodeType.END, name: 'Aprobado' },
        { id: 'ko', type: WorkflowNodeType.END, name: 'Rechazado' },
      ],
      edges: [
        { id: '1', from: 's', to: 't' },
        { id: '2', from: 't', to: 'ok', outcome: 'approve' },
        { id: '3', from: 't', to: 'ko', outcome: 'reject' },
      ],
    });
    const instance = await engine.start(definition, {}, organizationId);
    const [task] = await dataSource.getRepository(WorkflowTask).findBy({ instanceId: instance.id });
    expect(task.status).toBe(WorkflowTaskStatus.OPEN);
    expect(task.commentRequiredFor).toEqual(['reject']);

    const actor = { userId: USER, roleIds: [] };
    const results = await Promise.allSettled([
      engine.completeTask(task.id, organizationId, { outcome: 'approve' }, actor),
      engine.completeTask(task.id, organizationId, { outcome: 'approve' }, actor),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.getStatus()).toBe(409);

    const kinds = (await transitions(instance.id)).map((t) => t.kind);
    expect(kinds.filter((k) => k === 'task_completed')).toHaveLength(1);
    const after = await dataSource.getRepository(WorkflowInstance).findOneByOrFail({ id: instance.id });
    expect(after.status).toBe(WorkflowInstanceStatus.COMPLETED);
    expect(after.result).toBe('Aprobado');
  });

  it('refuses a rejection without a comment, a stranger, and an unknown outcome', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 't', type: WorkflowNodeType.APPROVAL, config: { assigneeUserId: USER } },
        { id: 'e', type: WorkflowNodeType.END },
      ],
      edges: [
        { id: '1', from: 's', to: 't' },
        { id: '2', from: 't', to: 'e', default: true },
      ],
    });
    const instance = await engine.start(definition, {}, organizationId);
    const [task] = await dataSource.getRepository(WorkflowTask).findBy({ instanceId: instance.id });
    await expect(engine.completeTask(task.id, organizationId, { outcome: 'reject' }, { userId: USER, roleIds: [] })).rejects.toMatchObject({
      messageKey: 'workflow_engine.comment_required',
    });
    await expect(
      engine.completeTask(task.id, organizationId, { outcome: 'approve' }, { userId: '99999999-9999-4999-8999-999999999999', roleIds: [] }),
    ).rejects.toMatchObject({ messageKey: 'workflow_engine.not_your_task' });
    await expect(engine.completeTask(task.id, organizationId, { outcome: 'maybe' }, { userId: USER, roleIds: [] })).rejects.toMatchObject({
      messageKey: 'workflow_engine.invalid_outcome',
    });
    const done = await engine.completeTask(task.id, organizationId, { outcome: 'reject', comment: 'Precio fuera de política' }, { userId: USER, roleIds: [] });
    expect(done.status).toBe(WorkflowInstanceStatus.COMPLETED);
    expect(done.context['lastComment']).toBe('Precio fuera de política');
  });

  it('marks a run FAILED on an action error and resumes it from that step on retry', async () => {
    failNext = true;
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 'x', type: WorkflowNodeType.ACTION, name: 'Llamar ERP', config: { action: 'flaky' } },
        { id: 'e', type: WorkflowNodeType.END, name: 'Fin' },
      ],
      edges: [
        { id: '1', from: 's', to: 'x' },
        { id: '2', from: 'x', to: 'e' },
      ],
    });
    const failed = await engine.start(definition, {}, organizationId);
    expect(failed.status).toBe(WorkflowInstanceStatus.FAILED);
    expect(failed.error).toContain('downstream unavailable');
    expect(failed.tokens[0].nodeId).toBe('x');

    const retried = await engine.retry(failed.id, organizationId, USER);
    expect(retried.status).toBe(WorkflowInstanceStatus.COMPLETED);
    expect(retried.context['flaky']).toBe('ok');
  });

  it('never sends an error outcome down the success connection (QA C-04)', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 'w', type: WorkflowNodeType.ACTION, name: 'Llamar', config: { action: 'always_error' } },
        { id: 'e', type: WorkflowNodeType.END, name: 'Correcto' },
      ],
      edges: [
        { id: '1', from: 's', to: 'w' },
        { id: '2', from: 'w', to: 'e', outcome: 'ok' },
      ],
    });
    const run = await engine.start(definition, {}, organizationId);
    expect(run.status).toBe(WorkflowInstanceStatus.FAILED);
    expect(run.error).toBe('workflow_engine.runtime.no_exit');
    expect(run.result).toBeNull();
    const action = (await transitions(run.id)).find((t) => t.kind === 'action');
    expect(action?.detail).toMatchObject({ outcome: 'error', failed: true, summaryKey: 'workflow_engine.webhook_result.private_address' });
  });

  it('cancels with a reason, closing the open tasks', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 't', type: WorkflowNodeType.TASK, config: { assigneeUserId: USER } },
        { id: 'e', type: WorkflowNodeType.END },
      ],
      edges: [
        { id: '1', from: 's', to: 't' },
        { id: '2', from: 't', to: 'e' },
      ],
    });
    const instance = await engine.start(definition, {}, organizationId);
    await expect(engine.cancel(instance.id, organizationId, USER, ' ')).rejects.toMatchObject({ messageKey: 'workflow_engine.cancel_reason_required' });
    const cancelled = await engine.cancel(instance.id, organizationId, USER, 'Pedido duplicado');
    expect(cancelled.status).toBe(WorkflowInstanceStatus.CANCELLED);
    expect(cancelled.cancelReason).toBe('Pedido duplicado');
    const tasks = await dataSource.getRepository(WorkflowTask).findBy({ instanceId: instance.id });
    expect(tasks.every((task) => task.status === WorkflowTaskStatus.CANCELLED)).toBe(true);
    expect(notifier.taskClosed).toHaveBeenCalled();
  });

  it('escalates an overdue task once', async () => {
    const definition = await publish({
      nodes: [
        { id: 's', type: WorkflowNodeType.START },
        { id: 't', type: WorkflowNodeType.TASK, config: { assigneeUserId: USER, dueInHours: 1 } },
        { id: 'e', type: WorkflowNodeType.END },
      ],
      edges: [
        { id: '1', from: 's', to: 't' },
        { id: '2', from: 't', to: 'e' },
      ],
    });
    await engine.start(definition, {}, organizationId);
    const later = new Date(Date.now() + 2 * 3600_000);
    expect(await engine.escalateOverdue(organizationId, later)).toBeGreaterThanOrEqual(1);
    expect(await engine.escalateOverdue(organizationId, later)).toBe(0);
    expect(notifier.taskOverdue).toHaveBeenCalled();
  });
});

import { FinancialAuditSubscriber } from './financial-audit.subscriber';
import { runInTenantContext } from '../shared/tenancy/tenant-context';

/**
 * AUD-01 (audit 2026-10-31): every automatic audit row had no author and no IP — the subscriber
 * read a request context whose module was never registered. It now reads the actor the tenant
 * interceptor puts in the request's context.
 */
describe('FinancialAuditSubscriber — author and content of the trail', () => {
  function event(tableName: string, entity: Record<string, unknown>) {
    const save = jest.fn().mockResolvedValue(undefined);
    const create = jest.fn((_target: unknown, row: unknown) => row);
    return { save, create, event: { metadata: { tableName }, entity, manager: { save, create } } };
  }

  it('records who acted and from where when the change happens inside a request', async () => {
    const subscriber = new FinancialAuditSubscriber();
    const { create, event: insert } = event('invoices', { id: 'inv-1', organizationId: 'org-1', total: 118 });

    await runInTenantContext(
      { organizationId: 'org-1', manager: {} as never, actor: { userId: 'user-7', ipAddress: '10.0.0.9' } },
      () => subscriber.afterInsert(insert as never),
    );

    expect(create).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: 'user-7', ipAddress: '10.0.0.9', organizationId: 'org-1', entity: 'invoices' }),
    );
  });

  it("records a role's permissions, and never copies a secret into the trail", async () => {
    const subscriber = new FinancialAuditSubscriber();
    const { create, event: insert } = event('roles', {
      id: 'role-1',
      organizationId: 'org-1',
      permissions: ['invoices:view', 'invoices:create'],
      apiKey: 'sk_live_should_never_appear',
    });

    await subscriber.afterInsert(insert as never);

    const row = create.mock.calls[0][1] as { newValue: Record<string, unknown> };
    expect(row.newValue['permissions']).toEqual(['invoices:view', 'invoices:create']);
    expect(row.newValue['apiKey']).toBe('[redactado]');
  });

  it('ignores tables that are not audited', async () => {
    const subscriber = new FinancialAuditSubscriber();
    const { save, event: insert } = event('ai_messages', { id: 'm-1' });
    await subscriber.afterInsert(insert as never);
    expect(save).not.toHaveBeenCalled();
  });
});

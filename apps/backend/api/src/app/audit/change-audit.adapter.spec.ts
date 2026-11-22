import { DataSource } from 'typeorm';
import { AuditLog } from './entities/audit-log.entity';
import { AuditTrailService } from './audit.service';
import { ChangeAuditAdapter } from './access-audit.adapter';
import { describeWithDb, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The trail of a write that bypasses the audit subscriber — an upsert, a delete by criteria, an
 * import — recorded through `ChangeAuditPort.recordChangesWithin` (FINB-05): one row per change,
 * in the caller's transaction, so it commits with the change or rolls back with it.
 */
describeWithDb('ChangeAuditAdapter.recordChangesWithin', () => {
  let ds: DataSource;
  let adapter: ChangeAuditAdapter;
  // The trail is append-only (a trigger refuses deletions), so each test writes under ids of its own.
  const entityId = () => `qa-change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const rowsFor = (id: string) =>
    ds.query(
      `SELECT "actionType" AS action, user_id AS "userId", organization_id AS "organizationId", new_value AS "newValue", previous_value AS "previousValue"
         FROM audit_logs WHERE entity = 'qa_change_adapter' AND entity_id = $1 ORDER BY created_at, id`,
      [id],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    adapter = new ChangeAuditAdapter(new AuditTrailService(ds.getRepository(AuditLog)));
  });

  afterAll(async () => {
    if (ds?.isInitialized) await ds.destroy();
  });

  it('writes one row per change, with its action, author, before and after', async () => {
    const created = entityId();
    const updated = entityId();
    await ds.transaction((manager) =>
      adapter.recordChangesWithin(manager, [
        { userId: null, organizationId: null, entity: 'qa_change_adapter', entityId: created, action: 'CREATE', before: null, after: { rate: 1 } },
        { userId: null, organizationId: null, entity: 'qa_change_adapter', entityId: updated, action: 'UPDATE', before: { rate: 1 }, after: { rate: 2 } },
      ]),
    );
    expect(await rowsFor(created)).toEqual([{ action: 'CREATE', userId: null, organizationId: null, newValue: { rate: 1 }, previousValue: null }]);
    expect(await rowsFor(updated)).toEqual([{ action: 'UPDATE', userId: null, organizationId: null, newValue: { rate: 2 }, previousValue: { rate: 1 } }]);
  });

  it('rolls back with the change it describes', async () => {
    const id = entityId();
    await expect(
      ds.transaction(async (manager) => {
        await adapter.recordChangesWithin(manager, [
          { userId: null, organizationId: null, entity: 'qa_change_adapter', entityId: id, action: 'DELETE', before: null, after: { rate: 3 } },
        ]);
        throw new Error('the change failed after its trail was written');
      }),
    ).rejects.toThrow('the change failed');
    expect(await rowsFor(id)).toHaveLength(0);
  });

  it('records a large batch in chunks the driver accepts', async () => {
    const ids = Array.from({ length: 1200 }, () => entityId());
    await ds.transaction((manager) =>
      adapter.recordChangesWithin(
        manager,
        ids.map((id) => ({ userId: null, organizationId: null, entity: 'qa_change_adapter', entityId: id, action: 'CREATE' as const, before: null, after: { id } })),
      ),
    );
    const [{ count }] = await ds.query(`SELECT COUNT(*)::int AS count FROM audit_logs WHERE entity = 'qa_change_adapter' AND entity_id = ANY($1)`, [ids]);
    expect(count).toBe(1200);
  });
});

import { DataSource, EntityManager } from 'typeorm';
import { SaasService } from './saas.service';
import { SaasResource } from './enums/saas-resource.enum';
import { SaasLimitReachedException } from './exceptions/saas-exception';
import { Organization } from '../organizations/entities/organization.entity';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * A lifetime quota is decided by counting what exists (IAM-P4).
 *
 * It was decided by a counter that started at zero whatever the tenant already had — the owner of
 * every signup was never counted, and in the development database 6 of 7 organizations with members
 * had no counter at all — so a tenant could go past its plan until a nightly job overwrote the
 * counter, and that job, connected as the application's role with no tenant in context, counted
 * nothing under the row-level policies.
 *
 * Against PostgreSQL as `virtex_app`, inside the tenant's context, with `customers` — a table the
 * policies isolate — on a QA plan that allows two.
 */
describeWithDb('a lifetime quota counts what exists, in the tenant, one decision at a time', () => {
  let ds: DataSource;
  let saas: SaasService;
  let organizationId: string;
  let planId: string;
  const cache = new Map<string, unknown>();

  /** A unit of work as the application runs it: its role, the tenant stamped on the transaction. */
  const asTenant = <T>(work: (manager: EntityManager) => Promise<T>): Promise<T> =>
    ds.transaction(async (manager) => {
      await manager.query(`SET LOCAL ROLE virtex_app`);
      await manager.query(`SELECT set_config('app.current_organization', $1, true)`, [organizationId]);
      return work(manager);
    });

  /** What `CustomersService.create` does: decide, then insert, in one transaction. */
  const createCustomer = () =>
    asTenant(async (manager) => {
      await saas.enforceLimit(manager, organizationId, SaasResource.CUSTOMERS);
      await manager.query(`INSERT INTO customers (organization_id) VALUES ($1)`, [organizationId]);
    });

  const customers = async () =>
    Number((await ds.query(`SELECT COUNT(*)::int AS n FROM customers WHERE organization_id = $1`, [organizationId]))[0].n);

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'QA cuota');
    [{ id: planId }] = await ds.query(
      `INSERT INTO saas_plans (slug, name, is_active) VALUES ($1, 'QA cuota', false) RETURNING id`,
      [`qa-quota-${Date.now()}`],
    );
    await ds.query(
      `INSERT INTO saas_plan_limits (plan_id, resource, "valueType", "limit", period, allow_overage)
       VALUES ($1, 'customers', 'NUMERIC', 2, 'lifetime', false)`,
      [planId],
    );
    await ds.query(`UPDATE organizations SET plan_id = $1 WHERE id = $2`, [planId, organizationId]);

    const cacheManager = {
      get: async (key: string) => cache.get(key),
      set: async (key: string, value: unknown) => void cache.set(key, value),
      del: async (key: string) => void cache.delete(key),
    };
    saas = new SaasService(
      {} as never, {} as never, {} as never,
      ds.getRepository(Organization), {} as never,
      {} as never, { emit: jest.fn() } as never, {} as never,
      ds, cacheManager as never,
      { limitHitCounter: { labels: () => ({ inc: jest.fn() }) } } as never,
      {} as never,
    );
  }, 60_000);

  afterAll(async () => {
    if (ds?.isInitialized) {
      await ds.query(`DELETE FROM customers WHERE organization_id = $1`, [organizationId]);
      await ds.query(`UPDATE organizations SET plan_id = NULL WHERE id = $1`, [organizationId]);
      await ds.query(`DELETE FROM saas_plan_limits WHERE plan_id = $1`, [planId]);
      await ds.query(`DELETE FROM saas_plans WHERE id = $1`, [planId]);
    }
    await dropTestOrganization(ds, organizationId);
  }, 120_000);

  it('counts the customers the tenant already has, not a counter that started at zero', async () => {
    // One customer existed before any metered creation: a counter would have said 0 and let two more in.
    await asTenant((manager) => manager.query(`INSERT INTO customers (organization_id) VALUES ($1)`, [organizationId]));

    await createCustomer();
    await expect(createCustomer()).rejects.toBeInstanceOf(SaasLimitReachedException);
    expect(await customers()).toBe(2);
  });

  it('two creations at the same time cannot both take the last unit', async () => {
    await ds.query(
      `DELETE FROM customers WHERE id = (SELECT id FROM customers WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [organizationId],
    );
    expect(await customers()).toBe(1);

    const outcomes = await Promise.allSettled([createCustomer(), createCustomer()]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(['fulfilled', 'rejected']);
    const refusal = outcomes.find((outcome) => outcome.status === 'rejected') as PromiseRejectedResult;
    expect(refusal.reason).toBeInstanceOf(SaasLimitReachedException);
    expect(await customers()).toBe(2);
  });

  it('a deleted customer frees its unit at once, with nothing to «release»', async () => {
    await ds.query(
      `DELETE FROM customers WHERE id = (SELECT id FROM customers WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [organizationId],
    );
    await expect(createCustomer()).resolves.toBeUndefined();
    expect(await customers()).toBe(2);
  });

  it('the guard’s pre-check gives the answer enforcement gives', async () => {
    await expect(saas.checkLimit(organizationId, SaasResource.CUSTOMERS, 1)).resolves.toBe(false);
    await ds.query(
      `DELETE FROM customers WHERE id = (SELECT id FROM customers WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1)`,
      [organizationId],
    );
    await expect(saas.checkLimit(organizationId, SaasResource.CUSTOMERS, 1)).resolves.toBe(true);
  });

  it('leaves no counter behind for a lifetime quota', async () => {
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM saas_usage_metrics WHERE organization_id = $1 AND period = 'lifetime'`,
      [organizationId],
    );
    expect(n).toBe(0);
  });

  it('refuses to decide outside the transaction that creates the row', async () => {
    await expect(saas.enforceLimit(ds.manager, organizationId, SaasResource.CUSTOMERS)).rejects.toThrow(/inside the transaction/);
  });
});

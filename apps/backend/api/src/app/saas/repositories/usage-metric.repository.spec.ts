import { DataSource } from 'typeorm';
import { UsageMetricRepository } from './usage-metric.repository';
import { SaasResource } from '../enums/saas-resource.enum';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../../common/database/testing/integration-db';

/**
 * The plan quota, against PostgreSQL itself — the defects it has had were all about how Postgres
 * behaves, which a mock cannot show:
 *
 *  - an UPDATE that matched nothing returned `[[], 0]`, truthy, so the first unit was never counted;
 *  - catching a 23505 from a concurrent insert left the CALLER's transaction aborted, so issuing a
 *    credit note or voiding with the quota spent answered 500 (audit 2026-11-07, FAC-INV-01).
 */
describeWithDb('UsageMetricRepository.incrementUsage', () => {
  let ds: DataSource;
  let organizationId: string;
  const repository = new UsageMetricRepository();
  let period = 0;
  const nextPeriod = () => `qa-${Date.now()}-${(period += 1)}`;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'quota');
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM saas_usage_metrics WHERE organization_id = $1`, [organizationId]);
    await dropTestOrganization(ds, organizationId);
  });

  it('counts the first unit of a period and every unit after it', async () => {
    const key = nextPeriod();
    await expect(repository.incrementUsage(ds.manager, organizationId, SaasResource.INVOICES, key, 1, 10, false)).resolves.toEqual({ count: 1, limitReached: false });
    await expect(repository.incrementUsage(ds.manager, organizationId, SaasResource.INVOICES, key, 1, 10, false)).resolves.toEqual({ count: 2, limitReached: false });
  });

  it('at the limit it reports so, and the caller’s transaction is still usable', async () => {
    const key = nextPeriod();
    await ds.transaction(async (manager) => {
      await repository.incrementUsage(manager, organizationId, SaasResource.INVOICES, key, 1, 1, false);
      const refused = await repository.incrementUsage(manager, organizationId, SaasResource.INVOICES, key, 1, 1, false);
      expect(refused).toEqual({ count: 1, limitReached: true });
      // The regression: this statement used to fail with "current transaction is aborted".
      await expect(manager.query(`SELECT 1 AS ok`)).resolves.toEqual([{ ok: 1 }]);
    });
  });

  it('twenty concurrent callers with a limit of ten: exactly ten succeed', async () => {
    const key = nextPeriod();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        ds.transaction((manager) => repository.incrementUsage(manager, organizationId, SaasResource.INVOICES, key, 1, 10, false)),
      ),
    );
    expect(results.filter((r) => !r.limitReached)).toHaveLength(10);
    const [{ count }] = await ds.query(`SELECT count FROM saas_usage_metrics WHERE organization_id = $1 AND period = $2`, [organizationId, key]);
    expect(Number(count)).toBe(10);
  });

  it('an unlimited or overage-allowed quota always counts', async () => {
    const key = nextPeriod();
    await repository.incrementUsage(ds.manager, organizationId, SaasResource.INVOICES, key, 5, -1, false);
    await expect(repository.incrementUsage(ds.manager, organizationId, SaasResource.INVOICES, key, 5, 1, true)).resolves.toEqual({ count: 10, limitReached: false });
  });
});

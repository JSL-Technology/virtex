import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../../common/database/testing/integration-db';
import { standardSalesTaxRate } from './sellable-product.contract';

/**
 * The default rate of a taxed product is the country's GENERAL rate, not the highest rate in the
 * tenant's list (audit 2026-11-07, FAC-TX-02): a 28 % luxury rate must not become everyone's ITBIS.
 */
describeWithDb('standardSalesTaxRate', () => {
  let ds: DataSource;
  let doOrg: string;
  let usOrg: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    doOrg = await createTestOrganization(ds, 'QA-std-rate-DO');
    usOrg = await createTestOrganization(ds, 'QA-std-rate-US');
    await ds.query(`UPDATE organizations SET country = 'DO' WHERE id = $1`, [doOrg]);
    await ds.query(`UPDATE organizations SET country = 'US' WHERE id = $1`, [usOrg]);
    for (const [org, name, rate] of [[doOrg, 'ITBIS 18%', 18], [doOrg, 'QA-Lujo 28%', 28], [usOrg, 'QA-TX 8.25%', 8.25]] as const) {
      await ds.query(`INSERT INTO taxes (name, rate, type, organization_id) VALUES ($1, $2, 'Porcentaje', $3)`, [name, rate, org]);
    }
  });
  afterAll(async () => {
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [doOrg]);
    await dropTestOrganization(ds, usOrg);
  });

  it("takes the country's general rate, whatever higher rate the tenant registers", async () => {
    expect(await standardSalesTaxRate(ds.manager, doOrg)).toBe(0.18);
  });

  it("falls back to the tenant's own list where the market has no national rate", async () => {
    expect(await standardSalesTaxRate(ds.manager, usOrg)).toBeCloseTo(0.0825, 6);
  });
});

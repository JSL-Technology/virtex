import { DataSource } from 'typeorm';
import { SupplyChainService } from './supply-chain.service';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * A warehouse that holds locations or stock is deactivated, not deleted.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('warehouse lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'warehouse lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('a warehouse with locations is deactivated, not deleted', async () => {
    const supply = new SupplyChainService(
      dataSource.getRepository(Warehouse),
      dataSource.getRepository(BinLocation),
      dataSource.getRepository(LandedCost),
    );
    const warehouse = await newId(dataSource);
    await dataSource.query(`INSERT INTO warehouses (id, organization_id, name) VALUES ($1, $2, 'Central')`, [
      warehouse,
      organizationId,
    ]);
    await dataSource.query(
      `INSERT INTO bin_locations (organization_id, warehouse_id, code) VALUES ($1, $2, 'A-01')`,
      [organizationId, warehouse],
    );
    await expect(supply.removeWarehouse(warehouse, organizationId)).rejects.toMatchObject({
      messageKey: 'supply_chain.warehouse_in_use_deactivate_instead',
    });
  });
});

import { DataSource } from 'typeorm';
import { ManufacturingService } from './manufacturing.service';
import { ProductionOrder } from './entities/production-order.entity';
import { BillOfMaterial } from './entities/bill-of-material.entity';
import { BillOfMaterialItem } from './entities/bill-of-material-item.entity';
import { WorkCenter } from './entities/work-center.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * A production order is deleted only while it is a plan.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('production order lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'production order lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('a production order is deleted only while it is a plan', async () => {
    const manufacturing = new ManufacturingService(
      dataSource.getRepository(ProductionOrder),
      dataSource.getRepository(BillOfMaterial),
      dataSource.getRepository(BillOfMaterialItem),
      dataSource.getRepository(WorkCenter),
    );
    const product = await newId(dataSource);
    await dataSource.query(`INSERT INTO products (id, organization_id, name) VALUES ($1, $2, 'Mesa')`, [
      product,
      organizationId,
    ]);
    const [planned, released] = [await newId(dataSource), await newId(dataSource)];
    for (const [id, status] of [
      [planned, 'PLANNED'],
      [released, 'RELEASED'],
    ]) {
      await dataSource.query(
        `INSERT INTO production_orders (id, organization_id, "orderNumber", "quantityPlanned", product_id, status)
         VALUES ($1, $2, $3, 10, $4, $5)`,
        [id, organizationId, `OP-${id.slice(0, 8)}`, product, status],
      );
    }

    await expect(manufacturing.removeOrder(released, organizationId)).rejects.toMatchObject({
      messageKey: 'manufacturing.order_started_cancel_instead',
    });
    await expect(manufacturing.removeOrder(planned, organizationId)).resolves.toBeUndefined();
  });
});

import { DataSource } from 'typeorm';
import { FixedAssetsService } from './fixed-assets.service';
import { FixedAsset } from './entities/fixed-asset.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * A fixed asset in the books is disposed of, not deleted.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('fixed asset lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'fixed asset lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('a fixed asset in the books is disposed of, not deleted', async () => {
    const assets = new FixedAssetsService(
      dataSource.getRepository(FixedAsset),
      dataSource,
      {} as never,
      {} as never,
    );
    const [depreciated, fresh] = [await newId(dataSource), await newId(dataSource)];
    for (const [id, accumulated] of [
      [depreciated, 1_200],
      [fresh, 0],
    ] as const) {
      await dataSource.query(
        `INSERT INTO fixed_asset (id, organization_id, name, description, cost, "residualValue", "usefulLife",
                                  "purchaseDate", "depreciationMethod", asset_account_id,
                                  accumulated_depreciation_account_id, accumulated_depreciation)
         VALUES ($1, $2, 'Camioneta', 'Reparto', 36000, 0, 60, '2025-01-01', 'STRAIGHT_LINE', 'a', 'b', $3)`,
        [id, organizationId, accumulated],
      );
    }

    await expect(assets.remove(depreciated, organizationId)).rejects.toMatchObject({
      messageKey: 'fixed_assets.asset_in_books_dispose_instead',
    });
    await expect(assets.remove(fresh, organizationId)).resolves.toBeUndefined();
  });
});

import { DataSource } from 'typeorm';
import { discoverReferences } from './dependents';
import { describeWithDb, dropTestOrganization, openTestDataSource } from './testing/integration-db';

/**
 * Where "is this record in use?" gets its answer (docs/CICLO_DE_VIDA_DE_REGISTROS.md).
 *
 * The schema's own foreign keys, classified by their delete action: CASCADE is composition (a
 * document's lines) and never blocks; SET NULL is a pointer that may be cleared and never blocks;
 * NO ACTION / RESTRICT is use, and blocks. Each domain's lifecycle spec covers its own records.
 */
describeWithDb('record lifecycle: references come from the schema', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
  });

  afterAll(() => dropTestOrganization(dataSource, undefined));

  it('names what uses a warehouse, and nothing that is merely part of it', async () => {
    const references = await discoverReferences(dataSource.manager, 'warehouses');
    expect(references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: 'bin_locations',
          column: 'warehouse_id',
          label: 'common.dependents.bin_locations',
        }),
      ]),
    );
  });

  it('does not count composition: a price list is deletable with its own items', async () => {
    // price_list_items → price_lists is CASCADE: the items are the list, they go with it.
    expect(await discoverReferences(dataSource.manager, 'price_lists')).toEqual([]);
  });
});

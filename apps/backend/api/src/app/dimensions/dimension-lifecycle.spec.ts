import { DataSource } from 'typeorm';
import { DimensionsService } from './dimensions.service';
import { Dimension } from './entities/dimension.entity';
import { DimensionRule } from './entities/dimension-rule.entity';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * Analytic dimensions are immutable once posted lines use them.
 *
 * Part of the record-lifecycle audit (docs/CICLO_DE_VIDA_DE_REGISTROS.md): a record nothing
 * depends on can be deleted; a used one is deactivated, closed, cancelled or retired; a posted one
 * is reversed. This `remove()` used to be a bare `repository.delete()`.
 */
describeWithDb('dimension lifecycle', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'dimension lifecycle');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('refuses to rename or delete a dimension posted lines are tagged with', async () => {
    const dimensions = new DimensionsService(
      dataSource.getRepository(Dimension),
      dataSource.getRepository(DimensionRule),
      dataSource,
    );
    const dimension = await dimensions.create({ name: `Centro ${Date.now()}`, values: [{ value: 'Ventas' }] } as never, organizationId);

    // A posted, balanced entry tagged with the dimension.
    const [ledger, journal, entry, account] = [await newId(dataSource), await newId(dataSource), await newId(dataSource), await newId(dataSource)];
    await dataSource.query(`INSERT INTO ledgers (id, organization_id, name, currency) VALUES ($1, $2, 'Principal', 'DOP')`, [
      ledger,
      organizationId,
    ]);
    await dataSource.query(
      `INSERT INTO journals (id, organization_id, code, name, type) VALUES ($1, $2, 'GENERAL', 'General', 'GENERAL')`,
      [journal, organizationId],
    );
    await dataSource.query(
      `INSERT INTO accounts (id, organization_id, code, name, type, category, nature, "isPostable", version)
       VALUES ($1, $2, '6101', '{"es":"Gastos"}'::jsonb, 'EXPENSE', 'OPERATING_EXPENSE', 'DEBIT', true, 1)`,
      [account, organizationId],
    );
    await dataSource.query(
      `INSERT INTO journal_entries (id, organization_id, ledger_id, journal_id, date, description)
       VALUES ($1, $2, $3, $4, '2026-09-01', 'Gasto')`,
      [entry, organizationId, ledger, journal],
    );
    // Balanced and valued in the ledger, in ONE transaction: the ledger's balance check runs at
    // commit and must see the whole entry.
    await dataSource.transaction(async (manager) => {
      for (const [debit, credit] of [
        [100, 0],
        [0, 100],
      ]) {
        const line = await newId(dataSource);
        await manager.query(
          `INSERT INTO journal_entry_lines (id, journal_entry_id, account_id, debit, credit, dimensions)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
          [line, entry, account, debit, credit, JSON.stringify({ [dimension.name]: 'Ventas' })],
        );
        await manager.query(
          `INSERT INTO journal_entry_line_valuations (journal_entry_line_id, ledger_id, debit, credit)
           VALUES ($1, $2, $3, $4)`,
          [line, ledger, debit, credit],
        );
      }
    });

    await expect(
      dimensions.update(dimension.id, { name: 'Otro nombre' } as never, organizationId),
    ).rejects.toMatchObject({ messageKey: 'dimensions.dimension_in_use' });
    await expect(dimensions.remove(dimension.id, organizationId)).rejects.toMatchObject({
      messageKey: 'dimensions.dimension_in_use',
    });
    const ventas = dimension.values.find((value) => value.value === 'Ventas');
    await expect(
      dimensions.update(dimension.id, { values: [{ id: ventas?.id, value: 'Comercial' }] } as never, organizationId),
    ).rejects.toMatchObject({ messageKey: 'dimensions.dimension_value_in_use' });
  });
});

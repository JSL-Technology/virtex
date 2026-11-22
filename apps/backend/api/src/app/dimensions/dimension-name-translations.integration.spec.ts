import { DataSource } from 'typeorm';
import { Dimension } from './entities/dimension.entity';
import { DimensionRule } from './entities/dimension-rule.entity';
import { DimensionsService } from './dimensions.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * A dimension and its values named in several languages. The name a journal line carries is the
 * record — fixed once lines carry it — and how it reads in another language is not: it changes even
 * in use.
 */
describeWithDb('a dimension named in several languages', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let dimensions: DimensionsService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'dimension-names');
    await ds.query(`UPDATE organizations SET books_language = 'es' WHERE id = $1`, [organizationId]);
    dimensions = new DimensionsService(ds.getRepository(Dimension), ds.getRepository(DimensionRule), ds);
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  it('keeps the translations of the dimension and of each value, and edits them as it edits the rest', async () => {
    const created = await dimensions.create(
      {
        name: 'Centro QA',
        nameTranslations: { en: 'QA cost centre' },
        values: [
          { value: 'VENTAS', name: 'Ventas', nameTranslations: { en: 'Sales', pt: 'Vendas' }, isActive: true },
          { value: 'ADM', name: 'Administración', isActive: true },
        ],
      },
      organizationId,
    );
    expect(created.nameTranslations).toEqual({ en: 'QA cost centre' });
    expect(created.values.find((value) => value.value === 'VENTAS')?.nameTranslations).toEqual({ en: 'Sales', pt: 'Vendas' });
    expect(created.values.find((value) => value.value === 'ADM')?.nameTranslations).toEqual({});

    const sales = created.values.find((value) => value.value === 'VENTAS');
    const updated = await dimensions.update(
      created.id,
      {
        nameTranslations: { en: 'QA cost center', pt: 'Centro de custo QA' },
        values: [
          { id: sales?.id, value: 'VENTAS', name: 'Ventas', nameTranslations: { pt: '' }, isActive: true },
          { value: 'ADM', name: 'Administración', nameTranslations: { en: 'Administration' }, isActive: true },
        ],
      },
      organizationId,
    );
    expect(updated.nameTranslations).toEqual({ en: 'QA cost center', pt: 'Centro de custo QA' });
    expect(updated.values.find((value) => value.value === 'VENTAS')?.nameTranslations).toEqual({ en: 'Sales' });
    expect(updated.values.find((value) => value.value === 'ADM')?.nameTranslations).toEqual({ en: 'Administration' });
  });
});

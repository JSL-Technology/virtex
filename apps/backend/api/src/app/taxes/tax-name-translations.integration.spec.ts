import { DataSource } from 'typeorm';
import { Tax, TaxType } from './entities/tax.entity';
import { TaxesService } from './taxes.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/** A tax's name in several languages: the merge that used to keep a language a person cleared. */
describeWithDb('a tax named in several languages', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let taxes: TaxesService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'tax-names');
    await ds.query(`UPDATE organizations SET books_language = 'es' WHERE id = $1`, [organizationId]);
    taxes = new TaxesService(ds.getRepository(Tax));
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  it('removes a translation sent empty, though an update merges the rest of the tax', async () => {
    const tax = await taxes.create(
      { name: 'Exento QA', rate: 0, type: TaxType.PERCENTAGE, nameTranslations: { en: 'QA exempt', pt: 'Isento QA' } },
      organizationId,
    );
    expect(tax.nameTranslations).toEqual({ en: 'QA exempt', pt: 'Isento QA' });

    const updated = await taxes.update(tax.id, { nameTranslations: { en: '' }, rate: 0 }, organizationId);
    expect(updated.nameTranslations).toEqual({ pt: 'Isento QA' });
    const [row] = await ds.query(`SELECT name, name_translations AS translations FROM taxes WHERE id = $1`, [tax.id]);
    expect(row).toEqual({ name: 'Exento QA', translations: { pt: 'Isento QA' } });

    // An update that says nothing of the translations keeps them.
    expect((await taxes.update(tax.id, { name: 'Exento QA (bienes)' }, organizationId)).nameTranslations).toEqual({ pt: 'Isento QA' });
  });
});

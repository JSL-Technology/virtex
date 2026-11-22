import { DataSource } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { JournalsService } from './journals.service';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * A journal's name in the books language and in the others (books bilingual, part 3): the record
 * stays the name; the translations are how a reader in another language reads it.
 */
describeWithDb('a journal named in several languages', () => {
  jest.setTimeout(60_000);

  let ds: DataSource;
  let organizationId: string;
  let journals: JournalsService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'journal-names');
    await ds.query(`UPDATE organizations SET books_language = 'es' WHERE id = $1`, [organizationId]);
    journals = new JournalsService(ds.getRepository(Journal), ds);
  });

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  });

  const stored = async (id: string) =>
    (await ds.query(`SELECT name, name_translations AS translations FROM journals WHERE id = $1`, [id]))[0] as {
      name: string;
      translations: Record<string, string>;
    };

  it('keeps the books name as the name, and only the other languages as translations', async () => {
    const created = await journals.create(
      { code: 'QAVEN', name: 'Diario QA de ventas', type: 'SALES', nameTranslations: { en: ' QA sales journal ', es: 'no es la del libro', pt: '' } },
      organizationId,
    );
    expect(await stored(created.id)).toEqual({ name: 'Diario QA de ventas', translations: { en: 'QA sales journal' } });
  });

  it('changes what is sent, removes what is sent empty, keeps what is not sent', async () => {
    const created = await journals.create(
      { code: 'QACOM', name: 'Diario QA de compras', type: 'PURCHASES', nameTranslations: { en: 'QA purchases', pt: 'Compras QA' } },
      organizationId,
    );
    await journals.update(created.id, { nameTranslations: { en: '' } }, organizationId);
    expect((await stored(created.id)).translations).toEqual({ pt: 'Compras QA' });
    await journals.update(created.id, { name: 'Diario QA de compras locales' }, organizationId);
    expect(await stored(created.id)).toEqual({ name: 'Diario QA de compras locales', translations: { pt: 'Compras QA' } });
  });

  it('is an object of names in the database, never a list or a text', async () => {
    const created = await journals.create({ code: 'QAGEN', name: 'Diario QA', type: 'GENERAL' }, organizationId);
    expect((await stored(created.id)).translations).toEqual({});
    await expect(ds.query(`UPDATE journals SET name_translations = '["QA"]'::jsonb WHERE id = $1`, [created.id])).rejects.toThrow(
      /CHK_journals_name_translations/,
    );
  });
});

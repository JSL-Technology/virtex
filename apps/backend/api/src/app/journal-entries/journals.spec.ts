import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { Journal } from './entities/journal.entity';
import { JournalsService } from './journals.service';

/**
 * Journals can be read, edited and deleted — under the rules history imposes (QA A-13: the edit
 * screen asked `GET /journals/:id` and got 404; there was no way to change a journal at all).
 */
describeWithDb('journals', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let journals: JournalsService;
  let organizationId: string;

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    journals = new JournalsService(dataSource.getRepository(Journal), dataSource);
    organizationId = await createTestOrganization(dataSource, 'Journals');
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  async function postTo(journalId: string): Promise<void> {
    const [ledger] = await dataSource.query(
      `INSERT INTO ledgers (organization_id, name, currency) VALUES ($1, 'Principal', 'DOP') RETURNING id`,
      [organizationId],
    );
    await dataSource.query(
      `INSERT INTO journal_entries (organization_id, ledger_id, journal_id, date, description)
       VALUES ($1, $2, $3, '2026-09-01', 'Prueba')`,
      [organizationId, ledger.id, journalId],
    );
  }

  it('creates with a normalised code and refuses a duplicate', async () => {
    const created = await journals.create({ code: ' obras ', name: 'Obras', type: 'GENERAL' }, organizationId);
    expect(created.code).toBe('OBRAS');
    await expect(
      journals.create({ code: 'Obras', name: 'Otra', type: 'GENERAL' }, organizationId),
    ).rejects.toMatchObject({ messageKey: 'journal_entries.journal_code_taken' });
  });

  it('reads one, and edits everything while nothing was posted to it', async () => {
    const created = await journals.create({ code: 'TMP1', name: 'Temporal', type: 'GENERAL' }, organizationId);
    const read = await journals.findOne(created.id, organizationId);
    expect(read).toEqual(expect.objectContaining({ code: 'TMP1', isSystem: false, entryCount: 0 }));

    const edited = await journals.update(created.id, { code: 'tmp2', name: 'Temporal 2', type: 'CASH' }, organizationId);
    expect(edited).toEqual(expect.objectContaining({ code: 'TMP2', name: 'Temporal 2', type: 'CASH' }));
  });

  it('keeps the code and type of a journal with entries, and refuses to delete it', async () => {
    const used = await journals.create({ code: 'USADO', name: 'Usado', type: 'GENERAL' }, organizationId);
    await postTo(used.id);

    await expect(journals.update(used.id, { code: 'OTRO' }, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.journal_code_fixed_once_used',
    });
    await expect(journals.update(used.id, { type: 'BANK' }, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.journal_type_fixed_once_used',
    });
    // The name is a label; it can always change.
    expect((await journals.update(used.id, { name: 'Usado (renombrado)' }, organizationId)).name).toBe('Usado (renombrado)');

    await expect(journals.remove(used.id, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.journal_in_use',
    });
  });

  it("never renames or deletes a journal the product posts to by code", async () => {
    const system = await journals.create({ code: 'DEPREC', name: 'Depreciación', type: 'GENERAL' }, organizationId);
    await expect(journals.update(system.id, { code: 'DEP2' }, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.journal_system_code_fixed',
    });
    await expect(journals.remove(system.id, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.system_journal_cannot_be_deleted',
    });
  });

  it('deletes an unused journal', async () => {
    const unused = await journals.create({ code: 'BORRAR', name: 'Borrar', type: 'GENERAL' }, organizationId);
    await journals.remove(unused.id, organizationId);
    await expect(journals.findOne(unused.id, organizationId)).rejects.toMatchObject({
      messageKey: 'journal_entries.journal_not_found',
    });
  });
});

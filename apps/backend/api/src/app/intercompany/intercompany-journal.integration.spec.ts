import { DataSource } from 'typeorm';
import { IntercompanyService } from './intercompany.service';
import { Journal } from '../journal-entries/entities/journal.entity';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * An intercompany entry goes into the general journal, not into whichever journal of type GENERAL
 * the database returns first (FINB-40).
 *
 * A company is provisioned with six journals of type GENERAL — payroll, general, depreciation,
 * closing, fixed assets and inflation adjustment — and the lookup asked for the type. The entry
 * was numbered in that journal's sequence: a transfer between companies could sit in the payroll
 * journal. Against the migrated schema, with the journals a provisioned company has.
 */
describeWithDb('the intercompany entry finds its journal by code', () => {
  let ds: DataSource;
  let organizationId: string;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'QA intercompañía');
    // Payroll first, as a company created before the general journal would have it; the rest of the
    // catalogue after it.
    const catalogue = Object.values(SYSTEM_JOURNALS);
    const ordered = [
      ...catalogue.filter((journal) => journal.code === SYSTEM_JOURNALS.payroll.code),
      ...catalogue.filter((journal) => journal.code !== SYSTEM_JOURNALS.payroll.code),
    ];
    for (const journal of ordered) {
      await ds.query(`INSERT INTO journals (organization_id, code, name, type) VALUES ($1, $2, $2, $3)`, [
        organizationId,
        journal.code,
        journal.type,
      ]);
    }
  }, 60_000);

  afterAll(async () => {
    await dropTestOrganization(ds, organizationId);
  }, 120_000);

  it('several journals share the type, so the type does not identify one', async () => {
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM journals WHERE organization_id = $1 AND type = 'GENERAL'`,
      [organizationId],
    );
    expect(n).toBe(6);
    // What the lookup by type returned here: not the general journal.
    const byType = await ds.manager.findOneBy(Journal, { organizationId, type: 'GENERAL' });
    expect(byType?.code).not.toBe(SYSTEM_JOURNALS.general.code);
  });

  it('the intercompany entry is posted to the general journal', async () => {
    const service = new IntercompanyService(ds, {} as never, {} as never, {} as never);
    const journal = await ds.transaction((manager) =>
      (service as unknown as { requireGeneralJournal: (m: unknown, id: string) => Promise<Journal> }).requireGeneralJournal(
        manager,
        organizationId,
      ),
    );
    expect(journal.code).toBe(SYSTEM_JOURNALS.general.code);
  });
});

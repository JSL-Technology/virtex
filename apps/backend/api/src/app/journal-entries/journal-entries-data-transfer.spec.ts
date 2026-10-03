import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { DataTransferRegistry } from '../contracts/data-transfer/data-transfer.registry';
import { ChartOfAccountsDataTransferProvider, accountNameIn } from '../chart-of-accounts/chart-of-accounts-data-transfer.provider';
import { JournalEntryLinesDataTransferProvider } from './journal-entries-data-transfer.provider';

describe('accountNameIn', () => {
  it('reads the books language, then Spanish, then whatever exists', () => {
    expect(accountNameIn({ es: 'Caja', en: 'Cash' }, 'en')).toBe('Cash');
    expect(accountNameIn({ es: 'Caja', en: 'Cash' }, 'pt')).toBe('Caja');
    expect(accountNameIn({ en: 'Cash' }, null)).toBe('Cash');
    expect(accountNameIn('Caja', 'en')).toBe('Caja');
    expect(accountNameIn(null, 'es')).toBe('');
  });
});

/**
 * «Exportar» in the daybook and the chart of accounts (QA A-13): the buttons had no handler. Both
 * now export the whole dataset through the data-transfer registry.
 */
describeWithDb('accounting exports', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;
  let organizationId: string;
  const registry = new DataTransferRegistry();

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'Exports');
    await dataSource.query(`UPDATE organizations SET books_language = 'es' WHERE id = $1`, [organizationId]);

    const [cash] = await dataSource.query(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES ($1, '1101', '{"es":"Caja","en":"Cash"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1, true) RETURNING id`,
      [organizationId],
    );
    const [sales] = await dataSource.query(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, version, "isPostable")
       VALUES ($1, '4101', '{"es":"Ventas"}', 'REVENUE', 'OPERATING_REVENUE', 'CREDIT', 1, true) RETURNING id`,
      [organizationId],
    );
    const [ledger] = await dataSource.query(
      `INSERT INTO ledgers (organization_id, name, currency) VALUES ($1, 'Principal', 'DOP') RETURNING id`,
      [organizationId],
    );
    const [journal] = await dataSource.query(
      `INSERT INTO journals (organization_id, code, name, type) VALUES ($1, 'VENTAS', 'Ventas', 'SALES') RETURNING id`,
      [organizationId],
    );
    const [entry] = await dataSource.query(
      `INSERT INTO journal_entries (organization_id, ledger_id, journal_id, date, description, entry_number, currency_code)
       VALUES ($1, $2, $3, '2026-09-10', 'Venta de contado', 'VENTAS-2026-000001', 'DOP') RETURNING id`,
      [organizationId, ledger.id, journal.id],
    );
    // A line exists in the books only with its valuation in a ledger (a deferred check enforces
    // it at commit), so both are written in one transaction, as the posting service does.
    await dataSource.transaction(async (manager) => {
      const lines: Array<{ id: string }> = await manager.query(
        `INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
         VALUES ($1, $2, 1180, 0, 'Cobro'), ($1, $3, 0, 1180, 'Ingreso') RETURNING id`,
        [entry.id, cash.id, sales.id],
      );
      await manager.query(
        `INSERT INTO journal_entry_line_valuations (journal_entry_line_id, ledger_id, debit, credit)
         VALUES ($1, $3, 1180, 0), ($2, $3, 0, 1180)`,
        [lines[0].id, lines[1].id, ledger.id],
      );
    });
  });

  afterAll(() => dropTestOrganization(dataSource, organizationId));

  it('exports every journal line with its entry, journal and account', async () => {
    const provider = new JournalEntryLinesDataTransferProvider(registry, dataSource);
    const page = await provider.exportPage(organizationId, 100, 0);

    expect(page.total).toBe(2);
    expect(page.rows).toEqual([
      expect.objectContaining({
        date: '2026-09-10', entryNumber: 'VENTAS-2026-000001', journalCode: 'VENTAS',
        accountCode: '1101', accountName: 'Caja', debit: 1180, credit: 0, currencyCode: 'DOP',
      }),
      expect.objectContaining({ accountCode: '4101', accountName: 'Ventas', debit: 0, credit: 1180 }),
    ]);
  });

  it('exports the chart of accounts in the books language', async () => {
    const provider = new ChartOfAccountsDataTransferProvider(registry, dataSource);
    const page = await provider.exportPage(organizationId, 100, 0);

    expect(page.total).toBe(2);
    expect(page.rows.map((row) => [row['code'], row['name'], row['type']])).toEqual([
      ['1101', 'Caja', 'ASSET'],
      ['4101', 'Ventas', 'REVENUE'],
    ]);
  });
});

import { DataSource } from 'typeorm';
import { ComplianceService } from './compliance.service';
import { NcfSequence } from './entities/ncf-sequence.entity';
import { Invoice } from '../invoices/entities/invoice.entity';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The DGII sales returns, generated from the migrated schema (audit 2026-11-07, FAC-CMP-02).
 * The purchases side (606, 609) reads Purchasing's rows through its own provider and is run against
 * the schema in `accounts-payable/purchase-fiscal-records.integration.spec.ts`.
 *
 * `dr-reports.spec.ts` checks the record layout with hand-made documents; nothing ran the queries
 * that choose which documents a return declares — and a renamed column had already made the 607
 * and 608 fail for every tenant (FAC-CMP-01). Here each return reads real rows: issued, voided and
 * draft invoices, one of another month, a credit note, and a withholding a customer made. The
 * assertions are about selection and pairing, which is what only the database can get wrong.
 */
describeWithDb('DGII 607 / 608 against the real schema', () => {
  let ds: DataSource;
  let organizationId: string;
  let service: ComplianceService;
  const CUSTOMER_RNC = '131246753';
  let report: (kind: '607' | '608') => Promise<string[]>;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'dgii-reports');
    await ds.query(`UPDATE organizations SET country = 'DO', tax_id = '130000001' WHERE id = $1`, [organizationId]);
    const org = organizationId;
    const one = async (sql: string, params: unknown[]) => (await ds.query(sql, params))[0].id as string;

    const customer = await one(
      `INSERT INTO customers (organization_id, "companyName", "taxId", country) VALUES ($1, 'QA Cliente Fiscal', $2, 'DO') RETURNING id`,
      [org, CUSTOMER_RNC],
    );
    const invoice = (number: string, ncf: string | null, status: string, type: string, issueDate: string, original: string | null, extra: { voidReason?: string } = {}) =>
      one(
        `INSERT INTO invoices (organization_id, "invoiceNumber", fiscal_number, "customerName", "issueDate", "dueDate", subtotal, tax, total,
                               total_in_base_currency, version, customer_id, status, type, original_invoice_id, customer_tax_id, void_reason, voided_at)
         VALUES ($1, $2, $3, 'QA Cliente Fiscal', $4, $4, 1000, 180, 1180, 1180, 1, $5, $6::invoices_status_enum, $7::invoices_type_enum, $8, $9,
                 $10, CASE WHEN $6::text = 'Void' THEN now() END) RETURNING id`,
        [org, number, ncf, issueDate, customer, status, type, original, CUSTOMER_RNC, extra.voidReason ?? null],
      );
    const issued = await invoice('FAC-1', 'B0100000011', 'Pending', 'INVOICE', '2026-10-05', null);
    await invoice('FAC-2', 'B0100000012', 'Void', 'INVOICE', '2026-10-06', null, { voidReason: 'Error en la digitación' });
    await invoice('FAC-3', null, 'Draft', 'INVOICE', '2026-10-07', null);
    await invoice('FAC-4', 'B0100000099', 'Pending', 'INVOICE', '2026-09-30', null); // another month
    await invoice('NC-1', 'B0400000005', 'Credit Note', 'CREDIT_NOTE', '2026-10-20', issued);

    // The customer withheld 30 % of the ITBIS and 10 % of income tax on FAC-1.
    const account = await one(
      `INSERT INTO accounts (organization_id, code, name, type, category, nature, version)
       VALUES ($1, '1102', '{"es":"Banco"}', 'ASSET', 'CURRENT_ASSET', 'DEBIT', 1) RETURNING id`,
      [org],
    );
    const bank = await one(`INSERT INTO bank_accounts (organization_id, name, currency_code, gl_account_id) VALUES ($1, 'QA Banco', 'DOP', $2) RETURNING id`, [org, account]);
    const payment = await one(
      `INSERT INTO customer_payments (organization_id, customer_id, payment_date, bank_account_id, total_amount) VALUES ($1, $2, '2026-10-25', $3, 1026) RETURNING id`,
      [org, customer, bank],
    );
    await ds.query(
      `INSERT INTO customer_payment_lines (payment_id, invoice_id, amount, tax_withheld, income_tax_withheld) VALUES ($1, $2, 1026, 54, 100)`,
      [payment, issued],
    );

    service = new ComplianceService(
      ds.getRepository(NcfSequence),
      ds.getRepository(Invoice),
      ds.getRepository('Organization'),
      ds.getRepository('FiscalDocumentTypeDefinition'),
      ds,
      {} as never,
      {} as never, // PurchaseFiscalRecordsRegistry: the 606/609 are not run here
    );
    const generators = {
      '607': () => service.generate607Report(org, 2026, 10),
      '608': () => service.generate608Report(org, 2026, 10),
    };
    report = async (kind) => (await generators[kind]()).split('\n');
  });

  afterAll(() => dropTestOrganization(ds, organizationId));

  it('607: issued invoices and notes of the month, the note paired with its invoice, the withholding on its line', async () => {
    const [header, ...rows] = await report('607');
    expect(header).toBe('607|130000001|202610|2');
    const byNcf = new Map(rows.map((row) => [row.split('|')[2], row.split('|')]));
    expect([...byNcf.keys()].sort()).toEqual(['B0100000011', 'B0400000005']);
    // Not the voided one (it belongs to the 608), not the draft, not September's.
    const invoiceRow = byNcf.get('B0100000011')!;
    expect(invoiceRow.slice(0, 2)).toEqual([CUSTOMER_RNC, '1']);
    expect(invoiceRow[5]).toBe('20261005');
    expect(invoiceRow[6]).toBe('20261025'); // withheld on the receipt's date
    expect(invoiceRow.slice(7, 9)).toEqual(['1000.00', '180.00']);
    expect(invoiceRow[9]).toBe('54.00'); // ITBIS withheld
    expect(invoiceRow[11]).toBe('100.00'); // income tax withheld
    expect(byNcf.get('B0400000005')![3]).toBe('B0100000011'); // «NCF modificado»
  });

  it('608: only the voided comprobante of the month, with its annulment code', async () => {
    const [header, ...rows] = await report('608');
    expect(header.startsWith('608|130000001|202610')).toBe(true);
    expect(rows.map((row) => row.split('|')[0])).toEqual(['B0100000012']);
    expect(rows[0].split('|')[1]).toBe('20261006');
  });

  // FAC-CMP-03: a market without these formats is told so, with a 400 that names its country — never
  // a Dominican file, never a 500.
  it('refuses the DGII formats to a company in another country, naming it', async () => {
    const ecuador = await createTestOrganization(ds, 'dgii-ec');
    try {
      await ds.query(`UPDATE organizations SET country = 'EC' WHERE id = $1`, [ecuador]);
      // The country is checked before any data is read, so the purchases registry is never reached.
      for (const generate of [
        () => service.generate606Report(ecuador, 2026, 10),
        () => service.generate607Report(ecuador, 2026, 10),
        () => service.generate608Report(ecuador, 2026, 10),
        () => service.generate609Report(ecuador, 2026, 10),
      ]) {
        await expect(generate()).rejects.toMatchObject({
          messageKey: 'compliance.report_format_dgii_dominican_republic_filing',
          status: 400,
        });
      }
    } finally {
      await ds.query(`DELETE FROM organizations WHERE id = $1`, [ecuador]);
    }
  });
});

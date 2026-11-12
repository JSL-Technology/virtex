import { DataSource } from 'typeorm';
import { ReturnsService } from './returns/returns.service';
import { ReturnDatasetFactory } from './returns/return-dataset';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * FAC-CMP-01 / INV-01 (audit 2026-11-07): the 607 and the 608 answered 500 for EVERY Dominican tenant.
 * The till query named `created_at` and `payment_method`; pos_sales calls them "createdAt" and
 * "paymentMethod". The unit spec of the 607 used test doubles for the till, so nothing ran the SQL.
 * This runs it against the migrated schema, with a paid and a voided ticket.
 */
describeWithDb('607 / 608 include the tills, against the real schema', () => {
  let ds: DataSource;
  let organizationId: string;
  let returns: ReturnsService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'dgii-till');
    await ds.query(`UPDATE organizations SET country = 'DO', tax_id = '131246753' WHERE id = $1`, [organizationId]);
    const sale = (ncf: string, status: string, voidReason: string | null) =>
      ds.query(
        `INSERT INTO pos_sales (organization_id, "terminalId", items, subtotal, tax, total, "paymentMethod", status, "createdAt",
                                payments, amount_tendered, change_due, fiscal_number, fiscal_document_type, void_reason, voided_at)
         VALUES ($1, 'QA-T1', $2, 100, 18, 118, 'cash', $3::pos_sales_status_enum, '2026-10-15T15:00:00Z', $4, 120, 2, $5, 'B02', $6,
                 CASE WHEN $3::text = 'CANCELLED' THEN '2026-10-15T16:00:00Z'::timestamptz END)`,
        [
          organizationId,
          JSON.stringify([{ lineSubtotal: 100, isService: false }]),
          status,
          JSON.stringify([{ method: 'cash', amount: 120 }]),
          ncf,
          voidReason,
        ],
      );
    await sale('B0200000101', 'PAID', null);
    await sale('B0200000102', 'CANCELLED', 'QA error de digitación');

    returns = new ReturnsService(
      // By entity name: the class belongs to another module (verify:boundaries).
      ds.getRepository('Organization'),
      new ReturnDatasetFactory(
        ds,
        {} as never, // AccountBalancesService: a sales return reads no ledger
        {} as never, // PurchaseFiscalRecordsRegistry: nor any purchase
      ),
    );
  });

  afterAll(() => dropTestOrganization(ds, organizationId));

  it('the 607 is generated and declares the paid ticket', async () => {
    const report = (await returns.generate(organizationId, '607', { year: 2026, month: 10 })).body;
    expect(report).toContain('B0200000101');
  });

  it('the 608 is generated and declares the voided ticket', async () => {
    const report = (await returns.generate(organizationId, '608', { year: 2026, month: 10 })).body;
    expect(report).toContain('B0200000102');
    expect(report).not.toContain('B0200000101');
  });
});

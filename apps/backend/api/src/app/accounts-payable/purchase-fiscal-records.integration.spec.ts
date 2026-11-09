import { DataSource } from 'typeorm';
import { VendorBill } from './entities/vendor-bill.entity';
import { VendorDebitNote } from './entities/vendor-debit-note.entity';
import { PurchaseFiscalRecordsProvider } from './purchase-fiscal-records.provider';
import { PurchaseFiscalRecordsRegistry } from '../contracts/fiscal-records/purchase-fiscal-records.registry';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * The rows behind the purchases returns (DGII 606 and 609), read from the migrated schema (audit
 * 2026-11-07, FAC-CMP-02). `purchase-fiscal-records.provider.spec.ts` maps hand-made entities;
 * this runs the provider's queries: which bills and supplier credit notes a month declares, and
 * how a note is paired with the bill it modifies. The record layout is `dr-reports.spec.ts`'s.
 */
describeWithDb('purchases fiscal records against the real schema', () => {
  let ds: DataSource;
  let organizationId: string;
  let provider: PurchaseFiscalRecordsProvider;
  const period = { from: '2026-10-01', to: '2026-10-31' };

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'purchase-records');
    const org = organizationId;
    const one = async (sql: string, params: unknown[]) => (await ds.query(sql, params))[0].id as string;
    const supplier = (name: string, taxId: string | null, country: string | null) =>
      one(`INSERT INTO suppliers (organization_id, name, "taxId", country) VALUES ($1, $2, $3, $4) RETURNING id`, [org, name, taxId, country]);
    const local = await supplier('QA Suplidor Local', '101010632', 'DO');
    const foreign = await supplier('QA Supplier Inc', null, 'US');
    const unknownCountry = await supplier('QA Suplidor Sin País', '130862346', null);
    const bill = (vendor: string, ncf: string | null, status: string, date: string) =>
      one(
        `INSERT INTO vendor_bills (organization_id, vendor_id, ncf, date, "dueDate", total, total_in_base_currency, version, status,
                                   services_amount, goods_amount, tax_amount, purchase_category, payment_form)
         VALUES ($1, $2, $3, $4, $4, 1180, 1180, 1, $5, 0, 1000, 180, '02', '04') RETURNING id`,
        [org, vendor, ncf, date, status],
      );
    const localBill = await bill(local, 'B0100000501', 'OPEN', '2026-10-10');
    await bill(local, 'B0100000502', 'DRAFT', '2026-10-11');
    await bill(local, 'B0100000503', 'VOID', '2026-10-11');
    await bill(local, 'B0100000504', 'OPEN', '2026-09-30');
    await bill(local, null, 'OPEN', '2026-10-13');
    await bill(foreign, null, 'OPEN', '2026-10-12');
    await bill(unknownCountry, 'B0100000505', 'OPEN', '2026-10-14');
    const note = (number: string, ncf: string | null, status: string, date: string) =>
      ds.query(
        `INSERT INTO vendor_debit_note (organization_id, vendor_bill_id, reason, amount, date, status, number, ncf, tax_amount)
         VALUES ($1, $2, 'Devolución parcial', 118, $3, $4, $5, $6, 18)`,
        [org, localBill, date, status, number, ncf],
      );
    await note('ND-2026-000001', 'B0400000077', 'POSTED', '2026-10-28');
    await note('ND-2026-000002', 'B0400000078', 'VOID', '2026-10-29');

    const registry = new PurchaseFiscalRecordsRegistry();
    provider = new PurchaseFiscalRecordsProvider(ds.getRepository(VendorBill), ds.getRepository(VendorDebitNote), registry);
  });

  afterAll(() => dropTestOrganization(ds, organizationId));

  it('606: the issued bills with an NCF of the month, then the posted supplier credit note paired with its bill', async () => {
    const documents = await provider.fiscalDocuments({ organizationId, ...period });
    // Not the draft, not the voided bill, not September's, not the one without an NCF, not the voided note.
    expect(documents.map((d) => [d.kind, d.fiscalNumber])).toEqual([
      ['bill', 'B0100000501'],
      ['bill', 'B0100000505'],
      ['credit_note', 'B0400000077'],
    ]);
    expect(documents[0]).toMatchObject({ supplierTaxId: '101010632', goodsAmount: 1000, taxAmount: 180, purchaseCategory: '02' });
    expect(documents[2]).toMatchObject({ modifiedFiscalNumber: 'B0100000501', supplierTaxId: '101010632', taxAmount: 18, paymentForm: '06' });
  });

  it('609: purchases from a supplier abroad only; a supplier with no country is taken as local', async () => {
    const documents = await provider.foreignPurchases({ organizationId, ...period }, 'DO');
    expect(documents.map((d) => d.supplierName)).toEqual(['QA Supplier Inc']);
    expect(documents[0]).toMatchObject({ supplierCountry: 'US', total: 1180 });
  });
});

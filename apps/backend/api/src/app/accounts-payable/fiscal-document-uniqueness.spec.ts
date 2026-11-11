import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * One supplier per tax id and one live bill per (issuer tax id, fiscal document), enforced by the
 * database (audit 2026-11-07, CMP-03, CMP-04): an import or direct SQL cannot skip the rule the
 * service checks, and a second supplier record with the same tax id no longer lets the same
 * document in twice. The column holds the number of whatever document the supplier's market issues,
 * so the key is wide enough for the longest of them — a 96-character CUFE, a 44-digit NF-e key.
 */
describeWithDb('supplier and fiscal-document uniqueness', () => {
  let ds: DataSource;
  let org: string;
  let supplierId: string;

  const bill = (vendorId: string, document: string, status = 'DRAFT') =>
    ds.query(
      `INSERT INTO vendor_bills (organization_id, vendor_id, date, "dueDate", total, total_in_base_currency, version,
                                 supplier_fiscal_number, status)
       VALUES ($1, $2, '2026-08-01', '2026-08-31', 100, 100, 1, $3, $4) RETURNING id`,
      [org, vendorId, document, status],
    );

  beforeAll(async () => {
    ds = await openTestDataSource();
    org = await createTestOrganization(ds, 'QA-cmp03');
    [{ id: supplierId }] = await ds.query(
      `INSERT INTO suppliers (organization_id, name, "taxId") VALUES ($1, 'QA Proveedor', '131246753') RETURNING id`,
      [org],
    );
  });
  afterAll(async () => dropTestOrganization(ds, org));

  it('refuses a second supplier with the same tax id, however it is typed', async () => {
    await expect(
      ds.query(`INSERT INTO suppliers (organization_id, name, "taxId") VALUES ($1, 'QA Duplicado', '1-3124-6753')`, [org]),
    ).rejects.toThrow(/UQ_suppliers_org_tax_id_key/);
  });

  it('refuses the same document twice from the same issuer, and admits it again once the first is voided', async () => {
    const [{ id: first }] = await bill(supplierId, 'B0100000001');
    await expect(bill(supplierId, 'b01-0000 0001')).rejects.toThrow(/UQ_vendor_bills_issuer_fiscal_number/);
    await ds.query(`UPDATE vendor_bills SET status = 'VOID' WHERE id = $1`, [first]);
    await expect(bill(supplierId, 'B0100000001')).resolves.toHaveLength(1);
  });

  it('keeps the issuer key a bill was recorded with when the supplier record is later corrected', async () => {
    const [{ id }] = await bill(supplierId, 'B0100000077');
    await ds.query(`UPDATE suppliers SET "taxId" = '101010632' WHERE id = $1`, [supplierId]);
    const [row] = await ds.query(`SELECT issuer_tax_key, supplier_fiscal_key FROM vendor_bills WHERE id = $1`, [id]);
    expect(row).toEqual({ issuer_tax_key: '131246753', supplier_fiscal_key: 'B0100000077' });
    await ds.query(`UPDATE suppliers SET "taxId" = '131246753' WHERE id = $1`, [supplierId]);
  });

  it('holds the longest document number any market issues, and keys it', async () => {
    // A Colombian CUFE is 96 hexadecimal characters and a Brazilian NF-e access key 44 digits; the
    // key was `varchar(40)`, so the first purchase recorded in either market failed on insert.
    const cufe = 'a'.repeat(96);
    const [{ id }] = await bill(supplierId, cufe);
    const [row] = await ds.query(`SELECT supplier_fiscal_number, supplier_fiscal_key FROM vendor_bills WHERE id = $1`, [id]);
    expect(row).toEqual({ supplier_fiscal_number: cufe, supplier_fiscal_key: cufe.toUpperCase() });
    await expect(bill(supplierId, cufe)).rejects.toThrow(/UQ_vendor_bills_issuer_fiscal_number/);
  });
});

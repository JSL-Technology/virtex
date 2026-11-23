import { DataSource } from 'typeorm';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  openTestDataSource,
} from '../common/database/testing/integration-db';
import { SupplierBankAccountsService } from './supplier-bank-accounts.service';

/**
 * A supplier's bank accounts (audit 2026-11-07, CMP-17): encrypted at rest, never returned whole,
 * one default per supplier, and reachable only inside the tenant.
 */
describeWithDb('SupplierBankAccountsService', () => {
  let ds: DataSource;
  let org: string;
  let other: string;
  let supplierId: string;
  let service: SupplierBankAccountsService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new SupplierBankAccountsService(ds);
    org = await createTestOrganization(ds, 'QA-cmp17');
    other = await createTestOrganization(ds, 'QA-cmp17-other');
    [{ id: supplierId }] = await ds.query(`INSERT INTO suppliers (organization_id, name) VALUES ($1, 'QA Banco') RETURNING id`, [org]);
  });
  afterAll(async () => {
    await ds.query(`DELETE FROM organizations WHERE id = $1`, [other]);
    await dropTestOrganization(ds, org);
  });

  it('stores the number encrypted, returns only its last four, and keeps one default', async () => {
    const first = await service.create(supplierId, { bankName: 'QA Banco Popular', accountNumber: '7654-321-098' }, org);
    expect(first).toMatchObject({ accountLast4: '1098', isDefault: true });
    expect((first as unknown as Record<string, unknown>)['accountNumber']).toBeUndefined();
    const [raw] = await ds.query(`SELECT account_number FROM supplier_bank_accounts WHERE id = $1`, [first.id]);
    expect(raw.account_number).not.toContain('7654321098');

    const second = await service.create(supplierId, { bankName: 'QA BHD', accountNumber: '111122223333', isDefault: true }, org);
    const listed = await service.list(supplierId, org);
    expect(listed.map((a) => [a.id, a.isDefault])).toEqual([
      [second.id, true],
      [first.id, false],
    ]);
  });

  it("does not reach another tenant's supplier", async () => {
    await expect(service.create(supplierId, { bankName: 'QA', accountNumber: '99998888' }, other)).rejects.toMatchObject({
      messageKey: 'masters.supplier_bank.supplier_not_found',
    });
  });
});

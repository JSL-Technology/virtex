import { DataSource } from 'typeorm';
import { BookkeepingReprovisioningService } from './bookkeeping-reprovisioning.service';
import { TenantBookkeepingProvisioner } from './tenant-bookkeeping.provisioner';
import { createTestOrganization, describeWithDb, dropTestOrganization, openTestDataSource } from '../../common/database/testing/integration-db';

/**
 * Reprovisioning a company runs the provisioner in the currency its books are kept in, and answers
 * what still stops it from invoicing (FIN-AC-06). It lived in the controller; here it is the
 * service's, against the migrated schema.
 */
describeWithDb('reprovisioning a company’s bookkeeping (FIN-AC-06)', () => {
  let ds: DataSource;
  let organizationId: string;
  const provision = jest.fn(async () => undefined);
  const invoicingGaps = jest.fn(async () => ['chart_of_accounts']);
  let service: BookkeepingReprovisioningService;

  beforeAll(async () => {
    ds = await openTestDataSource();
    organizationId = await createTestOrganization(ds, 'reprovision');
    // The provisioner has its own suite; here it records what it was asked to do.
    service = new BookkeepingReprovisioningService(ds, { provision, invoicingGaps } as unknown as TenantBookkeepingProvisioner);
  });

  afterAll(() => dropTestOrganization(ds, organizationId));
  beforeEach(() => provision.mockClear());

  it('uses the currency the books are kept in, and returns what is still missing', async () => {
    await ds.query(`INSERT INTO organization_settings (organization_id, base_currency) VALUES ($1, 'EUR')`, [organizationId]);
    await expect(service.reprovision(organizationId)).resolves.toEqual({ gaps: ['chart_of_accounts'] });
    expect(provision).toHaveBeenCalledWith(expect.objectContaining({ id: organizationId }), 'EUR', expect.anything());
    await ds.query(`DELETE FROM organization_settings WHERE organization_id = $1`, [organizationId]);
  });

  it('a company whose settings were never written takes its market’s currency, as at signup', async () => {
    await ds.query(`UPDATE organizations SET country = 'MX' WHERE id = $1`, [organizationId]);
    await service.reprovision(organizationId);
    expect(provision).toHaveBeenLastCalledWith(expect.anything(), 'MXN', expect.anything());

    // A country the product is not sold in: the documented fallback, not a guess per caller.
    await ds.query(`UPDATE organizations SET country = 'ZZ' WHERE id = $1`, [organizationId]);
    await service.reprovision(organizationId);
    expect(provision).toHaveBeenLastCalledWith(expect.anything(), 'USD', expect.anything());
  });
});

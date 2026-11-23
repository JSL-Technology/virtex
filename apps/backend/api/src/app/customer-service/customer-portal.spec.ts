import { DataSource } from 'typeorm';
import { CustomerPortalAccountsService } from './customer-portal-accounts.service';
import { CustomerPortalController } from './customer-portal.controller';
import {
  createTestOrganization,
  describeWithDb,
  dropTestOrganization,
  newId,
  openTestDataSource,
} from '../common/database/testing/integration-db';

/**
 * CS-01 (audit 2026-10-31): "my-invoices" and "my-cases" answered every document of the tenant to
 * anyone holding `customer_portal:access`. A portal user now reads only the customer their portal
 * account binds them to, and nothing without one.
 */
describeWithDb('customer portal identity', () => {
  let dataSource: DataSource;
  let organizationId: string;
  let otherOrganizationId: string;
  let portalUser: string;
  let outsider: string;
  let customerA: string;
  let customerB: string;
  let foreignCustomer: string;
  let accounts: CustomerPortalAccountsService;
  const ACTOR = '00000000-0000-4000-8000-0000000000aa';

  const user = async (orgId: string | null) => {
    const id = await newId(dataSource);
    await dataSource.query(`INSERT INTO users (id, email, "firstName", "lastName", status) VALUES ($1, $2, 'QA', 'Portal', 'ACTIVE')`, [
      id,
      `qa-portal-${id}@virtex.test`,
    ]);
    if (orgId) await dataSource.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2)`, [id, orgId]);
    return id;
  };
  const customer = async (orgId: string, name: string) => {
    const [row] = await dataSource.query(
      `INSERT INTO customers (organization_id, "companyName", email) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, name, `${name.toLowerCase().replace(/\s/g, '')}@example.com`],
    );
    return row.id as string;
  };

  beforeAll(async () => {
    dataSource = await openTestDataSource();
    organizationId = await createTestOrganization(dataSource, 'portal');
    otherOrganizationId = await createTestOrganization(dataSource, 'portal-other');
    portalUser = await user(organizationId);
    outsider = await user(otherOrganizationId);
    customerA = await customer(organizationId, 'QA Cliente A');
    customerB = await customer(organizationId, 'QA Cliente B');
    foreignCustomer = await customer(otherOrganizationId, 'QA Cliente Ajeno');
    accounts = new CustomerPortalAccountsService(dataSource);
  });

  afterAll(async () => {
    await dataSource.query(`DELETE FROM customer_portal_accounts WHERE organization_id IN ($1, $2)`, [organizationId, otherOrganizationId]);
    await dataSource.query(`DELETE FROM user_organizations WHERE user_id IN ($1, $2)`, [portalUser, outsider]);
    await dataSource.query(`DELETE FROM users WHERE id IN ($1, $2)`, [portalUser, outsider]);
    // `dropTestOrganization` also closes the connection, so the second tenant goes first.
    await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [otherOrganizationId]);
    await dropTestOrganization(dataSource, organizationId);
  });

  it('refuses a portal user who is no customer', async () => {
    await expect(accounts.requireCustomer(organizationId, portalUser)).rejects.toMatchObject({
      messageKey: 'customer_service.portal_no_customer_identity',
    });
  });

  it('binds only a member of the tenant to one of its own customers', async () => {
    await expect(accounts.grant(organizationId, { userId: outsider, customerId: customerA }, ACTOR)).rejects.toBeDefined();
    await expect(accounts.grant(organizationId, { userId: portalUser, customerId: foreignCustomer }, ACTOR)).rejects.toMatchObject({
      messageKey: 'customer_service.portal_customer_not_found',
    });
  });

  it('is one customer at a time, and revoking frees the user', async () => {
    const account = await accounts.grant(organizationId, { userId: portalUser, customerId: customerA }, ACTOR);
    // Granting the same binding again is the same binding.
    expect((await accounts.grant(organizationId, { userId: portalUser, customerId: customerA }, ACTOR)).id).toBe(account.id);
    await expect(accounts.grant(organizationId, { userId: portalUser, customerId: customerB }, ACTOR)).rejects.toMatchObject({
      messageKey: 'customer_service.portal_user_bound_to_other_customer',
    });
    expect(await accounts.requireCustomer(organizationId, portalUser)).toBe(customerA);

    await accounts.revoke(organizationId, account.id, ACTOR);
    await expect(accounts.requireCustomer(organizationId, portalUser)).rejects.toBeDefined();
    const rebound = await accounts.grant(organizationId, { userId: portalUser, customerId: customerB }, ACTOR);
    expect(rebound.customerId).toBe(customerB);
  });

  it("answers only the bound customer's issued invoices and cases", async () => {
    const invoices = { findAll: jest.fn().mockResolvedValue({ items: [], total: 0 }) };
    const cases = { findAll: jest.fn().mockResolvedValue([]) };
    const controller = new CustomerPortalController(cases as never, {} as never, invoices as never, accounts);
    const principal = { id: portalUser, organizationId } as never;

    await controller.getMyInvoices(principal, { page: 2, limit: 10 });
    expect(invoices.findAll).toHaveBeenCalledWith(organizationId, {
      customerId: customerB,
      excludeDrafts: true,
      page: 2,
      limit: 10,
    });
    await controller.getMyCases(principal);
    expect(cases.findAll).toHaveBeenCalledWith(organizationId, { customerId: customerB });

    const stranger = { id: outsider, organizationId } as never;
    await expect(controller.getMyInvoices(stranger, {})).rejects.toBeDefined();
  });
});

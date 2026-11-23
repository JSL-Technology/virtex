import { DataSource } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { OrganizationsService } from './organizations.service';
import { describeWithDb, newId, openTestDataSource } from '../common/database/testing/integration-db';

/**
 * FINB-35 (audit 2026-11-07): a subsidiary could only be created empty, so a company acquired with
 * years of books could not be consolidated. Linking one is now possible — and refused whenever it
 * would let someone move a company they do not administer into their group, or break the tree.
 */
describeWithDb('OrganizationsService.linkSubsidiary', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  let service: OrganizationsService;
  const orgs: string[] = [];
  const users: string[] = [];
  const saas = { enforceLimit: jest.fn(async () => undefined) };
  const membership = {
    grant: jest.fn(async (userId: string, organizationId: string, manager: { query: (q: string, p: unknown[]) => Promise<unknown> }) =>
      manager.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, organizationId]),
    ),
  };

  const organization = async (label: string) => {
    const id = (await ds.getRepository(Organization).save({ legalName: `QA ${label} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}` } as Organization)).id;
    orgs.push(id);
    return id;
  };
  /** A person who is an ADMINISTRATOR (or a plain member) of the given organizations. */
  const person = async (memberships: Array<{ organizationId: string; admin: boolean }>) => {
    const id = await newId(ds);
    await ds.query(`INSERT INTO users (id, email, "firstName", "lastName", status) VALUES ($1, $2, 'QA', 'Link', 'ACTIVE')`, [id, `qa-link-${id}@virtex.test`]);
    users.push(id);
    for (const { organizationId, admin } of memberships) {
      await ds.query(`INSERT INTO user_organizations (user_id, organization_id) VALUES ($1, $2)`, [id, organizationId]);
      const [{ id: roleId }] = await ds.query(
        `INSERT INTO roles (name, permissions, organization_id, is_system_role) VALUES ($1, $2, $3, true) RETURNING id`,
        [admin ? 'ADMINISTRATOR' : 'MEMBER', admin ? '*' : 'invoices:view', organizationId],
      );
      await ds.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`, [id, roleId]);
    }
    return id;
  };

  beforeAll(async () => {
    ds = await openTestDataSource();
    service = new OrganizationsService(
      ds.getRepository(Organization),
      ds.getRepository(OrganizationSubsidiary),
      {} as never,
      saas as never,
      {} as never,
      membership as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await ds.query(`DELETE FROM organization_subsidiaries WHERE parent_organization_id = ANY($1::uuid[]) OR subsidiary_organization_id = ANY($1::uuid[])`, [orgs]);
    await ds.query(`DELETE FROM user_roles WHERE user_id = ANY($1::uuid[])`, [users]);
    await ds.query(`DELETE FROM user_organizations WHERE user_id = ANY($1::uuid[])`, [users]);
    await ds.query(`DELETE FROM roles WHERE organization_id = ANY($1::uuid[])`, [orgs]);
    await ds.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [orgs]);
    await ds.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [users]);
    await ds.destroy();
  });

  it('links a company the person administers, with its acquisition data', async () => {
    const parent = await organization('Matriz');
    const acquired = await organization('Adquirida');
    const admin = await person([{ organizationId: parent, admin: true }, { organizationId: acquired, admin: true }]);
    const link = await service.linkSubsidiary(parent, { organizationId: acquired, ownership: 70, acquisitionDate: '2026-03-31', acquisitionCost: 5000 }, admin);
    expect(link).toMatchObject({ parentOrganizationId: parent, subsidiaryOrganizationId: acquired, ownership: 70 });
    expect(saas.enforceLimit).toHaveBeenCalled();
  });

  it("refuses a company the person only belongs to, or not at all — as not found", async () => {
    const parent = await organization('Matriz');
    const foreign = await organization('Ajena');
    const member = await person([{ organizationId: parent, admin: true }, { organizationId: foreign, admin: false }]);
    await expect(service.linkSubsidiary(parent, { organizationId: foreign, ownership: 100 }, member)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_not_found',
    });
    const stranger = await organization('Desconocida');
    await expect(service.linkSubsidiary(parent, { organizationId: stranger, ownership: 100 }, member)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_not_found',
    });
  });

  it('refuses a cycle and a company another parent controls', async () => {
    const top = await organization('Cabecera');
    const middle = await organization('Intermedia');
    const other = await organization('Otro grupo');
    const admin = await person([top, middle, other].map((organizationId) => ({ organizationId, admin: true })));
    await service.linkSubsidiary(top, { organizationId: middle, ownership: 100 }, admin);

    // `top` owns `middle`: `middle` cannot own `top`.
    await expect(service.linkSubsidiary(middle, { organizationId: top, ownership: 100 }, admin)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_would_create_cycle',
    });
    // `middle` is controlled by `top`: `other` cannot take it too.
    await expect(service.linkSubsidiary(other, { organizationId: middle, ownership: 60 }, admin)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_controlled_by_another_parent',
    });
    await expect(service.linkSubsidiary(top, { organizationId: middle, ownership: 100 }, admin)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_already_linked',
    });
    await expect(service.linkSubsidiary(top, { organizationId: top, ownership: 100 }, admin)).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_cannot_be_itself',
    });
  });
});

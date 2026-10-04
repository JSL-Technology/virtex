import { DataSource } from 'typeorm';
import { Organization } from './entities/organization.entity';
import { OrganizationSubsidiary } from './entities/organization-subsidiary.entity';
import { OrganizationsService } from './organizations.service';

/**
 * A subsidiary's acquisition date, cost, investment account and end of control could not be set
 * after creation, so consolidation always warned that pre-acquisition equity could not be
 * separated. They can now, with the rules consolidation relies on.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('OrganizationsService.updateSubsidiary', () => {
  jest.setTimeout(60_000);
  let ds: DataSource;
  let service: OrganizationsService;
  let parentId: string;
  let childId: string;

  beforeAll(async () => {
    ds = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await ds.initialize();
    service = new OrganizationsService(
      ds.getRepository(Organization),
      ds.getRepository(OrganizationSubsidiary),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    parentId = (await ds.getRepository(Organization).save({ legalName: `Matriz ${stamp}` } as Organization)).id;
    childId = (await ds.getRepository(Organization).save({ legalName: `Filial ${stamp}` } as Organization)).id;
    await ds.getRepository(OrganizationSubsidiary).save({
      parentOrganizationId: parentId,
      subsidiaryOrganizationId: childId,
      ownership: 100,
    });
  });

  afterEach(async () => {
    await ds.getRepository(Organization).delete([parentId, childId]);
  });

  const account = async (organizationId: string, isPostable: boolean): Promise<string> => {
    const [row] = await ds.query(
      `INSERT INTO "accounts" ("organization_id", "code", "name", "type", "category", "nature", "isPostable", "isActive", "version")
       VALUES ($1, $2, '{"es":"Inversión"}', 'ASSET', 'NON_CURRENT_ASSET', 'DEBIT', $3, true, 1) RETURNING "id"`,
      [organizationId, `17${Math.floor(Math.random() * 1e6)}`, isPostable],
    );
    return row.id;
  };

  it('records ownership, acquisition and the parent\'s investment account', async () => {
    const investment = await account(parentId, true);

    const saved = await service.updateSubsidiary(parentId, childId, {
      ownership: 60,
      acquisitionDate: '2025-03-31',
      acquisitionCost: 1_250_000,
      investmentAccountId: investment,
    });

    expect(saved).toMatchObject({ ownership: 60, acquisitionDate: '2025-03-31', acquisitionCost: 1_250_000, investmentAccountId: investment });
  });

  it('refuses an investment account from the subsidiary\'s own books', async () => {
    const wrongBooks = await account(childId, true);
    await expect(
      service.updateSubsidiary(parentId, childId, { investmentAccountId: wrongBooks }),
    ).rejects.toMatchObject({ messageKey: 'organizations.subsidiary_investment_account_not_parent' });
  });

  it('refuses control ending before it began, and a company that is not a subsidiary', async () => {
    await expect(
      service.updateSubsidiary(parentId, childId, { acquisitionDate: '2025-06-01', controlEndedOn: '2025-01-01' }),
    ).rejects.toMatchObject({ messageKey: 'organizations.subsidiary_control_ends_before_acquisition' });
    await expect(service.updateSubsidiary(childId, parentId, { ownership: 10 })).rejects.toMatchObject({
      messageKey: 'organizations.subsidiary_not_found',
    });
  });
});

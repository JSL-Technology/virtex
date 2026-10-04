import { DataSource } from 'typeorm';
import { Organization } from '../entities/organization.entity';
import { OrganizationSubsidiary } from '../entities/organization-subsidiary.entity';
import { inSameCorporateGroup } from './corporate-group.contract';

/**
 * Intercompany authorised itself against a table nothing wrote, so a subsidiary created from
 * «Estructura empresarial» could never receive an intercompany transaction. The group is now read
 * from the same relationship the interface writes and consolidation reads.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('inSameCorporateGroup', () => {
  jest.setTimeout(60_000);
  let dataSource: DataSource;
  const created: string[] = [];

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (created.length) await dataSource.getRepository(Organization).delete(created);
    await dataSource?.destroy();
  });

  const company = async (name: string): Promise<string> => {
    const saved = await dataSource.getRepository(Organization).save(
      dataSource.getRepository(Organization).create({
        legalName: `${name} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timezone: 'America/Santo_Domingo',
      }),
    );
    created.push(saved.id);
    return saved.id;
  };

  const link = (parent: string, subsidiary: string, controlEndedOn: string | null = null) =>
    dataSource.getRepository(OrganizationSubsidiary).save({
      parentOrganizationId: parent,
      subsidiaryOrganizationId: subsidiary,
      ownership: 80,
      controlEndedOn,
    });

  it('treats a parent and its subsidiary as one group, in either direction', async () => {
    const parent = await company('Matriz');
    const child = await company('Filial');
    await link(parent, child);

    await expect(inSameCorporateGroup(dataSource.manager, parent, child)).resolves.toBe(true);
    await expect(inSameCorporateGroup(dataSource.manager, child, parent)).resolves.toBe(true);
  });

  it('treats two subsidiaries of one parent as one group', async () => {
    const parent = await company('Matriz');
    const a = await company('Filial A');
    const b = await company('Filial B');
    await link(parent, a);
    await link(parent, b);

    await expect(inSameCorporateGroup(dataSource.manager, a, b)).resolves.toBe(true);
  });

  it('refuses unrelated companies and a company paired with itself', async () => {
    const a = await company('Ajena A');
    const b = await company('Ajena B');

    await expect(inSameCorporateGroup(dataSource.manager, a, b)).resolves.toBe(false);
    await expect(inSameCorporateGroup(dataSource.manager, a, a)).resolves.toBe(false);
  });

  it('no longer counts a company whose control has ended', async () => {
    const parent = await company('Matriz');
    const sold = await company('Vendida');
    const kept = await company('Conservada');
    await link(parent, sold, '2020-01-01');
    await link(parent, kept);

    await expect(inSameCorporateGroup(dataSource.manager, parent, sold)).resolves.toBe(false);
    await expect(inSameCorporateGroup(dataSource.manager, sold, kept)).resolves.toBe(false);
    await expect(inSameCorporateGroup(dataSource.manager, parent, kept)).resolves.toBe(true);
  });
});

import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { DuplicateRecord, DuplicateSourceRegistry } from '../../contracts/data-quality/duplicate-sources.contract';
import { AiDuplicateSuggestion } from '../entities/ai-duplicate-suggestion.entity';
import { DataQualityService } from './data-quality.service';

/**
 * The duplicate scan against a real table: pairs are proposed once, a decision survives the next
 * scan, a pair that disappears goes stale, and nobody sees a record type they may not read.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('data quality', () => {
  jest.setTimeout(60_000);
  let dataSource: DataSource;
  let organizationId: string;
  let customers: DuplicateRecord[];
  let service: DataQualityService;

  const ids = [randomUUID(), randomUUID(), randomUUID()].sort();
  const admin = { id: randomUUID(), permissions: ['customers:view', 'customers:edit'] };
  const clerk = { id: randomUUID(), permissions: ['customers:view'] };
  const buyer = { id: randomUUID(), permissions: ['suppliers:view'] };

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

  afterAll(async () => dataSource?.destroy());

  beforeEach(async () => {
    const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const [org]: Array<{ id: string }> = await dataSource.query(
      `INSERT INTO "organizations" ("legal_name", "slug") VALUES ($1, $2) RETURNING "id"`,
      [`DQ ${tag}`, `dq-${tag}`],
    );
    organizationId = org.id;
    customers = [
      { id: ids[0], name: 'Distribuidora Peña, S.R.L.', email: 'compras@pena.do' },
      { id: ids[1], name: 'DISTRIBUIDORA PENA SRL', email: 'compras@pena.do' },
      { id: ids[2], name: 'Ferretería Ochoa' },
    ];
    const registry = new DuplicateSourceRegistry();
    registry.register({
      type: 'CUSTOMER',
      viewPermission: 'customers:view',
      editPermission: 'customers:edit',
      records: async (_org, offset, limit) => customers.slice(offset, offset + limit),
      link: (id) => `/contacts/customers/${id}/edit`,
    });
    service = new DataQualityService(registry, dataSource.getRepository(AiDuplicateSuggestion));
  });

  it('proposes a pair once, and keeps a decision across scans', async () => {
    expect(await service.scan(organizationId)).toEqual({ CUSTOMER: { found: 1, added: 1, stale: 0 } });
    const { items } = await service.list(organizationId, admin, {});
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ recordAId: ids[0], recordBId: ids[1], linkA: `/contacts/customers/${ids[0]}/edit` });

    await service.decide(organizationId, admin, items[0].id, 'NOT_DUPLICATE');
    expect(await service.scan(organizationId)).toEqual({ CUSTOMER: { found: 1, added: 0, stale: 0 } });
    expect((await service.list(organizationId, admin, {})).items).toHaveLength(0);
    expect((await service.list(organizationId, admin, { status: 'NOT_DUPLICATE' })).items[0].decidedByUserId).toBe(admin.id);
  });

  it('lets a pair that is no longer found go stale', async () => {
    await service.scan(organizationId);
    customers[1] = { ...customers[1], name: 'Tienda Azul', email: null };
    expect(await service.scan(organizationId)).toEqual({ CUSTOMER: { found: 0, added: 0, stale: 1 } });
    expect((await service.list(organizationId, admin, { status: 'STALE' })).total).toBe(1);
  });

  it('shows a type only to who may read it, and lets only an editor decide', async () => {
    await service.scan(organizationId);
    expect((await service.list(organizationId, buyer, {})).items).toHaveLength(0);
    const [item] = (await service.list(organizationId, clerk, {})).items;
    await expect(service.decide(organizationId, clerk, item.id, 'SAME')).rejects.toMatchObject({ messageKey: 'ai.data_quality.cannot_decide' });
  });
});

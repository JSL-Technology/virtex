import { DataSource } from 'typeorm';

/**
 * Foreign keys between tenant tables cannot cross tenants (migration SameTenantReferences).
 *
 * Two things are pinned against a real, migrated Postgres:
 *  1. Every eligible foreign key carries the guard. A migration that adds a foreign key between two
 *     tenant tables and forgets to call `virtex_install_same_tenant_guards()` fails here, in CI,
 *     instead of shipping a reference that can point at another company.
 *  2. The guard actually refuses a cross-tenant reference, and accepts a same-tenant one.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('same-tenant references', () => {
  jest.setTimeout(120_000);
  let ds: DataSource;

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
    });
    await ds.initialize();
  });

  afterAll(async () => {
    await ds?.destroy();
  });

  it('guards every single-column foreign key between two tenant tables', async () => {
    const unguarded: Array<{ conname: string; src: string; col: string }> = await ds.query(`
      SELECT c.conname, src.relname AS src, a.attname AS col
      FROM pg_constraint c
      JOIN pg_class src ON src.oid = c.conrelid
      JOIN pg_class dst ON dst.oid = c.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f'
        AND array_length(c.conkey, 1) = 1
        AND dst.relname NOT IN ('organizations', 'users')
        AND a.attname <> 'organization_id'
        AND EXISTS (SELECT 1 FROM pg_attribute x WHERE x.attrelid = c.conrelid  AND x.attname = 'organization_id' AND NOT x.attisdropped)
        AND EXISTS (SELECT 1 FROM pg_attribute y WHERE y.attrelid = c.confrelid AND y.attname = 'organization_id' AND NOT y.attisdropped)
        AND NOT EXISTS (
          SELECT 1 FROM pg_trigger t
          WHERE t.tgrelid = c.conrelid AND t.tgname = 'tg_same_tenant_' || substr(md5(c.conname), 1, 24)
        )
    `);
    expect(unguarded).toEqual([]);
  });

  it('refuses a cross-tenant reference at commit and accepts a same-tenant one', async () => {
    const stamp = Date.now();
    const [{ id: orgA }] = await ds.query(
      `INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id`,
      [`QA-STR-A ${stamp}`, `qa-str-a-${stamp}`],
    );
    const [{ id: orgB }] = await ds.query(
      `INSERT INTO organizations (legal_name, slug) VALUES ($1, $2) RETURNING id`,
      [`QA-STR-B ${stamp}`, `qa-str-b-${stamp}`],
    );
    const [{ id: groupB }] = await ds.query(
      `INSERT INTO customer_groups (organization_id, name) VALUES ($1, 'QA grupo B ' || $2) RETURNING id`,
      [orgB, String(stamp)],
    );
    const [{ id: groupA }] = await ds.query(
      `INSERT INTO customer_groups (organization_id, name) VALUES ($1, 'QA grupo A ' || $2) RETURNING id`,
      [orgA, String(stamp)],
    );

    const crossTenant = ds.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO customers ("companyName", organization_id, customer_group_id) VALUES ('QA cruzado', $1, $2)`,
        [orgA, groupB],
      );
    });
    await expect(crossTenant).rejects.toMatchObject({ driverError: expect.objectContaining({ code: '23503' }) });

    await ds.transaction(async (manager) => {
      await manager.query(
        `INSERT INTO customers ("companyName", organization_id, customer_group_id) VALUES ('QA propio', $1, $2)`,
        [orgA, groupA],
      );
    });
    const [{ n }] = await ds.query(
      `SELECT COUNT(*)::int AS n FROM customers WHERE organization_id = $1`,
      [orgA],
    );
    expect(n).toBe(1);
  });
});

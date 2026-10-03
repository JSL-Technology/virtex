import { DataSource } from 'typeorm';

/**
 * What every database-backed suite needs, in one place.
 *
 * Each integration spec used to inline the same DataSource options, the same `DB_AVAILABLE` guard
 * and the same tenant insert. A domain's lifecycle tests now live next to the domain — so the
 * module-boundary check sees each spec reach only its own module — and share this instead.
 */
export const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);

/** `describe` when a database is configured, `describe.skip` otherwise (see jest.global-setup). */
export const describeWithDb: jest.Describe = DB_AVAILABLE ? describe : describe.skip;

/** A connection to the migrated test database, with every entity of the application loaded. */
export async function openTestDataSource(): Promise<DataSource> {
  const dataSource = new DataSource({
    type: 'postgres',
    host: process.env['DB_HOST'],
    port: Number(process.env['DB_PORT'] ?? 5432),
    username: process.env['DB_USERNAME'],
    password: process.env['DB_PASSWORD'] || undefined,
    database: process.env['DB_NAME'],
    synchronize: false,
    logging: false,
    entities: [`${__dirname}/../../../**/*.entity.{js,ts}`],
  });
  return dataSource.initialize();
}

export async function newId(dataSource: DataSource): Promise<string> {
  return (await dataSource.query<{ id: string }[]>(`SELECT gen_random_uuid() AS id`))[0].id;
}

/** A fresh tenant; delete it in `afterAll` with {@link dropTestOrganization}. */
export async function createTestOrganization(dataSource: DataSource, label: string): Promise<string> {
  const id = await newId(dataSource);
  await dataSource.query(
    `INSERT INTO organizations (id, legal_name, timezone) VALUES ($1, $2, 'America/Santo_Domingo')`,
    [id, `${label} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`],
  );
  return id;
}

/** Removes the tenant and, by cascade, everything the suite created for it. */
export async function dropTestOrganization(dataSource: DataSource | undefined, id: string | undefined): Promise<void> {
  if (!dataSource?.isInitialized) return;
  if (id) await dataSource.query(`DELETE FROM organizations WHERE id = $1`, [id]);
  await dataSource.destroy();
}

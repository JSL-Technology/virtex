import 'dotenv/config';
import * as fs from 'fs';
import { DataSource, DataSourceOptions } from 'typeorm';

/**
 * Standalone DataSource used by the TypeORM CLI (migration:run / :generate / :revert).
 *
 * Two invariants keep it honest against the runtime configuration in `app.module.ts`:
 *
 *  1. It must see EVERY entity the running application registers. The API loads entities with
 *     `autoLoadEntities`, which picks up entities contributed by libraries under `libs/` as well
 *     as those under `apps/backend/api/src/app`. A CLI data source that only globbed the app
 *     directory silently omitted a library entity, and a generated migration would then have
 *     dropped the table it did not know about. The glob still covers `libs/` for that reason.
 *
 *  2. TLS is validated the same way. This file previously hardcoded
 *     `rejectUnauthorized: false`, which disabled certificate validation for every migration run
 *     — including the ones executed against production during a deploy — while the application
 *     itself validated correctly. Migrations carry the same credentials as the app; they get the
 *     same protection.
 */

const bool = (value: string | undefined, fallback = false): boolean =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const sslConfig = (): DataSourceOptions['ssl'] => {
  if (!bool(process.env['DB_SSL'])) return false;

  const ca = process.env['DB_SSL_CA'];
  return {
    rejectUnauthorized: bool(process.env['DB_SSL_REJECT_UNAUTHORIZED'], true),
    ...(ca ? { ca: fs.readFileSync(ca).toString() } : {}),
  };
};

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env['DB_HOST'] || 'localhost',
  port: parseInt(process.env['DB_PORT'] || '5432', 10),
  username: process.env['DB_USERNAME'] || 'postgres',
  password: process.env['DB_PASSWORD'] || 'postgres',
  database: process.env['DB_NAME'] || 'virteex',
  // Never true for the CLI: schema changes go through reviewed migrations, and a stray
  // `synchronize` run against a real database rewrites it without a diff anyone approved.
  synchronize: false,
  logging: bool(process.env['DB_LOGGING']),
  entities: [
    __dirname + '/../**/*.entity.{js,ts}',
    __dirname + '/../../../../../../libs/**/*.entity.{js,ts}',
  ],
  migrations: [__dirname + '/migrations/*.{js,ts}'],
  ssl: sslConfig(),
} as DataSourceOptions);

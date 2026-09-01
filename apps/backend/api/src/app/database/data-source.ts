import 'dotenv/config';
import * as fs from 'fs';
import { DataSource, DataSourceOptions } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

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

const sslConfig = (): PostgresConnectionOptions['ssl'] => {
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
  // Must match `env.validation.ts`'s development default. It said `virteex` while the API said
  // `erp`, so following the README exactly — create `erp`, then `npm run migration:run` — ran the
  // migrations against a database that does not exist, and the API then aborted on a schema that
  // was never created. That is the very failure the README's troubleshooting section describes.
  database: process.env['DB_NAME'] || 'erp',
  // Never true for the CLI: schema changes go through reviewed migrations, and a stray
  // `synchronize` run against a real database rewrites it without a diff anyone approved.
  synchronize: false,
  logging: bool(process.env['DB_LOGGING']),
  entities: [
    __dirname + '/../**/*.entity.{js,ts}',
    __dirname + '/../../../../../../libs/**/*.entity.{js,ts}',
  ],
  migrations: [__dirname + '/migrations/*.{js,ts}'],
  // One transaction PER migration, not one for the whole run (TypeORM's default is `'all'`).
  //
  // PostgreSQL refuses to use an enum value inside the transaction that added it —
  // `unsafe use of new value ...: New enum values must be committed before they can be used`. With
  // a single run-wide transaction, `InvoicingEnumValues1788490000000` adding `'QUOTE'` and
  // `InvoicingOverhaul1788500000000` inserting a quote sequence are the same transaction, and the
  // run aborts. Per-migration transactions also mean a failure leaves the migrations that already
  // succeeded recorded, instead of silently rolling back a run that reported partial progress.
  migrationsTransactionMode: 'each',
  ssl: sslConfig(),
} as DataSourceOptions);

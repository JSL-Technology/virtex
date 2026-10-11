#!/usr/bin/env node
/**
 * Brings the `migrations` table in line with migrations that were renamed after shipping.
 *
 * TypeORM decides what is pending by comparing the `name` column against the migration classes
 * it finds. Renaming a migration that a database already applied therefore makes it look pending,
 * and `migration:run` would execute it a second time. This script runs before every
 * `migration:run` and rewrites the recorded identity of each rename listed in
 * `migration-renames.json`.
 *
 * It is idempotent and safe on every kind of database:
 *   - empty database (no `migrations` table yet): nothing to do;
 *   - database that never applied the old migration: nothing to do, the new one runs normally;
 *   - database that applied the old one: its row is rewritten in a single transaction;
 *   - database that already has the new row: nothing to do.
 *
 * It reads the same connection settings as `apps/backend/api/src/app/database/data-source.ts`.
 */
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const { renames } = JSON.parse(readFileSync(join(here, 'migration-renames.json'), 'utf8'));

const bool = (value, fallback = false) =>
  value === undefined ? fallback : value.toLowerCase() === 'true';

const ssl = bool(process.env.DB_SSL)
  ? {
      rejectUnauthorized: bool(process.env.DB_SSL_REJECT_UNAUTHORIZED, true),
      ...(process.env.DB_SSL_CA ? { ca: readFileSync(process.env.DB_SSL_CA).toString() } : {}),
    }
  : false;

const client = new pg.Client({
  host: process.env.DB_HOST || 'localhost',
  port: Number.parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_MIGRATION_USERNAME || process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_MIGRATION_PASSWORD || process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'erp',
  ssl,
});

async function main() {
  await client.connect();
  try {
    const { rows } = await client.query(`SELECT to_regclass('public.migrations') IS NOT NULL AS present`);
    if (!rows[0].present) {
      console.log('reconcile-migration-renames: no migrations table yet, nothing to reconcile.');
      return;
    }

    await client.query('BEGIN');
    let rewritten = 0;
    for (const { from, to } of renames) {
      const already = await client.query('SELECT 1 FROM migrations WHERE name = $1', [to.name]);
      if (already.rowCount > 0) continue;
      const result = await client.query(
        'UPDATE migrations SET name = $1, timestamp = $2 WHERE name = $3',
        [to.name, to.timestamp, from.name],
      );
      if (result.rowCount > 0) {
        rewritten += result.rowCount;
        console.log(`reconcile-migration-renames: ${from.name} -> ${to.name}`);
      }
    }
    await client.query('COMMIT');
    console.log(`reconcile-migration-renames: ${rewritten} row(s) rewritten.`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('reconcile-migration-renames failed:', error.message);
  process.exit(1);
});

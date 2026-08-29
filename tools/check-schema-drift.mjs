#!/usr/bin/env node
/**
 * Prove that the migrations and the entity definitions describe the same schema.
 *
 * The failure this guards against is silent and expensive: an entity gains a column, nobody
 * writes the migration, and the code works locally (where `synchronize` once ran) while every
 * real environment is missing the column. Running it in CI turns "the migrations are up to date"
 * from an assumption into a checked fact.
 *
 * How it works: provision a scratch database purely from `migration:run`, then ask TypeORM to
 * generate a migration against it. A correct repository produces nothing to generate — TypeORM
 * exits non-zero with "No changes in database schema were found".
 *
 * Requires a reachable Postgres; the connection comes from the usual DB_* variables. The scratch
 * database is named after DB_NAME with a `_drift` suffix and is dropped afterwards.
 *
 *   node tools/check-schema-drift.mjs
 */

import { execFileSync, execSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Database objects that TypeORM cannot express in entity metadata and will therefore always
 * report as drift. Each entry must name the object and say why it is unavoidable — an
 * unexplained entry here is how a real drift gets waved through.
 */
const UNMODELLED_OBJECTS = [
  {
    match: /idx_analytical_data_org_ledger_date|idx_analytical_data_account/,
    reason:
      'Indexes on the analytical_report_data materialized view. TypeORM ViewEntity has no @Index ' +
      'equivalent, so these can only be created by migration and will always read as drift. They ' +
      'are load-bearing for analytical reporting and must not be dropped.',
  },
];

const env = { ...process.env };
const baseName = env.DB_NAME || 'virteex';
const driftDb = `${baseName}_drift`;

const psql = (sql, db = 'postgres') =>
  execFileSync(
    'psql',
    ['-h', env.DB_HOST || 'localhost', '-p', env.DB_PORT || '5432', '-U', env.DB_USERNAME || 'postgres', '-d', db, '-v', 'ON_ERROR_STOP=1', '-c', sql],
    { env: { ...env, PGPASSWORD: env.DB_PASSWORD ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString();

let scratchDir;
try {
  psql(`DROP DATABASE IF EXISTS "${driftDb}"`);
  psql(`CREATE DATABASE "${driftDb}"`);

  const runEnv = { ...env, DB_NAME: driftDb };

  console.log(`check-schema-drift: provisioning ${driftDb} from migrations…`);
  execSync('npm run migration:run', { env: runEnv, stdio: 'inherit' });

  scratchDir = mkdtempSync(join(tmpdir(), 'schema-drift-'));
  console.log('check-schema-drift: diffing entities against the migrated schema…');

  let generated = false;
  try {
    execSync(`npm run typeorm -- migration:generate ${join(scratchDir, 'Drift')}`, {
      env: runEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    generated = true;
  } catch {
    // Non-zero exit is the success case: TypeORM found nothing to generate.
  }

  if (!generated) {
    console.log('\n  ✓ No schema drift: migrations and entities agree.\n');
    process.exit(0);
  }

  const file = readdirSync(scratchDir).find((f) => f.endsWith('-Drift.ts'));
  const body = file ? execSync(`cat ${join(scratchDir, file)}`).toString() : '';
  // Only the up() body matters: down() is the inverse of the same statements, and matching on
  // text alone would attribute a down() statement to up() whenever the two happen to be equal.
  const downAt = body.indexOf('public async down');
  const upBody = downAt === -1 ? body : body.slice(0, downAt);
  const upStatements = [...upBody.matchAll(/queryRunner\.query\(`([^`]+)`/g)].map((m) => m[1].trim());

  const unexplained = upStatements.filter(
    (s) => !UNMODELLED_OBJECTS.some((allowed) => allowed.match.test(s)),
  );

  if (unexplained.length === 0) {
    console.log('\n  ✓ No schema drift beyond the documented unmodellable objects.\n');
    for (const allowed of UNMODELLED_OBJECTS) console.log(`    · ${allowed.reason}`);
    console.log();
    process.exit(0);
  }

  console.error('\n  ✗ Schema drift detected. The entities and the migrations disagree:\n');
  unexplained.forEach((s) => console.error(`    ${s}`));
  console.error(
    '\n  Write a migration for these changes (npm run typeorm -- migration:generate ' +
      'apps/backend/api/src/app/database/migrations/<Name>) and commit it.\n',
  );
  process.exit(1);
} finally {
  if (scratchDir) rmSync(scratchDir, { recursive: true, force: true });
  try {
    psql(`DROP DATABASE IF EXISTS "${driftDb}"`);
  } catch {
    /* best effort */
  }
}

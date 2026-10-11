#!/usr/bin/env node
/**
 * Every migration has a unique, self-consistent identity.
 *
 * TypeORM orders migrations by the timestamp in the class name and, between equal timestamps, by
 * an order that depends on how the files were globbed. Two migrations sharing a timestamp therefore
 * run in different orders on different machines. This check fails CI when:
 *   - two migration files share a timestamp;
 *   - a file's timestamp does not match the timestamp at the end of its class name;
 *   - the `name` property does not equal `<ClassName>`;
 *   - a rename listed in tools/db/migration-renames.json points at a file that does not exist.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dir = join(root, 'apps/backend/api/src/app/database/migrations');
const files = readdirSync(dir).filter((f) => /\.ts$/.test(f) && !f.endsWith('.spec.ts'));

const problems = [];
const byTimestamp = new Map();
const classNames = new Set();

for (const file of files) {
  const match = /^(\d{13})-([A-Za-z0-9]+)\.ts$/.exec(file);
  if (!match) {
    problems.push(`${file}: file name must be <13-digit timestamp>-<Name>.ts`);
    continue;
  }
  const [, timestamp] = match;
  byTimestamp.set(timestamp, [...(byTimestamp.get(timestamp) ?? []), file]);

  const source = readFileSync(join(dir, file), 'utf8');
  const cls = /export class (\w+?)(\d{13}) implements MigrationInterface/.exec(source);
  if (!cls) {
    problems.push(`${file}: no "export class <Name><timestamp> implements MigrationInterface"`);
    continue;
  }
  const className = `${cls[1]}${cls[2]}`;
  classNames.add(className);
  if (cls[2] !== timestamp) {
    problems.push(`${file}: class ${className} carries timestamp ${cls[2]}, file name says ${timestamp}`);
  }
  const name = /\bname\s*=\s*'([^']+)'/.exec(source);
  if (name && name[1] !== className) {
    problems.push(`${file}: name = '${name[1]}' must equal the class name '${className}'`);
  }
}

for (const [timestamp, group] of byTimestamp) {
  if (group.length > 1) problems.push(`timestamp ${timestamp} is shared by: ${group.join(', ')}`);
}

const { renames } = JSON.parse(readFileSync(join(root, 'tools/db/migration-renames.json'), 'utf8'));
for (const { to } of renames) {
  if (!classNames.has(to.name)) problems.push(`migration-renames.json: target ${to.name} has no migration file`);
}

if (problems.length) {
  console.error(`Migration identity check failed (${problems.length}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Migration identities OK: ${files.length} migrations, all timestamps unique.`);

#!/usr/bin/env node
/**
 * Every environment variable the application reads is declared in one schema.
 *
 * `config/env.validation.ts` is meant to be the complete description of what a deployment can set:
 * the name, the shape, the default, and whether a value is refused outside development. Fourteen
 * variables were being read straight from `process.env` in the services that use them, so the
 * schema did not know they existed. The consequences were all of the same kind — a thing that is
 * true of a deployment but written down nowhere:
 *
 *  - a misspelt name (`SONAR_HOST_UR`) was silent, and the feature behind it simply did not work;
 *  - the defaults lived in four different files instead of in the schema, so «what happens if I
 *    leave this unset» could only be answered by reading the code;
 *  - two of them decide whether an extension's code is scanned before it is admitted and whether
 *    it is signed with a key that survives a restart, with no production guard of any kind.
 *
 * So: a literal `process.env['NAME']` or `process.env.NAME` anywhere in the application must name a
 * key the schema declares. A dynamic read — `process.env[plan.monthlyPriceIdVar]` — cannot be
 * checked by name and is left alone; the variables it reaches are declared as a family.
 *
 * `env.validation.ts` itself, the config factories (`*.config.ts`), the TypeORM CLI data source,
 * the bootstrap, the test helpers and the evaluation harnesses run before or outside the container
 * and are exempt.
 *
 *     npm run verify:env-schema
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');
const APP = join(ROOT, 'apps/backend/api/src');
const SCHEMA = join(APP, 'app/config/env.validation.ts');

/** Runs before or outside the DI container, or is the schema itself. */
const EXEMPT = [
  /\/config\/env\.validation\.ts$/,
  /\.config\.ts$/,
  /\/database\/data-source\.ts$/,
  /\/database\/migrations\//,
  /\/main\.ts$/,
  /\.spec\.ts$/,
  /\.eval\.ts$/,
  /\.testing\.ts$/,
  /\/testing\//,
];

/** `NAME: Joi.…` at the top level of the schema object. */
function declaredKeys(source) {
  const keys = new Set();
  for (const match of source.matchAll(/^\s{2}([A-Z][A-Z0-9_]*)\s*:/gm)) keys.add(match[1]);
  // `CRYPTOGRAPHIC_SECRETS` and the other exported lists name variables the schema builds in bulk.
  for (const match of source.matchAll(/'([A-Z][A-Z0-9_]{2,})'/g)) keys.add(match[1]);
  return keys;
}

/** `EINVOICE_<CC>_…` and the Stripe price family are declared by shape, not one by one. */
const DECLARED_BY_SHAPE = [/^EINVOICE_[A-Z]{2}_[A-Z0-9_]+$/, /^STRIPE_PRICE_[A-Z0-9_]+$/];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry !== 'node_modules' && entry !== 'dist') walk(full, out);
    } else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

const declared = declaredKeys(readFileSync(SCHEMA, 'utf8'));
const READ = /process\.env(?:\[\s*'([A-Z][A-Z0-9_]*)'\s*\]|\.([A-Z][A-Z0-9_]*)\b)/g;

const offences = [];
for (const file of walk(APP)) {
  const rel = `/${relative(ROOT, file).replace(/\\/g, '/')}`;
  if (EXEMPT.some((rx) => rx.test(rel))) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    // A comment may quote a variable to explain it.
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
    for (const match of line.matchAll(READ)) {
      const name = match[1] ?? match[2];
      if (declared.has(name) || DECLARED_BY_SHAPE.some((rx) => rx.test(name))) continue;
      offences.push(`${rel.slice(1)}:${index + 1}  ${name}`);
    }
  });
}

if (offences.length > 0) {
  console.error(`✗ ${offences.length} environment variable read(s) are not declared in the schema:\n`);
  for (const line of offences) console.error(`   ${line}`);
  console.error('\n  Declare each one in apps/backend/api/src/app/config/env.validation.ts, with its');
  console.error('  shape and its default, and document it in .env.example.');
  process.exit(1);
}
console.log(`env schema: ${declared.size} declared name(s); every variable the application reads is one of them.`);

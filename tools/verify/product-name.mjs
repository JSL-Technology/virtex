#!/usr/bin/env node
/**
 * The product is called **virtex**, and nothing in the repository spells it otherwise.
 *
 * It was `virteex` in 729 places — the TypeScript path alias, the package name, environment
 * variables, the test and CI databases, example domains, the Redis namespace, i18n keys, tsconfigs,
 * the compose file and the CI workflow — because a typo in a scaffold propagates by copy. A name
 * that is wrong in some places and right in others is worse than either: every tool that matches on
 * it (a grep, an alias, a database URL, a search of the catalogue) has to know both.
 *
 * So the misspellings are banned outright, in every file, in any case. What is exempt says why:
 *
 *  - dated audit reports under `docs/auditorias/`, which quote what the code SAID at a point in
 *    time. Rewriting the evidence of a finding is how the record stops being one;
 *  - this file, which has to name what it bans;
 *  - any line carrying `product-name-allow`, for the few places that must NAME the misspelling in
 *    order to explain it — this gate's own entry in the CI workflow and in the engineering
 *    standard. A marker, not a path, so the decision is visible where it is taken and `grep`
 *    finds every one of them.
 *
 *     npm run verify:product-name
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The name, and every spelling that is not it. */
const NAME = 'virtex';
const BANNED = [/virt[e]{2,}x/i, /\bbillio\b/i];

/** The marker a line uses to name a banned spelling on purpose. */
const ALLOW = 'product-name-allow';

const SKIP_DIRS = new Set(['node_modules', 'dist', '.nx', '.git', '.angular', 'coverage', 'tmp', '.cache']);
const SKIP_PATHS = [
  // Dated records of what the code said; see the note above.
  '/docs/auditorias/',
  '/docs/AUDITORIA_I18N.md',
  '/docs/INFORME_AUDITORIA_MODULOS_2026.md',
  // This file names what it bans.
  '/tools/verify/product-name.mjs',
];
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|eot|pdf|zip|p12|pfx|webp|mp4|svgz|lock)$/i;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const offences = [];
for (const file of walk(ROOT)) {
  const rel = `/${relative(ROOT, file).replace(/\\/g, '/')}`;
  if (SKIP_PATHS.some((path) => rel.startsWith(path))) continue;
  if (BINARY.test(file)) continue;
  let source;
  try {
    source = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  source.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW)) return;
    for (const pattern of BANNED) {
      const found = pattern.exec(line);
      if (found) offences.push(`${rel.slice(1)}:${index + 1}  ${found[0]}`);
    }
  });
}

if (offences.length > 0) {
  console.error(`✗ ${offences.length} place(s) spell the product something other than «${NAME}»:\n`);
  for (const line of offences.slice(0, 40)) console.error(`   ${line}`);
  if (offences.length > 40) console.error(`   … and ${offences.length - 40} more`);
  process.exit(1);
}
console.log(`product name: every file spells it «${NAME}».`);

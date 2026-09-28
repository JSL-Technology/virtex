#!/usr/bin/env node
/**
 * Packages that are released together must be installed together.
 *
 * `nx` and its `@nx/*` plugins share one version number and load each other's internals; the
 * Angular framework packages do the same, and so do the Angular CLI/devkit packages. A security
 * bump that moved `nx` alone left `main` with three Nx releases in the tree at once — three copies
 * of `nx` itself — and a lockfile `npm ci` refused, so no CI step ran at all.
 *
 * Two things are checked for every family:
 *   1. package.json declares the same specifier for every member it lists;
 *   2. package-lock.json resolves every member, at any depth, to a single version.
 *
 *   node tools/verify/package-families.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const FAMILIES = [
  { name: 'Nx', member: (n) => n === 'nx' || n.startsWith('@nx/') },
  {
    name: 'Angular framework',
    // The CDK and Material ship from another repository on their own cadence; the CLI and build
    // tooling are the next family.
    member: (n) =>
      n.startsWith('@angular/') && !['@angular/cdk', '@angular/material', '@angular/cli', '@angular/build'].includes(n),
  },
  {
    // `dockview-angular` is a thin adapter over `dockview`/`dockview-core` and reaches into their
    // internals. Dependabot moved the adapter alone from 6.6.1 to 8.3.1: it brought its own nested
    // dockview 8, the renderer it registered was not the one the grid called, and not one tab in
    // the product rendered its content (QA C-01). The adapter 8.x also requires Angular >= 21, a
    // conflict the `overrides` entry for its Angular peers silenced.
    name: 'Dockview',
    member: (n) => n === 'dockview' || n === 'dockview-core' || n === 'dockview-angular',
  },
  {
    name: 'Angular tooling',
    member: (n) =>
      ['@angular/cli', '@angular/build', '@schematics/angular'].includes(n) || n.startsWith('@angular-devkit/'),
  },
];

// Platform binaries are published per OS/CPU and resolved per install; they follow `nx`'s version.
const IGNORED = /^@nx\/nx-/;

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(readFileSync(join(ROOT, 'package-lock.json'), 'utf8'));
const declared = { ...pkg.dependencies, ...pkg.devDependencies };

const problems = [];

/** `node_modules/a/node_modules/@s/b` → `@s/b`. */
function nameAt(path) {
  return path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** Where Node would find `name` when required from the package installed at `from`. */
function resolveFrom(from, name) {
  let dir = from;
  for (;;) {
    const candidate = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (lock.packages[candidate]) return candidate;
    if (!dir) return null;
    const cut = dir.lastIndexOf('/node_modules/');
    dir = cut === -1 ? '' : dir.slice(0, cut);
  }
}

/** The family members reachable from `roots` through members' own dependencies. */
function installedFrom(roots, family) {
  const seen = new Set();
  const queue = roots.filter((p) => lock.packages[p]);
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const entry = lock.packages[path];
    const deps = { ...entry.dependencies, ...entry.optionalDependencies, ...entry.peerDependencies };
    for (const dep of Object.keys(deps)) {
      if (!family.member(dep) || IGNORED.test(dep)) continue;
      const target = resolveFrom(path, dep);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  return seen;
}

/**
 * The release a version belongs to. `@angular-devkit/architect` (and a few siblings) are still
 * versioned 0.x and encode the release in the minor: 0.2003.37 ships with 20.3.37.
 */
function releaseOf(name, version) {
  const zeroMajor = /^0\.(\d+?)(\d{2})\.(\d+)(.*)$/.exec(version ?? '');
  return name.startsWith('@angular-devkit/') && zeroMajor
    ? `${zeroMajor[1]}.${Number(zeroMajor[2])}.${zeroMajor[3]}${zeroMajor[4]}`
    : version;
}

for (const family of FAMILIES) {
  const direct = Object.entries(declared).filter(([n]) => family.member(n) && !IGNORED.test(n));
  if (direct.length === 0) continue;

  const specifiers = new Map();
  for (const [name, spec] of direct) {
    specifiers.set(spec, [...(specifiers.get(spec) ?? []), name]);
  }
  if (specifiers.size > 1) {
    const detail = [...specifiers].map(([spec, names]) => `${spec}: ${names.join(', ')}`).join('\n      ');
    problems.push(`${family.name}: package.json declares different versions\n      ${detail}`);
  }

  // Every copy the family's own members pull in — at any depth — must be the same release.
  // Copies that third-party tools vendor for themselves (e.g. the Angular devkit inside
  // @nestjs/cli) are theirs to pin and are not reached from here.
  const resolved = new Map();
  for (const path of installedFrom(direct.map(([n]) => `node_modules/${n}`), family)) {
    const version = releaseOf(nameAt(path), lock.packages[path].version);
    resolved.set(version, [...(resolved.get(version) ?? []), path]);
  }
  if (resolved.size > 1) {
    const detail = [...resolved]
      .map(([version, paths]) => `${version}: ${paths.slice(0, 4).join(', ')}${paths.length > 4 ? `, … (+${paths.length - 4})` : ''}`)
      .join('\n      ');
    problems.push(`${family.name}: package-lock.json resolves more than one version\n      ${detail}`);
  }
}

if (problems.length) {
  console.error('\n✗ package-families: a family released together is not installed together.\n');
  for (const p of problems) console.error(`  - ${p}\n`);
  console.error(
    '  Move the whole family in one change (Dependabot groups them: .github/dependabot.yml).\n',
  );
  process.exit(1);
}

console.log(`✓ package-families: ${FAMILIES.map((f) => f.name).join(', ')} each install one version.`);

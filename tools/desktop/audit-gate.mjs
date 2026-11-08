#!/usr/bin/env node
/**
 * Fail CI when the desktop shell ships, or is built with, a known vulnerability.
 *
 *     node tools/desktop/audit-gate.mjs
 *
 * Three rules, from apps/desktop/security-baseline.json:
 *
 *   1. The installed Electron is at least `minimumElectron` and belongs to one of the newest
 *      `supportedElectronMajors` majors (Electron supports the latest three; an older major
 *      receives no security fixes at all, whatever npm audit says about it).
 *   2. The application's own runtime dependencies (apps/desktop/package-lock.json — what goes into
 *      the installer) have no advisory of any severity.
 *   3. Electron itself has no advisory of any severity, and the build tooling (electron-builder and
 *      its family) has nothing above `moderate`. A moderate in build tooling must be listed under
 *      `acceptedAdvisories` with a reason and a review date; an expired acceptance fails.
 *
 * npm audit needs the registry; with no network this script fails rather than passing silently.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const baseline = JSON.parse(readFileSync(join(DESKTOP, 'security-baseline.json'), 'utf8'));
const { compareVersions } = require(join(DESKTOP, 'src/release-verification.js'));

const failures = [];
const notes = [];

// ── 1. Electron version ───────────────────────────────────────────────────────────────────────────
const installed = JSON.parse(readFileSync(join(ROOT, 'node_modules/electron/package.json'), 'utf8')).version;
if (compareVersions(installed, baseline.minimumElectron) < 0) {
  failures.push(`electron ${installed} is below the security baseline ${baseline.minimumElectron}`);
}
let latestMajor = null;
try {
  const tag = execFileSync('npm', ['view', 'electron', 'dist-tags.latest'], { cwd: ROOT, encoding: 'utf8' }).trim();
  latestMajor = Number(tag.split('.')[0]);
} catch (error) {
  failures.push(`could not read the latest Electron release from the registry (${error.message.split('\n')[0]})`);
}
if (latestMajor !== null && Number(installed.split('.')[0]) <= latestMajor - baseline.supportedElectronMajors) {
  failures.push(
    `electron ${installed} is outside the ${baseline.supportedElectronMajors} supported majors (latest is ${latestMajor}): it no longer receives security fixes`,
  );
}

// ── npm audit helpers ─────────────────────────────────────────────────────────────────────────────
function audit(cwd) {
  let out;
  try {
    out = execFileSync('npm', ['audit', '--json'], { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    out = error.stdout;
  }
  const report = JSON.parse(out || '{}');
  if (!report.vulnerabilities) throw new Error(`npm audit returned no report in ${cwd}`);
  return report.vulnerabilities;
}

const advisoriesOf = (entry) =>
  entry.via.filter((via) => typeof via === 'object').map((via) => ({ id: via.url?.split('/').pop(), severity: via.severity, title: via.title }));

const RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
const today = new Date().toISOString().slice(0, 10);

// ── 2. The installer's runtime dependencies ───────────────────────────────────────────────────────
try {
  for (const [name, entry] of Object.entries(audit(DESKTOP))) {
    failures.push(`runtime dependency ${name} (${entry.severity}) ships in the installer: ${advisoriesOf(entry).map((a) => a.id).join(', ') || 'via ' + entry.via.join(', ')}`);
  }
} catch (error) {
  failures.push(error.message);
}

// ── 3. Electron and the build tooling ─────────────────────────────────────────────────────────────
const BUILD_FAMILY = new Set([
  'electron-builder',
  'app-builder-lib',
  'dmg-builder',
  'builder-util',
  'builder-util-runtime',
  'electron-builder-squirrel-windows',
  '@electron/universal',
  '@electron/notarize',
  '@electron/osx-sign',
  '@electron/fuses',
  '@electron/asar',
  '@electron/rebuild',
]);
try {
  const root = audit(ROOT);
  if (root.electron) failures.push(`electron has an advisory (${root.electron.severity}); raise it before release`);

  const accepted = new Map(baseline.acceptedAdvisories.map((entry) => [entry.advisory, entry]));
  for (const [name, entry] of Object.entries(root)) {
    const reachesBuild = BUILD_FAMILY.has(name) || entry.effects?.some((dependent) => BUILD_FAMILY.has(dependent));
    if (!reachesBuild) continue;
    for (const advisory of advisoriesOf(entry)) {
      const acceptance = accepted.get(advisory.id);
      if (RANK[advisory.severity] > RANK.moderate) {
        failures.push(`${name}: ${advisory.severity} ${advisory.id} in the desktop build tooling`);
      } else if (!acceptance) {
        failures.push(`${name}: ${advisory.severity} ${advisory.id} is not accepted in security-baseline.json`);
      } else if (acceptance.reviewBy < today) {
        failures.push(`${name}: acceptance of ${advisory.id} expired on ${acceptance.reviewBy}; review it`);
      } else {
        notes.push(`${name}: ${advisory.id} accepted until ${acceptance.reviewBy} (${acceptance.scope})`);
      }
    }
  }
} catch (error) {
  failures.push(error.message);
}

for (const note of [...new Set(notes)]) console.log(`· ${note}`);
if (failures.length) {
  for (const failure of failures) console.error(`✗ ${failure}`);
  process.exit(1);
}
console.log(`✓ desktop supply chain: electron ${installed} (baseline ${baseline.minimumElectron}), installer runtime dependencies clean`);

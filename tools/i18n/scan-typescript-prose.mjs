#!/usr/bin/env node
/**
 * Interface sentences written into TypeScript instead of the catalogue.
 *
 * `scan-hardcoded-strings.mjs` reads templates, and reports zero for a product whose password
 * meter told every reader "Fuerte", whose font picker offered "Poppins (Geométrica Sans-serif)",
 * and whose two-factor screen said "Por favor, ingrese solo números" — because none of those
 * sentences is in a template. They are string literals in a component class, returned by a
 * `computed` or held in an array, and the template renders whatever comes back. A scanner whose
 * scope is narrower than its subject does not report a small number; it reports a number about
 * something else.
 *
 * ## What counts
 *
 * A string literal in CLIENT TypeScript that reads as Spanish prose: it carries a Spanish-only
 * character, or a Spanish function word, and it is not a catalogue key, a selector, a path or a
 * CSS value. Server code is out of scope on purpose — this codebase logs in Spanish deliberately,
 * and an operator's log line is not interface text.
 *
 * Comments are blanked before scanning. The documentation in this repository is largely Spanish
 * and is meant to be.
 *
 * ## Why a baseline rather than a clean zero
 *
 * There are sixty-odd of these, across features this sweep did not exercise. Translating them
 * blind — three languages each, in screens nobody has re-tested — trades a visible defect for an
 * invisible one. So the count is pinned: the ones that were found are listed, and the build fails
 * the moment a new one appears. The debt is recorded rather than hidden, and it cannot grow.
 *
 *     node tools/i18n/scan-typescript-prose.mjs            # summary, non-zero exit if over baseline
 *     node tools/i18n/scan-typescript-prose.mjs --list      # each finding with file:line
 *     node tools/i18n/scan-typescript-prose.mjs --baseline  # rewrite the baseline to what is found
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const BASELINE_FILE = `${HERE}/typescript-prose-baseline.json`;

/** Client code only: what a customer reads, not what an operator greps. */
const ROOTS = ['apps/core/client-web/src', 'apps/pos/src', 'libs/shared/ui-i18n/src'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx', 'assets', 'i18n']);

const SPANISH_WORD =
  /\b(el|la|los|las|un|una|unos|unas|de|del|con|para|por|sin|que|este|esta|cuando|donde|debe|puede|hay|son|está|están|más|muy|ya|fuerte|buena|regular|aceptable|débil|guardar|cancelar|enviar|nuevo|nueva|cargando)\b/i;
const SPANISH_CHAR = /[áéíóúñÁÉÍÓÚÑ¿¡]/;

/** A catalogue key — the thing this scanner exists to encourage. */
const CATALOGUE_KEY = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/;
/** Selectors, paths, URLs, CSS values, template fragments: not sentences. */
const NOT_PROSE = /[/@#{}<>()[\]]|^https?:|^--|^[\w-]+$/;

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* files(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      yield path.join(dir, entry.name);
    }
  }
}

/** Blank comments in place, so line numbers stay true and Spanish documentation does not count. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (block) =>
    block.replace(/[^\n]/g, ' '),
  );
}

const findings = [];
for (const root of ROOTS) {
  const absolute = path.join(ROOT, root);
  if (!fs.existsSync(absolute)) continue;
  for (const file of files(absolute)) {
    const relative = path.relative(ROOT, file);
    const source = withoutComments(fs.readFileSync(file, 'utf8'));
    const lines = source.split('\n');

    lines.forEach((line, index) => {
      const literals = line.matchAll(/'([^'\\\n]{4,160})'|"([^"\\\n]{4,160})"|`([^`\\\n$]{4,160})`/g);
      for (const match of literals) {
        const text = match[1] ?? match[2] ?? match[3];
        if (!/[\p{L}]{3}/u.test(text)) continue;
        if (CATALOGUE_KEY.test(text)) continue;
        if (NOT_PROSE.test(text)) continue;
        const spanish = SPANISH_CHAR.test(text) || SPANISH_WORD.test(text);
        if (!spanish) continue;
        // A single word with no Spanish-only character is as likely to be English.
        if (!/\s/.test(text) && !SPANISH_CHAR.test(text)) continue;
        findings.push({ file: relative, line: index + 1, text });
      }
    });
  }
}

const baseline = fs.existsSync(BASELINE_FILE)
  ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
  : { count: 0, files: {} };

if (process.argv.includes('--baseline')) {
  const byFile = {};
  for (const finding of findings) byFile[finding.file] = (byFile[finding.file] ?? 0) + 1;
  fs.writeFileSync(
    BASELINE_FILE,
    `${JSON.stringify({ count: findings.length, files: byFile }, null, 2)}\n`,
  );
  console.log(`baseline written: ${findings.length} literals across ${Object.keys(byFile).length} files`);
  process.exit(0);
}

if (process.argv.includes('--list')) {
  for (const finding of findings) {
    console.log(`  ${finding.file}:${finding.line}  ${JSON.stringify(finding.text)}`);
  }
}

const byFile = {};
for (const finding of findings) byFile[finding.file] = (byFile[finding.file] ?? 0) + 1;

const regressions = Object.entries(byFile)
  .filter(([file, count]) => count > (baseline.files[file] ?? 0))
  .map(([file, count]) => `  ${file}: ${count} (baseline ${baseline.files[file] ?? 0})`);

console.log(
  `Spanish prose in client TypeScript: ${findings.length} (baseline ${baseline.count})`,
);

if (regressions.length > 0) {
  console.error('\nNew interface text written into TypeScript instead of the catalogue:');
  console.error(regressions.join('\n'));
  console.error('\nPut the sentence in libs/shared/locales and render the key.');
  process.exit(1);
}

if (findings.length < baseline.count) {
  console.log('Below baseline — run with --baseline to lock in the improvement.');
}

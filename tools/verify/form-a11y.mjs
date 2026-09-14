#!/usr/bin/env node
/**
 * Every form in the client announces which field is wrong.
 *
 * `InvalidFieldDirective` sets `aria-invalid` on a control that is invalid and touched. It applies
 * by selector, so it costs a template nothing — but Angular's standalone components only see a
 * directive their own `imports` lists, so a component that forgets it goes back to the state this
 * fixed: a form that reports its errors to the eye and to nothing else.
 *
 * That omission is invisible. It compiles, it renders, it passes every test about what the form
 * does. So it is checked here: a client component that imports `ReactiveFormsModule` or
 * `FormsModule` must also spread `VX_FORM_A11Y`.
 *
 *     node tools/verify/form-a11y.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ROOTS = ['apps/core/client-web/src/app', 'apps/pos/src/app'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx']);

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

const offenders = [];
let checked = 0;

for (const root of ROOTS) {
  const absolute = path.join(ROOT, root);
  if (!fs.existsSync(absolute)) continue;

  for (const file of files(absolute)) {
    const source = fs.readFileSync(file, 'utf8');
    // The directive itself and its own barrel are not components.
    if (file.includes(`a11y${path.sep}invalid-field`)) continue;

    const block = source.match(/imports:\s*\[([^\]]*)\]/s);
    if (!block) continue;
    if (!/\b(ReactiveFormsModule|FormsModule)\b/.test(block[1])) continue;

    checked += 1;
    if (!/\bVX_FORM_A11Y\b/.test(block[1])) {
      offenders.push(path.relative(ROOT, file));
    }
  }
}

if (offenders.length > 0) {
  console.error(`${offenders.length} form component(s) do not mark their invalid fields:\n`);
  for (const file of offenders) console.error(`  ${file}`);
  console.error(
    '\nAdd `...VX_FORM_A11Y` to the component\'s imports, beside ReactiveFormsModule.\n' +
      'It sets aria-invalid on a control that is invalid and touched, so a screen reader can\n' +
      'find the field the error summary is talking about.',
  );
  process.exit(1);
}

console.log(`form accessibility: ${checked} form components, all marking invalid fields`);

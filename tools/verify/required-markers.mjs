#!/usr/bin/env node
/**
 * The asterisk on a label says the field is required. It has to be true, and it has to be checked.
 *
 * Twenty-nine catalogue entries carried the marker INSIDE the translated text — `"Company Name*"`,
 * `"Nombre de la Empresa*"`. That makes "required" a piece of prose in three languages instead of
 * a property of the field, with two consequences:
 *
 *   - it goes stale silently. Two of them marked fields that were never required at all
 *     (`contactPerson` on the customer, `categoryId` on the product), and two more kept their
 *     asterisk after the rule was relaxed;
 *   - it leaked into places that are not labels. These keys double as the field names in the
 *     draft gesture's error summary, so a failed save read `"Company Name*" is required`.
 *
 * The marker now lives in the template and this checks it against the form: every `*` on a label
 * must name a control declared with `Validators.required`, and every such control must carry one.
 *
 *     node tools/verify/required-markers.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ROOTS = ['apps/core/client-web/src/app', 'apps/pos/src/app'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx']);

function* templates(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* templates(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.html')) {
      yield path.join(dir, entry.name);
    }
  }
}

/**
 * Whether the user must supply this field, as they experience it.
 *
 * `Validators.required` alone is not the question. `isActive: [true, Validators.required]` can
 * never be empty, so marking it tells the reader to fill in something that is already filled in.
 * A field only demands the marker when it is required AND starts empty — `['']`, `[null]`,
 * `[undefined]`. Anything else has an answer before the user arrives.
 */
function demandsInput(component, control) {
  const declaration = new RegExp(`\\b${control}\\s*:\\s*\\[([^\\]]*)\\]`, 's').exec(component);
  if (!declaration) return null;
  const body = declaration[1];
  if (!/required/.test(body)) return false;
  const initial = body.split(',')[0].trim();
  return initial === "''" || initial === '""' || initial === 'null' || initial === 'undefined';
}

const LABEL = /<label[^>]*for="([^"]+)"[^>]*>([\s\S]*?)<\/label>/g;

const lying = [];
const silent = [];
let checked = 0;

for (const root of ROOTS) {
  const absolute = path.join(ROOT, root);
  if (!fs.existsSync(absolute)) continue;

  for (const template of templates(absolute)) {
    const componentPath = template.replace(/\.html$/, '.ts');
    if (!fs.existsSync(componentPath)) continue;
    const component = fs.readFileSync(componentPath, 'utf8');
    const html = fs.readFileSync(template, 'utf8');
    const where = path.relative(ROOT, template);

    for (const match of html.matchAll(LABEL)) {
      const [, control, body] = match;
      /**
       * Two spellings in the product, both meaning the same thing: a bare `*` after the
       * translated label, and the styled `<span class="required">*</span>` the settings screens
       * use. Matched as those exact shapes rather than by looking for a `*` anywhere in the
       * label — an interpolation can contain one perfectly innocently, and one does: the invoice
       * form's service-charge label multiplies a rate by 100 inside its own translate call.
       */
      const marked =
        /\}\}\s*\*/.test(body) ||
        /\*\s*$/.test(body.trim()) ||
        /<span[^>]*class="required"[^>]*>\s*\*/.test(body);
      const required = demandsInput(component, control);
      if (required === null) continue; // not a reactive control declared in this component
      checked += 1;

      if (marked && !required) lying.push(`  ${where}: "${control}" is marked required and is not`);
      if (!marked && required) silent.push(`  ${where}: "${control}" is required and says nothing`);
    }
  }
}

if (lying.length > 0 || silent.length > 0) {
  if (lying.length > 0) {
    console.error('Labels that claim a field is required when it is not:\n');
    console.error(lying.join('\n'));
  }
  if (silent.length > 0) {
    console.error('\nRequired fields whose label does not say so:\n');
    console.error(silent.join('\n'));
  }
  console.error(
    '\nThe marker belongs in the template, next to `| translate`, and must match the validator.',
  );
  process.exit(1);
}

console.log(`required markers: ${checked} labelled controls, every marker matching its validator`);

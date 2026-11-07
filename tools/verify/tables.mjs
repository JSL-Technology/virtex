#!/usr/bin/env node
/**
 * Every table of the web client is a `vx-table`.
 *
 * The product had five ways of drawing a table (a card with a shadow on lists, nothing in Settings,
 * a wrapper in the views, `.card` + `.data-table` in the classic pages and `.lines-table` in the
 * documents), and none of their differences was anybody's decision. `vx-table` is the one table
 * now; this keeps it that way, because the regression is silent: a new page that writes a bare
 * `<table class="data-table">` compiles, renders and passes its tests — and brings the old look,
 * the old phone layout and the old keyboard trap back with it.
 *
 * It checks, in every template of the client (`.html` files and inline `template:` blocks):
 *   1. every `<table>` is the direct child of `<vx-table>` (Angular control flow in between is fine);
 *   2. no template uses the retired table classes (`data-table`, `lines-table`, `table-container`…);
 *   3. cells say «numeric» one way: `numeric`, not `text-right`, `num`, `amount` or `is-numeric`;
 *      and the row's actions one way: `actions-column`, not `row-actions`;
 * and, in every stylesheet, that nothing includes the retired table mixins.
 *
 *     node tools/verify/tables.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const APP = path.join(ROOT, 'apps/core/client-web/src');
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx']);

/**
 * Tables that are not interface, each with its reason. A sheet printed on paper has no theme, no
 * phone layout and nobody tabbing through it: it is a document, laid out once for A4.
 */
const NOT_INTERFACE = new Map([
  // ['features/…/print-sheet.component.html', 'hoja impresa'],
]);

const RETIRED_TABLE_CLASSES = ['data-table', 'lines-table', 'line-items-table'];
const RETIRED_WRAPPERS = ['table-container', 'table-wrapper', 'table-responsive', 'table-scroll'];
const NUMERIC_ALIASES = ['text-right', 'num', 'amount', 'is-numeric'];
const RETIRED_MIXINS = [/@include\s+ds\.data-table\b/, /@include\s+ui\.table\b/, /@include\s+views\.(?:table-wrapper|data-table)\b/];

function* walk(dir, test) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path.join(dir, entry.name), test);
    } else if (test(entry.name)) {
      yield path.join(dir, entry.name);
    }
  }
}

/** The templates of a file: the file itself for `.html`, the `template:` blocks of a component. */
function templatesOf(file, source) {
  if (file.endsWith('.html')) return [{ text: source, offset: 0 }];
  const found = [];
  for (const match of source.matchAll(/\btemplate:\s*`/g)) {
    const start = match.index + match[0].length;
    let i = start;
    while (i < source.length && source[i] !== '`') i += source[i] === '\\' ? 2 : 1;
    found.push({ text: source.slice(start, i), offset: start });
  }
  return found;
}

const TAG = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function classesOf(attributes) {
  const match = attributes.match(/(?:^|\s)class\s*=\s*"([^"]*)"/);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

const problems = [];
let tables = 0;
const templates = new Set();

for (const file of walk(path.join(APP, 'app'), (name) => (name.endsWith('.html') || name.endsWith('.ts')) && !name.endsWith('.spec.ts'))) {
  const rel = path.relative(path.join(APP, 'app'), file).split(path.sep).join('/');
  if (NOT_INTERFACE.has(rel)) continue;
  const source = fs.readFileSync(file, 'utf8');
  if (!source.includes('<table') && !/class="[^"]*\b(?:data-table|lines-table|table-container|text-right|row-actions)\b/.test(source)) continue;

  for (const { text, offset } of templatesOf(file, source)) {
    const stack = [];
    for (const match of text.matchAll(TAG)) {
      if (match[0].startsWith('<!--')) continue;
      const [, closing, rawName, attributes = '', selfClosing] = match;
      const name = rawName.toLowerCase();
      const where = `${path.relative(ROOT, file)}:${lineOf(source, offset + match.index)}`;
      if (closing) {
        const at = stack.lastIndexOf(name);
        if (at >= 0) stack.length = at;
        continue;
      }
      const classes = classesOf(attributes);
      if (name === 'table') {
        tables += 1;
        templates.add(rel);
        if (stack[stack.length - 1] !== 'vx-table') {
          problems.push(`${where}  <table> fuera de <vx-table> (dentro de <${stack[stack.length - 1] ?? 'raíz'}>)`);
        }
        for (const retired of RETIRED_TABLE_CLASSES) {
          if (classes.includes(retired)) problems.push(`${where}  clase retirada «${retired}» en <table>: la tabla la pinta vx-table`);
        }
      }
      for (const wrapper of RETIRED_WRAPPERS) {
        if (classes.includes(wrapper)) problems.push(`${where}  envoltorio retirado «${wrapper}»: el marco y el desplazamiento son de vx-table`);
      }
      if (name === 'th' || name === 'td') {
        for (const alias of NUMERIC_ALIASES) {
          if (classes.includes(alias)) problems.push(`${where}  «${alias}» en <${name}>: una cifra se marca con «numeric»`);
        }
        if (classes.includes('row-actions')) problems.push(`${where}  «row-actions» en <${name}>: las acciones de la fila van en «actions-column»`);
      }
      if (!VOID.has(name) && !selfClosing) stack.push(name);
    }
  }
}

for (const file of walk(APP, (name) => name.endsWith('.scss'))) {
  const source = fs.readFileSync(file, 'utf8');
  for (const pattern of RETIRED_MIXINS) {
    const match = source.match(pattern);
    if (match) problems.push(`${path.relative(ROOT, file)}:${lineOf(source, match.index)}  ${match[0]}: la tabla la pinta vx-table`);
  }
}

if (problems.length > 0) {
  console.error(`✗ tablas: ${problems.length} problema(s)\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\n  Una tabla se escribe así: <vx-table labelKey="…"><table>…</table></vx-table>');
  console.error('  Ver apps/core/client-web/src/app/shared/components/table/README.md');
  process.exit(1);
}

console.log(`✓ tablas: ${tables} tablas en ${templates.size} plantillas, todas dentro de <vx-table>.`);

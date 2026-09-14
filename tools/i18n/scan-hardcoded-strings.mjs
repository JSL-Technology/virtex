#!/usr/bin/env node
/**
 * Interface text that does not go through the catalogue.
 *
 * A literal in a template is not a type error, not a compile error and not a failed render: it is a
 * string that appears on screen in whatever language it was typed in. Nothing catches it, so this is
 * what turns that class of defect into a number, and then into a build failure.
 *
 * ## Why this replaces `tools/scan-hardcoded-strings.mjs`
 *
 * That version declared `const ROOT = 'apps/core/client-web/src'` and collected `.html` files. It
 * reported 12 literals and was telling the truth about roughly 60 % of the product's interface code.
 * Outside its reach were:
 *
 *  - `apps/pos` entirely — the till, 100 % hard-coded English in a Spanish-default product;
 *  - 39 inline `template:` strings in `.ts` files, among them the four roadmap panels and the three
 *    payment screens, all literals;
 *  - `apps/desktop` — the native menu;
 *  - the Handlebars e-mail and invoice templates.
 *
 * A scanner whose scope is narrower than its subject does not report a small number: it reports a
 * number about something else. This one walks every application and reads HTML files, the inline
 * templates inside components, and the Handlebars templates.
 *
 *     node tools/i18n/scan-hardcoded-strings.mjs           # summary, non-zero exit on any finding
 *     node tools/i18n/scan-hardcoded-strings.mjs --list     # each finding with file:line
 *     node tools/i18n/scan-hardcoded-strings.mjs --allow    # rewrite the allow-list to what is found
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const ALLOW_FILE = `${HERE}/hardcoded-allowed.json`;

const APPS = [
  'apps/core/client-web/src',
  'apps/pos/src',
  'apps/desktop/src',
  'apps/backend/api/src/app/mail/templates',
  'apps/backend/api/src/app/invoices/templates',
];

const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '.nx', 'assets', 'i18n']);

/**
 * Conservative on purpose, so the number means something.
 *
 * `>…<` text nodes containing no `{`, `}` or `@` — which excludes every interpolation by
 * construction, `{{ 'x' | translate }}` included — plus the attributes a person actually reads.
 * Anything without three consecutive letters is a number, a symbol or an icon.
 */
const HUMAN_ATTRS = /\s(placeholder|title|alt|aria-label|aria-description|aria-placeholder|label)\s*=\s*"([^"{}]+)"/g;
const CONTROL_FLOW = /@(if|for|switch|case|else if|else|defer|placeholder|loading|empty)\b[^{]*\{/g;
const TEXT_NODE = />([^<>{}@]*)</g;
const HAS_LETTERS = /[\p{L}]{3}/u;
/**
 * A text node that is really a fragment of an expression.
 *
 * `[class.warn]="ratio >= 0.8 && (used / limit)"` puts a `>` inside an attribute, so the `>…<` scan
 * takes the rest of the expression for a text node. Recognising operator soup is cheaper and more
 * honest than trying to parse Angular's template syntax here.
 */
const LOOKS_LIKE_CODE = /&&|\|\||=>|^[=!<>]|\breturn\b|\$any\(|\{\{/;
/**
 * An interpolation, and the quoted strings inside it.
 *
 * The text-node scan excludes interpolations by construction, which is right for
 * `{{ 'a.b.c' | translate }}` and wrong for a sentence written inside one. Three of them were:
 *
 *     {{ isLoading ? 'Guardando…' : 'Guardar Cambios' }}
 *     {{ isEditMode() ? "Editar Usuario" : "Invitar Nuevo Usuario" }}
 *
 * Those are interface text in one language, in a product whose reader may be in another — and a
 * scanner that reports "no untranslated interface text" while they are on screen is reporting
 * about something else. A catalogue KEY is dotted lower_snake, so anything quoted that is not
 * key-shaped and holds real words is a literal.
 */
const INTERPOLATION = /\{\{([\s\S]*?)\}\}/g;
const QUOTED = /'([^']*)'|"([^"]*)"/g;
const KEY_SHAPED = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i;
/**
 * Prose, as opposed to an argument.
 *
 * `{{ x | vxDate: 'date' }}` and `{{ list | vxList: 'conjunction' }}` quote a parameter, not a
 * sentence, and flagging those would drown the real findings. A sentence has more than one word or
 * carries a letter English does not — which is what every literal this caught actually looked like:
 * "Guardar Cambios", "Invitar Nuevo Usuario", "Enviar Invitación".
 */
const READS_AS_PROSE = /\s|[^\x00-\x7F]/;
const ENTITY = /&[a-z]+;|&#x?[0-9a-f]+;/gi;
/** An inline Angular template: `template: \`…\`` in a component decorator. */
const INLINE_TEMPLATE = /template\s*:\s*`([\s\S]*?)`\s*,?\s*\n?\s*(?:styles?Url|styles|changeDetection|providers|host|encapsulation|animations|imports|standalone|selector|\})/;

/** Handlebars renders `{{t "key"}}`, so a `{`-free text node is a literal there too. */
const HBS_HELPERS = /\{\{[^}]*\}\}/g;

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return SKIP_DIRS.has(entry.name) ? [] : walk(full);
    if (/\.spec\.ts$/.test(entry.name)) return [];
    return /\.(html|hbs|ts)$/.test(entry.name) ? [full] : [];
  });
}

/** The markup a file contributes, and the line the markup starts on. */
function markupOf(file) {
  const raw = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.html')) return [{ text: raw, offsetLine: 0 }];
  if (file.endsWith('.hbs')) return [{ text: raw.replace(HBS_HELPERS, '{}'), offsetLine: 0 }];

  const match = INLINE_TEMPLATE.exec(raw);
  if (!match) return [];
  const offsetLine = raw.slice(0, match.index).split('\n').length - 1;
  return [{ text: match[1], offsetLine }];
}

const allowed = fs.existsSync(ALLOW_FILE)
  ? new Set(JSON.parse(fs.readFileSync(ALLOW_FILE, 'utf8')).allowed ?? [])
  : new Set();

const findings = [];
let scanned = 0;

for (const app of APPS) {
  for (const file of walk(`${ROOT}/${app}`)) {
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    for (const { text, offsetLine } of markupOf(file)) {
      scanned++;
      const src = text.replace(/<!--[\s\S]*?-->/g, '').replace(CONTROL_FLOW, '{');

      for (const match of src.matchAll(TEXT_NODE)) {
        const value = match[1].replace(ENTITY, '').trim();
        if (!value || !HAS_LETTERS.test(value)) continue;
        if (LOOKS_LIKE_CODE.test(value)) continue;
        findings.push({
          file: relative,
          line: offsetLine + src.slice(0, match.index).split('\n').length,
          kind: 'text',
          value,
        });
      }

      for (const interpolation of src.matchAll(INTERPOLATION)) {
        for (const quoted of interpolation[1].matchAll(QUOTED)) {
          const value = (quoted[1] ?? quoted[2] ?? '').trim();
          if (!value || !HAS_LETTERS.test(value)) continue;
          if (KEY_SHAPED.test(value)) continue;
          if (!READS_AS_PROSE.test(value)) continue;
          findings.push({
            file: relative,
            line: offsetLine + src.slice(0, interpolation.index).split('\n').length,
            kind: 'interpolated literal',
            value,
          });
        }
      }

      for (const match of src.matchAll(HUMAN_ATTRS)) {
        const value = match[2].trim();
        if (!value || !HAS_LETTERS.test(value)) continue;
        findings.push({
          file: relative,
          line: offsetLine + src.slice(0, match.index).split('\n').length,
          kind: `attribute ${match[1]}`,
          value,
        });
      }
    }
  }
}

const signature = (f) => `${f.file}:${f.kind}:${f.value}`;
const unexpected = findings.filter((f) => !allowed.has(signature(f)));

if (process.argv.includes('--allow')) {
  fs.writeFileSync(
    ALLOW_FILE,
    `${JSON.stringify(
      {
        $note:
          'Literals that are deliberately not translated: a brand name, a keyboard shortcut, a ' +
          'unit symbol. Each entry is "file:kind:value", so moving the string to another file or ' +
          'changing it brings it back for review rather than grandfathering it silently. Adding to ' +
          'this file is a decision somebody makes in a pull request, not something the scanner does.',
        allowed: [...new Set(findings.map(signature))].sort(),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`allow-list rewritten with ${new Set(findings.map(signature)).size} entries`);
  process.exit(0);
}

console.log(`${scanned} templates scanned across ${APPS.length} roots`);
console.log(`  literal interface strings: ${findings.length} (${allowed.size} allowed)`);

if (process.argv.includes('--list')) {
  for (const f of unexpected) {
    console.log(`  ${f.file}:${f.line}  [${f.kind}]  ${JSON.stringify(f.value)}`);
  }
}

if (unexpected.length) {
  console.error(`\n${unexpected.length} strings reach a reader without passing through the catalogue.`);
  if (!process.argv.includes('--list')) console.error('Run with --list to see them.');
  console.error(
    'Move each one to libs/shared/locales/src/base/, or add it to tools/i18n/hardcoded-allowed.json ' +
      'if it is deliberately the same in every language.',
  );
  process.exit(1);
}

console.log('\nNo untranslated interface text.');

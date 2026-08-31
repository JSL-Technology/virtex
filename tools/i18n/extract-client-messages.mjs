#!/usr/bin/env node
/**
 * Moves the client's toast messages out of the components and into the catalogue.
 *
 * 131 calls carried the sentence written in place — `showSuccess('Factura anulada con éxito.')` —
 * and a handful were in English (`'Could not load customer receipts.'`), so the product's feedback
 * was not merely untranslated, it was not consistently one language either.
 *
 *   node tools/i18n/extract-client-messages.mjs --dry
 *   node tools/i18n/extract-client-messages.mjs
 *
 * `NotificationService` translates, so the rewrite is a key at the call site and nothing else. A
 * template literal becomes a key plus named parameters, the way the backend extraction does it.
 *
 * Anything it cannot read confidently — a variable, a concatenation, a value that came from an
 * API response — is left exactly as it was and counted. `NotificationService.resolve` passes a
 * non-key through unchanged, so those keep working while a person looks at them.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = 'apps/core/client-web/src/app';
const CATALOGUE = 'apps/core/client-web/src/assets/i18n/es.json';
const DRY = process.argv.includes('--dry');

/** The calls whose first argument is a message shown to a person. */
const METHODS = ['showSuccess', 'showError', 'showInfo', 'showWarning'];

const SKIP = ['.spec.ts', `${sep}core${sep}i18n${sep}`, 'notification.ts'];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith('.ts')) return [];
    if (SKIP.some((needle) => full.includes(needle))) return [];
    return [full];
  });
}

/** `features/settings/roles/roles.page.ts` → `SETTINGS.ROLES`. */
function namespaceFor(file) {
  const parts = relative(ROOT, file).split(sep);
  const folder = parts.at(-2) ?? parts.at(-1);
  const area = parts[0] === 'features' || parts[0] === 'layout' ? parts[1] : parts[0];
  const name = (folder ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  const areaName = (area ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return areaName === name ? name : `${areaName}.${name}`;
}

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'al', 'en', 'y', 'o', 'que', 'se', 'su',
  'con', 'por', 'para', 'lo', 'the', 'a', 'an', 'of', 'to', 'is', 'no',
]);

function slugFor(text) {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, 6);
  return words.join('_').toUpperCase() || 'MESSAGE';
}

/** Read one string or template literal, respecting escapes and `${}` nesting. */
function readLiteral(source, open) {
  const quote = source[open];
  if (quote !== "'" && quote !== '"' && quote !== '`') return null;

  let index = open + 1;
  let depth = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (quote === '`' && char === '$' && source[index + 1] === '{') {
      depth++;
      index += 2;
      continue;
    }
    if (quote === '`' && char === '}' && depth > 0) {
      depth--;
      index++;
      continue;
    }
    if (char === quote && depth === 0) {
      return { raw: source.slice(open, index + 1), end: index + 1, quote };
    }
    index++;
  }
  return null;
}

function parseTemplate(raw) {
  const body = raw.slice(1, -1);
  let message = '';
  const params = [];
  let index = 0;

  while (index < body.length) {
    if (body[index] === '\\') {
      message += body.slice(index, index + 2);
      index += 2;
      continue;
    }
    if (body[index] === '$' && body[index + 1] === '{') {
      let depth = 1;
      let cursor = index + 2;
      while (cursor < body.length && depth > 0) {
        if (body[cursor] === '{') depth++;
        else if (body[cursor] === '}') depth--;
        if (depth > 0) cursor++;
      }
      const expression = body.slice(index + 2, cursor).trim();
      if (!/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\(\))*$/.test(expression)) return null;

      let name = expression.split(/[?.()]/).filter(Boolean).pop();
      if (params.some((existing) => existing.name === name)) {
        let ordinal = 2;
        while (params.some((existing) => existing.name === `${name}${ordinal}`)) ordinal++;
        name = `${name}${ordinal}`;
      }
      params.push({ name, expression });
      message += `{{${name}}}`;
      index = cursor + 1;
      continue;
    }
    message += body[index];
    index++;
  }
  return { message, params };
}

const catalogue = {};
const skipped = [];
let rewritten = 0;

function setKey(tree, key, value) {
  const parts = key.split('.');
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function getKey(tree, key) {
  return key
    .split('.')
    .reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);
}

function keyFor(namespace, text) {
  const base = `${namespace}.${slugFor(text)}`;
  for (let ordinal = 1; ; ordinal++) {
    const candidate = ordinal === 1 ? base : `${base}_${ordinal}`;
    const found = getKey(catalogue, candidate);
    if (found === undefined || found === text) {
      setKey(catalogue, candidate, text);
      return candidate;
    }
  }
}

for (const file of sourceFiles(ROOT)) {
  const original = readFileSync(file, 'utf8');
  let source = original;
  const namespace = namespaceFor(file);
  let changed = false;

  for (const method of METHODS) {
    const pattern = new RegExp(`\\.${method}\\s*\\(`, 'g');
    let match;
    while ((match = pattern.exec(source))) {
      const open = match.index + match[0].length;
      let cursor = open;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;

      const literal = readLiteral(source, cursor);
      if (!literal) {
        skipped.push({ file, method, reason: 'non-literal' });
        continue;
      }

      let after = literal.end;
      while (after < source.length && /\s/.test(source[after])) after++;
      if (source[after] === ',') {
        after++;
        while (after < source.length && /\s/.test(source[after])) after++;
      }
      if (source[after] !== ')') {
        skipped.push({ file, method, reason: 'extra-args' });
        continue;
      }

      const parsed =
        literal.quote === '`'
          ? parseTemplate(literal.raw)
          : { message: literal.raw.slice(1, -1).replace(/\\(['"`\\])/g, '$1'), params: [] };

      if (!parsed || !/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(parsed.message)) {
        skipped.push({ file, method, reason: 'not-prose' });
        continue;
      }

      // Already a key — the call was migrated by hand, or names a server error code.
      if (/^[A-Z][A-Z0-9_]*(?:\.[A-Za-z0-9_]+)+$/.test(parsed.message)) {
        pattern.lastIndex = after;
        continue;
      }

      const key = keyFor(namespace, parsed.message);
      const paramsLiteral = parsed.params.length
        ? `, { ${parsed.params.map((p) => `${p.name}: ${p.expression}`).join(', ')} }`
        : '';
      const call = `.${method}('${key}'${paramsLiteral})`;

      source = source.slice(0, match.index) + call + source.slice(after + 1);
      pattern.lastIndex = match.index + call.length;
      changed = true;
      rewritten++;
    }
  }

  if (changed && !DRY) writeFileSync(file, source);
}

function deepMerge(base, extra) {
  const out = { ...base };
  for (const [key, value] of Object.entries(extra)) {
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? deepMerge(typeof out[key] === 'object' && out[key] !== null ? out[key] : {}, value)
        : value;
  }
  return out;
}

if (!DRY) {
  const existing = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  writeFileSync(CATALOGUE, JSON.stringify(deepMerge(existing, catalogue), null, 2) + '\n');
}

function countLeaves(tree) {
  return Object.values(tree).reduce(
    (total, value) =>
      total + (value && typeof value === 'object' && !Array.isArray(value) ? countLeaves(value) : 1),
    0,
  );
}

console.log(`toast messages rewritten  ${rewritten}`);
console.log(`catalogue keys added      ${countLeaves(catalogue)}`);
console.log(`left alone                ${skipped.length}`);
for (const item of skipped.slice(0, 30)) {
  console.log(`  ${relative(ROOT, item.file)} :: ${item.method} (${item.reason})`);
}

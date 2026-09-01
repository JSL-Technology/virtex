#!/usr/bin/env node
/**
 * Turns the server's hard-coded exception messages into catalogue keys.
 *
 * The API threw 400-odd exceptions carrying Spanish sentences written at the call site:
 *
 *     throw new BadRequestException('El asiento contable no esta balanceado.');
 *
 * and the client displayed them verbatim, so the product's failure states were monolingual even
 * where its interface was not. This rewrites each of them to name a key and hand over its values:
 *
 *     throw new UnprocessableEntityError('JOURNAL_ENTRIES.UNBALANCED', { difference });
 *
 * and emits the Spanish catalogue entry so nothing is lost in the move.
 *
 *   node tools/i18n/extract-backend-messages.mjs --dry     # report only
 *   node tools/i18n/extract-backend-messages.mjs           # rewrite + write the catalogue
 *
 * Deliberately conservative: a throw whose argument is not a literal it can read is reported and
 * left exactly as it was. A codemod that guesses is a codemod that silently changes behaviour.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';

const ROOT = 'apps/backend/api/src/app';
const CATALOGUE = 'apps/backend/api/src/app/i18n/messages/es.json';
const DRY = process.argv.includes('--dry');

/** Nest exception → the key-carrying subclass that replaces it. */
const REPLACEMENTS = {
  BadRequestException: 'BadRequestError',
  NotFoundException: 'NotFoundError',
  ConflictException: 'ConflictError',
  ForbiddenException: 'ForbiddenError',
  UnauthorizedException: 'UnauthorizedError',
  UnprocessableEntityException: 'UnprocessableEntityError',
  InternalServerErrorException: 'InternalServerError',
};

/**
 * Files this must not touch.
 *
 * `localized.exception.ts` defines the replacements; the i18n module is the machinery itself;
 * specs assert on the current wire format and are migrated by hand alongside their subject.
 */
const SKIP = [`${sep}i18n${sep}`, '.spec.ts', '.d.ts'];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    if (!full.endsWith('.ts')) return [];
    if (SKIP.some((needle) => full.includes(needle))) return [];
    return [full];
  });
}

/** `apps/backend/api/src/app/journal-entries/x/y.service.ts` → `JOURNAL_ENTRIES`. */
function namespaceFor(file) {
  const parts = relative(ROOT, file).split(sep);
  return (parts[0] ?? 'COMMON').replace(/-/g, '_').toUpperCase();
}

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'a', 'en', 'y', 'o',
  'que', 'se', 'su', 'sus', 'con', 'por', 'para', 'lo', 'the', 'a', 'an', 'of', 'to', 'is', 'was',
]);

/** `'El asiento contable no esta balanceado.'` → `ASIENTO_CONTABLE_NO_ESTA_BALANCEADO`. */
function slugFor(text) {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, 7);
  const slug = words.join('_').toUpperCase();
  return slug || 'MESSAGE';
}

/**
 * Read one string or template literal starting at `open`, respecting escapes and nesting.
 * Returns null for anything else — a variable, a concatenation, a function call.
 */
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

/**
 * Split a template literal into its message (with `{{name}}` holes) and its parameters.
 *
 * A hole whose expression is a plain identifier or property access keeps that name, because
 * `{{email}}` in a catalogue is readable and `{{p1}}` is not. Anything more complex gets a
 * positional name — the expression still travels, it just is not self-describing.
 */
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
      const simple = /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/.test(expression);
      let name = simple
        ? expression.split(/[?.]/).filter(Boolean).pop()
        : `p${params.length + 1}`;

      // Two holes can derive the same name — `${a.baseCurrency}` and `${b.baseCurrency}` both
      // want `baseCurrency` — and an object literal with a repeated key is a compile error as
      // well as a message that would substitute the same value twice. Numbering keeps the
      // readable name for the first and disambiguates the rest.
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

function unescapeSingle(raw) {
  return raw
    .slice(1, -1)
    .replace(/\\(['"`\\])/g, '$1')
    .replace(/\\n/g, '\n');
}

// ---------------------------------------------------------------------------

const catalogue = {};
const skipped = [];
let rewrittenFiles = 0;
let rewrittenThrows = 0;

function setKey(tree, key, value) {
  const parts = key.split('.');
  let node = tree;
  for (const part of parts.slice(0, -1)) {
    node[part] ??= {};
    node = node[part];
  }
  node[parts.at(-1)] = value;
}

function getKey(tree, key) {
  return key.split('.').reduce((node, part) => (node ? node[part] : undefined), tree);
}

for (const file of sourceFiles(ROOT)) {
  const original = readFileSync(file, 'utf8');
  let source = original;
  const namespace = namespaceFor(file);
  const used = new Set();
  let changed = false;

  for (const [exceptionName, replacement] of Object.entries(REPLACEMENTS)) {
    const pattern = new RegExp(`new\\s+${exceptionName}\\s*\\(`, 'g');
    let match;
    // Rebuilt each pass because the source is rewritten underneath the cursor.
    while ((match = pattern.exec(source))) {
      const open = match.index + match[0].length;
      let cursor = open;
      while (cursor < source.length && /\s/.test(source[cursor])) cursor++;

      const literal = readLiteral(source, cursor);
      if (!literal) {
        skipped.push({ file, exception: exceptionName, at: match.index });
        continue;
      }

      // Only a bare `new X('...')` is rewritten. Extra arguments (a cause, an options bag)
      // change the semantics and are left for a person. A trailing comma before the closing
      // parenthesis is just the formatter's work and does not make it a second argument.
      let after = literal.end;
      while (after < source.length && /\s/.test(source[after])) after++;
      if (source[after] === ',') {
        after++;
        while (after < source.length && /\s/.test(source[after])) after++;
      }
      if (source[after] !== ')') {
        skipped.push({ file, exception: exceptionName, at: match.index, reason: 'extra-args' });
        continue;
      }

      const { message, params } =
        literal.quote === '`'
          ? parseTemplate(literal.raw)
          : { message: unescapeSingle(literal.raw), params: [] };

      if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]{3}/.test(message)) {
        skipped.push({ file, exception: exceptionName, at: match.index, reason: 'not-prose' });
        continue;
      }

      // Deduplicate: the same sentence in the same module is one key.
      let key = `${namespace}.${slugFor(message)}`;
      const existing = getKey(catalogue, key);
      if (existing !== undefined && existing !== message) {
        let suffix = 2;
        while (getKey(catalogue, `${key}_${suffix}`) !== undefined && getKey(catalogue, `${key}_${suffix}`) !== message) {
          suffix++;
        }
        key = `${key}_${suffix}`;
      }
      setKey(catalogue, key, message);

      const paramsLiteral = params.length
        ? `, { ${params.map((p) => (p.name === p.expression ? p.name : `${p.name}: ${p.expression}`)).join(', ')} }`
        : '';
      const call = `new ${replacement}('${key}'${paramsLiteral})`;

      source = source.slice(0, match.index) + call + source.slice(after + 1);
      pattern.lastIndex = match.index + call.length;
      used.add(replacement);
      changed = true;
      rewrittenThrows++;
    }
  }

  if (!changed) continue;
  rewrittenFiles++;

  if (!DRY) {
    source = addImport(file, source, [...used]);
    source = pruneNestImports(source);
    writeFileSync(file, source);
  }
}

/**
 * Add — or extend — the import of the key-carrying exception classes.
 *
 * The path is computed from the file's own depth rather than assumed, and an existing import from
 * the same module is merged into rather than duplicated.
 */
function addImport(file, source, names) {
  if (!names.length) return source;

  const target = join(ROOT, 'i18n', 'localized.exception');
  let specifier = relative(dirname(file), target).split(sep).join('/');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;

  const existing = new RegExp(
    `import\\s*\\{([^}]*)\\}\\s*from\\s*['\"]${specifier.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}['\"];`,
  ).exec(source);

  if (existing) {
    const present = existing[1].split(',').map((name) => name.trim()).filter(Boolean);
    const merged = [...new Set([...present, ...names])].sort();
    return source.replace(existing[0], `import { ${merged.join(', ')} } from '${specifier}';`);
  }

  const statement = `import { ${[...names].sort().join(', ')} } from '${specifier}';`;
  return insertAfterImports(source, statement);
}

/**
 * Insert after the last COMPLETE import statement.
 *
 * "The last line that starts with `import`" lands in the middle of a multi-line import list and
 * produces a syntax error, which is the obvious way to write this and the wrong one.
 */
function insertAfterImports(source, statement) {
  const pattern =
    /^import\s(?:[^;'"]|'[^']*'|"[^"]*")*?from\s*['"][^'"]+['"];|^import\s*['"][^'"]+['"];/gms;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return `${statement}\n${source}`;
  const end = matches.at(-1).index + matches.at(-1)[0].length;
  return `${source.slice(0, end)}\n${statement}${source.slice(end)}`;
}

/**
 * Drop Nest exception classes the file no longer mentions.
 *
 * `noUnusedLocals` is off for this project, so a leftover import would not fail the build — it
 * would simply sit there implying the file still throws something it does not.
 */
function pruneNestImports(source) {
  return source.replace(
    /import\s*\{([^}]*)\}\s*from\s*'@nestjs\/common';/,
    (whole, inner) => {
      const kept = inner
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
        .filter((name) => {
          if (!Object.hasOwn(REPLACEMENTS, name)) return true;
          // Count references outside the import statement itself.
          const uses = source.split(new RegExp(`\\b${name}\\b`)).length - 1;
          return uses > 1;
        });
      if (!kept.length) return '';
      return `import { ${kept.join(', ')} } from '@nestjs/common';`;
    },
  );
}

// ---------------------------------------------------------------------------

if (!DRY) {
  mkdirSync('apps/backend/api/src/app/i18n/messages', { recursive: true });
  let existing = {};
  try {
    existing = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
  } catch {
    existing = {};
  }
  writeFileSync(CATALOGUE, JSON.stringify(deepMerge(existing, catalogue), null, 2) + '\n');
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

function countLeaves(tree) {
  return Object.values(tree).reduce(
    (total, value) =>
      total + (value && typeof value === 'object' && !Array.isArray(value) ? countLeaves(value) : 1),
    0,
  );
}

console.log(`files rewritten     ${rewrittenFiles}`);
console.log(`throws rewritten    ${rewrittenThrows}`);
console.log(`catalogue keys      ${countLeaves(catalogue)}`);
console.log(`left alone          ${skipped.length}`);
for (const item of skipped.slice(0, 25)) {
  console.log(`  ${item.file} :: ${item.exception} (${item.reason ?? 'non-literal'})`);
}

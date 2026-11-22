#!/usr/bin/env node
/**
 * Every placeholder a message has, the code that names the message sends.
 *
 * The API answers with keys, and `LocaleInterceptor` / `I18nExceptionFilter` render them in the
 * reader's language with the parameters that came with the key: `messageParams` on a command's
 * answer (`{ messageKey, messageParams }`) and the second argument of a localized error
 * (`new BadRequestError(key, params)`). A key whose text says `{{imported}}` and arrives without
 * `imported` is rendered as the literal «Se importaron {{imported}} tasas.» — which is what the
 * exchange-rate import answered (audit 2026-11-07, FINB-04): the count was in the body, next to the
 * key, where the interceptor never looks.
 *
 * For every key named by a string literal in the API, this reads its text in every language the
 * server speaks (and its plural forms, which need `count`) and fails when a placeholder is not among
 * the parameters the call site sends. Parameters built at run time (a variable, a spread) cannot be
 * read here and are counted, not judged.
 *
 *     node tools/verify/message-params.mjs            fails on any missing parameter
 *     node tools/verify/message-params.mjs --report   lists them without failing
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const SOURCE = resolve(ROOT, 'apps/backend/api/src/app');
const CATALOGUES = resolve(ROOT, 'apps/backend/api/src/app/i18n/messages');
const REPORT = process.argv.includes('--report');

/** Localized error classes (`i18n/localized.exception.ts`): `(messageKey, params?, code?)`. */
const ERROR_CLASSES = new Set([
  'BadRequestError',
  'UnauthorizedError',
  'ForbiddenError',
  'NotFoundError',
  'ConflictError',
  'UnprocessableEntityError',
  'ServiceUnavailableError',
  'InternalServerError',
]);
const PLURAL = /_(zero|one|two|few|many|other)$/;

// ── The catalogues ──────────────────────────────────────────────────────────────────────────────
const languages = readdirSync(CATALOGUES)
  .filter((file) => /^[a-z]{2}(-[A-Z]{2})?\.json$/.test(file))
  .map((file) => JSON.parse(readFileSync(join(CATALOGUES, file), 'utf8')));

/** key → the placeholders its text has in any language, with `count` for a pluralised key. */
const placeholders = new Map();
const note = (key, names) => {
  const set = placeholders.get(key) ?? new Set();
  for (const name of names) set.add(name);
  placeholders.set(key, set);
};
for (const catalogue of languages) {
  for (const [key, text] of Object.entries(catalogue)) {
    if (typeof text !== 'string') continue;
    // `{{name}}`, `{{name, number}}`, `{{- name}}` (unescaped).
    const names = [...text.matchAll(/\{\{\s*-?\s*([A-Za-z_$][\w$.]*)\s*(?:,[^}]*)?\}\}/g)].map((m) => m[1].split('.')[0]);
    note(key, names);
    if (PLURAL.test(key)) note(key.replace(PLURAL, ''), [...names, 'count']);
  }
}

// ── The call sites ──────────────────────────────────────────────────────────────────────────────
const walk = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts') && !/\.(spec|testing)\.ts$/.test(full) && !full.includes('/testing/')) out.push(full);
  }
  return out;
};

const literalText = (node) =>
  node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null;

/** The names an object literal provides, or null when they cannot be known statically. */
const providedBy = (node) => {
  if (!node) return new Set();
  if (!ts.isObjectLiteralExpression(node)) return null;
  const names = new Set();
  for (const property of node.properties) {
    if (ts.isSpreadAssignment(property)) return null;
    if (ts.isShorthandPropertyAssignment(property)) names.add(property.name.text);
    else if (property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) names.add(property.name.text);
    else return null; // a computed name
  }
  return names;
};

const missing = [];
let checked = 0;
let dynamic = 0;

const judge = (file, source, node, key, provided) => {
  const wanted = placeholders.get(key);
  if (!wanted || wanted.size === 0) return;
  checked++;
  if (provided === null) {
    dynamic++;
    return;
  }
  const absent = [...wanted].filter((name) => !provided.has(name));
  if (absent.length > 0) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    missing.push({ where: `${relative(ROOT, file)}:${line + 1}`, key, absent });
  }
};

for (const file of walk(SOURCE)) {
  if (file.includes('/i18n/')) continue; // the machinery itself
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const visit = (node) => {
    // `{ messageKey: 'x', messageParams: {...} }` — a command's answer, or the contract body of a raw exception.
    if (ts.isObjectLiteralExpression(node)) {
      const property = (name) =>
        node.properties.find((p) => ts.isPropertyAssignment(p) && p.name && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name);
      const keyProperty = property('messageKey');
      const key = keyProperty ? literalText(keyProperty.initializer) : null;
      if (key) {
        const params = property('messageParams') ?? property('params');
        judge(file, source, node, key, params ? providedBy(params.initializer) : new Set());
      }
    }
    // `new BadRequestError('x', {...})`.
    if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ERROR_CLASSES.has(node.expression.text)) {
      const key = literalText(node.arguments?.[0]);
      if (key) judge(file, source, node, key, providedBy(node.arguments?.[1]));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

if (missing.length > 0) {
  const stream = REPORT ? console.log : console.error;
  stream(`${REPORT ? '•' : '✗'} ${missing.length} message(s) would show a raw {{placeholder}}: the call site does not send it.\n`);
  for (const item of missing) stream(`  ${item.where}  ${item.key}  — missing: ${item.absent.join(', ')}`);
  if (!REPORT) process.exit(1);
} else {
  console.log(
    `✓ ${checked} keyed messages with placeholders: every one gets its parameters` +
      (dynamic ? ` (${dynamic} built at run time, not judged).` : '.'),
  );
}

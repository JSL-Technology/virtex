#!/usr/bin/env node
/**
 * Turn the Spanish `message:` literals inside `class-validator` decorators into catalogue keys.
 *
 *   node tools/i18n/externalize-validation-messages.mjs --report
 *   node tools/i18n/externalize-validation-messages.mjs
 *
 * ## What it does
 *
 * Two rewrites, both inside decorator argument lists only:
 *
 *  1. `message: 'La dirección fiscal es obligatoria.'`
 *     → `message: 'VALIDATION.<FILE>.<SLUG>'`, and the Spanish moves into the server catalogue.
 *
 *  2. A BOUNDED decorator with no message at all — `@MaxLength(254)`, `@Min(1)`, `@Length(2, 40)` —
 *     gains one carrying its own bound: `@MaxLength(254, { message:
 *     'VALIDATION.CONSTRAINTS.MAX_LENGTH|{"max":254}' })`. Without it `class-validator` renders
 *     English, and the generic catalogue string cannot name the limit it is talking about
 *     because a `ValidationError` does not carry the constraint's arguments.
 *
 * Unbounded decorators are deliberately left alone: `VALIDATION.CONSTRAINTS.IS_EMAIL` needs no
 * arguments, so the exception factory can resolve it from the constraint name and eleven hundred
 * call sites stay untouched.
 *
 * ## Why the key is namespaced by file
 *
 * Two DTOs both say "El nombre es obligatorio", and both are right — but one is a customer's name
 * and one is a warehouse's, and a translator needs to be able to tell them apart later without
 * reading the code. Namespacing by DTO costs a few duplicate strings and keeps that possible.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename } from 'node:path';

const CATALOGUE = 'apps/backend/api/src/app/i18n/messages/es.json';
const REPORT = process.argv.includes('--report');

/** Decorators whose numeric arguments must reach the message, with the parameter names to use. */
const BOUNDED = {
  MaxLength: ['max'],
  MinLength: ['min'],
  Length: ['min', 'max'],
  Min: ['min'],
  Max: ['max'],
  ArrayMinSize: ['min'],
  ArrayMaxSize: ['max'],
};

const files = execSync(
  "find apps/backend/api/src -name '*.ts' -not -name '*.spec.ts'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

function slug(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()
    .split('_')
    // Filler words carry no meaning in a key and push the useful part past readability.
    .filter((word) => !['EL','LA','LOS','LAS','UN','UNA','DE','DEL','QUE','SE','ES','Y','O','A','EN','SER','LE'].includes(word))
    .slice(0, 8)
    .join('_') || 'MESSAGE';
}

function namespaceFor(file) {
  return basename(file)
    .replace(/\.(dto|entity|service|controller|validator)?\.ts$/, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase();
}

/**
 * The character ranges covered by decorator argument lists, `@Name(` … matching `)`.
 *
 * Paren-matched rather than regex-bounded because a decorator's arguments routinely contain
 * parentheses of their own — `@Matches(/^[A-Z]{2}(-\d+)?$/, { message: … })` — and a lazy
 * `\(.*?\)` stops at the first one, in the middle of the value it was meant to skip.
 *
 * Quotes and regular-expression literals are tracked so a `)` inside a string never closes the
 * range. Comments are not: a decorator argument list containing a comment with an unbalanced
 * parenthesis is not a thing this codebase has, and pretending otherwise costs more than it buys.
 */
function decoratorArgumentRanges(source) {
  const ranges = [];
  const opener = /@[A-Za-z_$][\w$]*\s*\(/g;
  let match;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    let quote = null;
    for (let index = match.index + match[0].length - 1; index < source.length; index++) {
      const char = source[index];
      if (quote) {
        if (char === '\\') index++;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        quote = char;
        continue;
      }
      if (char === '(') depth++;
      else if (char === ')') {
        depth--;
        if (depth === 0) {
          ranges.push([match.index, index]);
          opener.lastIndex = index;
          break;
        }
      }
    }
  }
  return ranges;
}

/** Apply `pattern` only where a match starts inside one of `ranges`. */
function replaceWithin(source, ranges, pattern, replacer) {
  return source.replace(pattern, (...args) => {
    const offset = args[args.length - 2];
    const inside = ranges.some(([start, end]) => offset > start && offset < end);
    return inside ? replacer(...args) : args[0];
  });
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));
catalogue.VALIDATION ??= {};

let rewritten = 0;
let bounded = 0;
const touched = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  let next = source;
  const namespace = namespaceFor(file);
  const used = new Set();

  // (1) message: '<spanish>' inside a decorator argument list.
  //
  // Scoped to decorator arguments deliberately: `message:` also names the prose in a response
  // payload (`return { message: 'Se ha cerrado la sesión del usuario.' }`), which is a different
  // problem with a different fix — that one becomes `messageKey` and is resolved by the response
  // interceptor. Rewriting it here would leave a key sitting in a field nothing translates.
  const decoratorRanges = decoratorArgumentRanges(next);
  next = replaceWithin(
    next,
    decoratorRanges,
    /(\bmessage:\s*)(['"])((?:(?!\2)[^\\]|\\.)*)\2/g,
    (whole, prefix, quote, text) => {
      // Already a key, or not prose: leave it.
      if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+/.test(text)) return whole;
      if (!/[a-záéíóúñ]/i.test(text)) return whole;

      let key = `VALIDATION.${namespace}.${slug(text)}`;
      let suffix = 2;
      while (used.has(key) && catalogue.VALIDATION?.[namespace]?.[key.split('.').pop()] !== text) {
        key = `VALIDATION.${namespace}.${slug(text)}_${suffix++}`;
      }
      used.add(key);

      catalogue.VALIDATION[namespace] ??= {};
      catalogue.VALIDATION[namespace][key.split('.').pop()] = text;
      rewritten++;
      return `${prefix}'${key}'`;
    },
  );

  // (2) A bounded decorator with no options object at all.
  for (const [decorator, names] of Object.entries(BOUNDED)) {
    const pattern = new RegExp(`@${decorator}\\(\\s*(-?\\d+)\\s*(?:,\\s*(-?\\d+)\\s*)?\\)`, 'g');
    next = next.replace(pattern, (whole, first, second) => {
      const values = second === undefined ? [first] : [first, second];
      if (values.length !== names.length) return whole;
      const params = Object.fromEntries(names.map((name, index) => [name, Number(values[index])]));
      const key = `VALIDATION.CONSTRAINTS.${decorator
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toUpperCase()}`;
      bounded++;
      return `@${decorator}(${values.join(', ')}, { message: '${key}|${JSON.stringify(params)}' })`;
    });
  }

  if (next !== source) {
    touched.push(file);
    if (!REPORT) writeFileSync(file, next);
  }
}

if (!REPORT) {
  writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);
}

console.log(
  `${REPORT ? '[report] ' : ''}${rewritten} literal messages keyed, ` +
    `${bounded} bounded constraints given one, across ${touched.length} files`,
);

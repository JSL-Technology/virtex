#!/usr/bin/env node
/**
 * Turn the prose in response payloads into catalogue keys.
 *
 *   node tools/i18n/externalize-response-messages.mjs --report
 *   node tools/i18n/externalize-response-messages.mjs
 *
 * `return { message: 'Sesión revocada exitosamente.' }` is a sentence chosen by the server for a
 * reader whose language the server knows and did not ask. It becomes
 * `return { messageKey: 'AUTH.SESSION_REVOKED' }`, and `LocaleInterceptor` renders it in the
 * reader's language on the way out.
 *
 * Renaming the FIELD as well as the value is the point: `message` is the finished string, and a
 * key sitting in a field that nothing resolves would reach the client as
 * `AUTH.SESSION_REVOKED` — a regression that reads like a translation bug rather than a wiring
 * one. `messageKey` names what it holds, and the type `LocalizedMessage` makes the compiler agree.
 *
 * Decorator arguments are excluded: `@IsNotEmpty({ message: … })` is a validation message, which
 * `externalize-validation-messages.mjs` handles with a different mechanism. Comments are excluded
 * too — a documentation example is not a call site.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname } from 'node:path';

const CATALOGUE = 'apps/backend/api/src/app/i18n/messages/es.json';
const REPORT = process.argv.includes('--report');

const files = execSync(
  "find apps/backend/api/src -name '*.ts' -not -name '*.spec.ts'",
  { encoding: 'utf8' },
)
  .split('\n')
  .filter(Boolean);

const FILLER = new Set(['EL','LA','LOS','LAS','UN','UNA','DE','DEL','QUE','SE','ES','Y','O','A','EN','SER','LE','HA','SIDO','SU','AL','THE','A','AN','TO','OF','IS']);

function slug(text) {
  return (
    text
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .toUpperCase()
      .split('_')
      .filter((word) => word && !FILLER.has(word))
      .slice(0, 8)
      .join('_') || 'MESSAGE'
  );
}

/**
 * The top-level catalogue section for a file: its feature directory.
 *
 * `apps/backend/api/src/app/auth/services/session.service.ts` → `AUTH`. Grouping by feature
 * rather than by file keeps the section count equal to the module count, which is what a
 * translator is willing to read.
 */
function sectionFor(file) {
  const parts = file.split('/');
  const index = parts.indexOf('app');
  const feature = index >= 0 && parts[index + 1] ? parts[index + 1] : basename(dirname(file));
  return feature.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
}

/** Ranges covered by decorator argument lists and by comments — both off limits. */
function excludedRanges(source) {
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

  for (const comment of source.matchAll(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g)) {
    ranges.push([comment.index, comment.index + comment[0].length]);
  }

  return ranges;
}

const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8'));

let rewritten = 0;
const touched = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const excluded = excludedRanges(source);
  const section = sectionFor(file);

  const next = source.replace(
    /(\bmessage:\s*)(['"])((?:(?!\2)[^\\]|\\.)*)\2/g,
    (whole, prefix, quote, text, offset) => {
      if (excluded.some(([start, end]) => offset > start && offset < end)) return whole;
      if (/^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+/.test(text)) return whole;
      if (!/[a-zA-Z]/.test(text)) return whole;

      catalogue[section] ??= {};
      let name = slug(text);
      let suffix = 2;
      while (catalogue[section][name] !== undefined && catalogue[section][name] !== text) {
        name = `${slug(text)}_${suffix++}`;
      }
      catalogue[section][name] = text;
      rewritten++;
      return `messageKey: '${section}.${name}'`;
    },
  );

  if (next !== source) {
    touched.push(file);
    if (!REPORT) writeFileSync(file, next);
  }
}

if (!REPORT) writeFileSync(CATALOGUE, `${JSON.stringify(catalogue, null, 2)}\n`);

console.log(
  `${REPORT ? '[report] ' : ''}${rewritten} response messages keyed across ${touched.length} files`,
);

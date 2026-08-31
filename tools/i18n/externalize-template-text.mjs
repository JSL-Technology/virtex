#!/usr/bin/env node
/**
 * Moves the literal copy out of the templates and into the catalogue.
 *
 * 1,228 text nodes and 113 human-readable attributes were written directly into the Angular
 * templates — 126 of the 167 files never referenced `translate` at all — and they were not even
 * consistently one language: 529 Spanish, 118 English, whole pages of the accounting module in
 * English inside a product whose default is Spanish.
 *
 *   node tools/i18n/externalize-template-text.mjs --dry           # report
 *   node tools/i18n/externalize-template-text.mjs                 # rewrite + write es.json
 *   node tools/i18n/externalize-template-text.mjs --hbs           # the mail templates instead
 *
 * ## One sentence, one key — the distinction that matters
 *
 * A text node containing interpolation is still ONE sentence, so it becomes ONE key with named
 * parameters:
 *
 *     Hola {{name}}, tu factura vence el {{date}}.
 *       -> {{ 'X.GREETING' | translate: { name: name, date: date } }}
 *          "Hola {{name}}, tu factura vence el {{date}}."
 *
 * That is safe and is what a translator needs: the whole sentence, with holes they can reorder.
 *
 * What is NOT safe is a sentence broken across inline elements:
 *
 *     Mostrando <strong>{{ shown }}</strong> de <strong>{{ total }}</strong> usuarios
 *
 * Three separate text nodes, and turning each into its own key produces `SHOWING` + `OF` +
 * `USERS` — the sentence-fragment antipattern, which reads correctly only in a language with
 * Spanish word order. This codebase already had exactly those three keys sitting unused while
 * the template wrote the sentence out by hand. Those are REPORTED, and a person rewrites them as
 * one key.
 *
 * The same caution applies everywhere else: anything it cannot read confidently is left alone and
 * counted. A codemod that guesses at meaning produces a catalogue nobody can trust.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

const DRY = process.argv.includes('--dry');
const HBS = process.argv.includes('--hbs');

const CONFIG = HBS
  ? {
      root: 'apps/backend/api/src/app/mail/templates',
      extension: '.hbs',
      catalogue: 'apps/backend/api/src/app/i18n/messages/es.json',
      namespace: (file) => `MAIL.${basename(file, '.hbs').replace(/-/g, '_').toUpperCase()}`,
      wrap: (key) => `{{t '${key}'}}`,
      wrapAttribute: (key) => `{{t '${key}'}}`,
      wrapWithParams: (key, params) =>
        `{{t '${key}'${params.map((p) => ` ${p.name}=${p.expression}`).join('')}}}`,
      // Handlebars expressions are `{{ }}` too, so an interpolated block looks the same.
      skipFiles: [],
    }
  : {
      root: 'apps/core/client-web/src/app',
      extension: '.html',
      catalogue: 'apps/core/client-web/src/assets/i18n/es.json',
      namespace: namespaceForAngular,
      wrap: (key) => `{{ '${key}' | translate }}`,
      wrapAttribute: (key) => `{{ '${key}' | translate }}`,
      wrapWithParams: (key, params) =>
        `{{ '${key}' | translate: { ${params
          .map((p) => `${p.name}: ${p.expression}`)
          .join(', ')} } }}`,
      skipFiles: [],
    };

/**
 * `features/settings/user-management/user-management.page.html` → `USER_MANAGEMENT`.
 *
 * The component folder rather than the whole path: `SETTINGS.USER_MANAGEMENT.TABLE.NAME` reads
 * better than `FEATURES.SETTINGS.USER_MANAGEMENT.USER_MANAGEMENT_PAGE.TABLE.NAME`, and the folder
 * is what a developer looking for a string actually knows.
 */
function namespaceForAngular(file) {
  const parts = relative(CONFIG.root, file).split(sep);
  const folder = parts.at(-2) ?? parts.at(-1);
  const area = parts[0] === 'features' || parts[0] === 'layout' ? parts[1] : parts[0];
  const name = (folder ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  const areaName = (area ?? 'common').replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
  return areaName === name ? name : `${areaName}.${name}`;
}

const STOP_WORDS = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'del', 'al', 'en', 'y', 'o',
  'que', 'se', 'su', 'sus', 'con', 'por', 'para', 'lo', 'the', 'a', 'an', 'of', 'to', 'is',
]);

function slugFor(text) {
  const words = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    .slice(0, 6);
  return words.join('_').toUpperCase() || 'TEXT';
}

function files(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return files(full);
    return full.endsWith(CONFIG.extension) ? [full] : [];
  });
}

/** Regions of the source that must not be touched: comments, scripts, styles. */
function maskedRanges(source) {
  const ranges = [];
  const patterns = [
    /<!--[\s\S]*?-->/g,
    /<script\b[\s\S]*?<\/script>/gi,
    /<style\b[\s\S]*?<\/style>/gi,
    /<svg\b[\s\S]*?<\/svg>/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

const inRange = (ranges, index) => ranges.some(([start, end]) => index >= start && index < end);

const HAS_LETTERS = /[A-Za-zÁÉÍÓÚÑÜáéíóúñü]{3}/;

/**
 * True for a text node worth translating.
 *
 * Excludes pure punctuation, numbers, entity-only nodes, and anything that is already an
 * expression — the caller has stripped those, but a template can also carry a bare `&nbsp;`
 * or a units suffix that is the same in every language.
 */
function isProse(text) {
  if (!HAS_LETTERS.test(text)) return false;
  // A single all-caps token is usually an acronym or a code (NCF, RNC, ITBIS, SKU) that reads the
  // same in every language. Two or more words is prose.
  if (/^[A-Z0-9/&.\-]+$/.test(text) && !text.includes(' ')) return false;
  return true;
}


/**
 * Inline elements that can carry a fragment of a sentence.
 *
 * A text node sitting next to one of these is probably half of something, and joining the halves
 * is not this tool's job — it is a person's, because the result needs a judgement about where the
 * emphasis belongs in each language.
 */
const INLINE_TAGS = /^<\/?(strong|b|em|i|u|span|a|small|code|mark|abbr|sup|sub|br)\b/i;

/**
 * True when the text node abuts an inline element AND that element has prose on its other side —
 * i.e. this node is one fragment of a sentence that continues past a tag.
 */
function isSplitSentence(source, openIndex, closeIndex) {
  const before = source.slice(Math.max(0, openIndex - 220), openIndex + 1);
  const after = source.slice(closeIndex - 1, closeIndex + 220);

  const previousTag = /<[^<>]*>\s*$/.exec(before)?.[0] ?? '';
  const nextTag = /^<[^<>]*>/.exec(after)?.[0] ?? '';

  // Prose on the far side of an inline tag means the sentence continues there.
  if (INLINE_TAGS.test(previousTag)) {
    const preceding = /([^<>]*)<[^<>]*>\s*$/.exec(before)?.[1] ?? '';
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(preceding.replace(/\{\{[^}]*\}\}/g, ''))) return true;
  }
  if (INLINE_TAGS.test(nextTag)) {
    const following = /^<[^<>]*>([^<>]*)/.exec(after)?.[1] ?? '';
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(following.replace(/\{\{[^}]*\}\}/g, ''))) return true;
  }
  return false;
}

/**
 * Turn one text node into a message with `{{name}}` holes and the parameter map that fills them.
 *
 * Returns null when an expression is too complex to name — a pipe chain, a ternary, a method
 * call — because a parameter called `p1` whose value is `a ? b : c` is worse for a translator
 * than leaving the line for a person to look at.
 */
function toParameterised(rawText, interpolations) {
  const params = [];
  let message = '';
  let cursor = 0;

  for (const hole of interpolations) {
    message += rawText.slice(cursor, hole.index);
    const expression = hole[1].trim();

    if (!/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\(\))*$/.test(expression)) return null;

    let name = expression.split(/[?.()]/).filter(Boolean).pop();
    if (params.some((existing) => existing.name === name)) {
      let ordinal = 2;
      while (params.some((existing) => existing.name === `${name}${ordinal}`)) ordinal++;
      name = `${name}${ordinal}`;
    }
    params.push({ name, expression });
    message += `{{${name}}}`;
    cursor = hole.index + hole[0].length;
  }
  message += rawText.slice(cursor);

  const trimmed = message.trim();
  if (!trimmed) return null;

  const leading = message.slice(0, message.indexOf(trimmed[0]));
  const trailing = message.slice(message.lastIndexOf(trimmed.at(-1)) + 1);
  return { message: trimmed, params, leading, trailing };
}

const catalogue = {};
const report = { rewritten: 0, attributes: 0, mixed: [], skipped: [] };

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
  return key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), tree);
}

/** Reserve a key for `text` inside `namespace`, reusing it when the same string recurs. */
function keyFor(namespace, text) {
  const base = `${namespace}.${slugFor(text)}`;
  const existing = getKey(catalogue, base);
  if (existing === undefined || existing === text) {
    setKey(catalogue, base, text);
    return base;
  }
  let ordinal = 2;
  while (true) {
    const candidate = `${base}_${ordinal}`;
    const found = getKey(catalogue, candidate);
    if (found === undefined || found === text) {
      setKey(catalogue, candidate, text);
      return candidate;
    }
    ordinal++;
  }
}

for (const file of files(CONFIG.root)) {
  const original = readFileSync(file, 'utf8');
  const namespace = CONFIG.namespace(file);
  const masked = maskedRanges(original);

  // Collected first, applied last: rewriting as we scan invalidates every later index.
  const edits = [];

  // ---- Text nodes -----------------------------------------------------------
  for (const match of original.matchAll(/>([^<>]*)</g)) {
    const start = match.index + 1;
    if (inRange(masked, start)) continue;

    const rawText = match[1];
    const trimmed = rawText.trim();
    if (!trimmed) continue;

    // A control-flow header (`@if (...) {`) or a stray brace is not prose in any form.
    if (/@[a-z]+\s*[({]|^\s*\}/.test(rawText)) continue;

    const interpolations = [...rawText.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)];
    const literalPart = rawText.replace(/\{\{[^}]*\}\}/g, '\u0000').trim();

    if (!isProse(literalPart.replace(/\u0000/g, ' '))) continue;

    if (interpolations.length > 0) {
      // A sentence split across inline elements cannot be recovered from here: the pieces are
      // separate text nodes and this only sees one of them at a time. Reported for a person.
      if (isSplitSentence(original, match.index, match.index + match[0].length)) {
        report.mixed.push({ file, text: trimmed.slice(0, 110) });
        continue;
      }

      const converted = toParameterised(rawText, interpolations);
      if (!converted) {
        report.mixed.push({ file, text: trimmed.slice(0, 110) });
        continue;
      }

      const key = keyFor(namespace, converted.message);
      edits.push({
        start,
        end: start + rawText.length,
        text: converted.leading + CONFIG.wrapWithParams(key, converted.params) + converted.trailing,
      });
      report.rewritten++;
      continue;
    }

    if (!isProse(trimmed)) continue;

    const key = keyFor(namespace, trimmed);
    const leading = rawText.slice(0, rawText.indexOf(trimmed[0]));
    const trailing = rawText.slice(rawText.lastIndexOf(trimmed.at(-1)) + 1);
    edits.push({ start, end: start + rawText.length, text: leading + CONFIG.wrap(key) + trailing });
    report.rewritten++;
  }

  // ---- Human-readable attributes -------------------------------------------
  const ATTRS = /(\s)(placeholder|title|alt|aria-label|aria-description|label)(\s*=\s*)"([^"]*)"/g;
  for (const match of original.matchAll(ATTRS)) {
    if (inRange(masked, match.index)) continue;
    const [whole, space, name, equals, value] = match;
    const trimmed = value.trim();
    if (!isProse(trimmed) || /\{\{|\}\}/.test(value)) continue;

    const key = keyFor(namespace, trimmed);
    // Bound, because a translated attribute is an expression rather than a literal.
    const replacement = `${space}[attr.${name}]="'${key}' | translate"`;
    const hbsReplacement = `${space}${name}${equals}"${CONFIG.wrapAttribute(key)}"`;
    edits.push({
      start: match.index,
      end: match.index + whole.length,
      text: HBS ? hbsReplacement : replacement,
    });
    report.attributes++;
  }

  if (!edits.length) continue;

  edits.sort((a, b) => b.start - a.start);
  let source = original;
  for (const edit of edits) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }

  if (!DRY) writeFileSync(file, source);
}

// ---------------------------------------------------------------------------

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
  const existing = JSON.parse(readFileSync(CONFIG.catalogue, 'utf8'));
  writeFileSync(CONFIG.catalogue, JSON.stringify(deepMerge(existing, catalogue), null, 2) + '\n');
}

function countLeaves(tree) {
  return Object.values(tree).reduce(
    (total, value) =>
      total + (value && typeof value === 'object' && !Array.isArray(value) ? countLeaves(value) : 1),
    0,
  );
}

console.log(`text nodes externalised   ${report.rewritten}`);
console.log(`attributes externalised   ${report.attributes}`);
console.log(`catalogue keys added      ${countLeaves(catalogue)}`);
console.log(`mixed blocks for a human  ${report.mixed.length}`);
for (const item of report.mixed.slice(0, 60)) {
  console.log(`  ${relative(CONFIG.root, item.file)}: ${item.text}`);
}

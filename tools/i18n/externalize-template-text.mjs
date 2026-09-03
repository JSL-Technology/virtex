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

/**
 * Handlebars templates live in two places: the transactional e-mails, and the fiscal documents
 * the product prints. Both are read by a customer, so both are scanned — `roots` rather than a
 * single `root`, because the invoice PDF was invisible to the first version of this and shipped
 * its Spanish headings to every market.
 */
const CONFIG = HBS
  ? {
      roots: [
        'apps/backend/api/src/app/mail/templates',
        'apps/backend/api/src/app/invoices/templates',
      ],
      extension: '.hbs',
      catalogue: 'apps/backend/api/src/app/i18n/messages/es.json',
      namespace: (file) =>
        file.includes(`invoices${sep}templates`)
          ? 'INVOICE.PDF'
          : `MAIL.${basename(file, '.hbs').replace(/-/g, '_').toUpperCase()}`,
      wrap: (key) => `{{t '${key}'}}`,
      wrapAttribute: (key) => `{{t '${key}'}}`,
      wrapWithParams: (key, params) =>
        `{{t '${key}'${params.map((p) => ` ${p.name}=${p.expression}`).join('')}}}`,
      // Handlebars expressions are `{{ }}` too, so an interpolated block looks the same.
      skipFiles: [],
    }
  : {
      roots: ['apps/core/client-web/src/app'],
      extension: '.html',
      // Also read `template:` bodies inside components — reported, never rewritten. See scanUnits.
      inlineTemplates: true,
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
  const parts = relative(CONFIG.roots[0], file).split(sep);
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
    if (full.endsWith(CONFIG.extension)) return [full];
    // Inline templates are read too. A `template:` string in a component is markup a reader sees,
    // but it is not an `.html` file, so for a long time it was the one place literal text could
    // hide from this scanner — and 25 components used it, including eleven whole settings pages
    // whose headings, descriptions and feature lists were Spanish prose nobody could translate.
    return CONFIG.inlineTemplates && full.endsWith('.ts') && !full.endsWith('.spec.ts')
      ? [full]
      : [];
  });
}

/**
 * What the scanner actually reads: a whole `.html` file, or just the template region of a `.ts`.
 *
 * An inline template is reported but never rewritten. Editing markup inside a TypeScript string
 * literal means getting escaping, indentation and backticks right in a file the compiler also
 * reads, and a codemod that gets that wrong breaks the build. Reporting is enough: the spec
 * demands zero, so a literal there fails the build and a person fixes it in place.
 */
function scanUnits() {
  return CONFIG.roots.flatMap((root) =>
    files(root).flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      if (file.endsWith(CONFIG.extension)) return [{ file, source, writable: true }];
      const match = source.match(/\n  template: `([\s\S]*?)`,\n/);
      return match ? [{ file, source: match[1], writable: false }] : [];
    }),
  );
}

/**
 * Regions of the source that must not be touched.
 *
 * Comments, scripts, styles and inline SVG — and, crucially, the QUOTED VALUE OF EVERY
 * ATTRIBUTE. An Angular binding is an expression, and expressions contain `>` and `<`:
 *
 *     [class.usage-bar__fill--warning]="(metric.used / metric.limit) >= 0.8 && (…) < 1"
 *
 * A scan for `>…<` reads the `>=` and the `<` as tag boundaries and "externalises" the comparison
 * in between, producing a template that does not parse. It did exactly that to two files before
 * this mask existed. Attribute values are handled by their own pass, which knows which attributes
 * hold prose.
 */
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

  for (const range of attributeValueRanges(source)) ranges.push(range);
  for (const range of controlFlowHeaderRanges(source)) ranges.push(range);
  if (HBS) for (const range of mustacheRanges(source)) ranges.push(range);
  return ranges;
}

/**
 * Handlebars expressions, in HBS mode.
 *
 * A block partial opens with `{{#> shell title=(t 'KEY')}}` — and that `>` sits in TEXT position,
 * so a scan for `>…<` reads it as a tag boundary and reports the rest of the line as literal
 * prose. It did exactly that to all ten mail templates the moment they started sharing a layout:
 * fourteen "untranslated text nodes" that were nothing but partial syntax.
 *
 * Comments (`{{!-- … --}}`) are inside these ranges too, which is the other thing that matters:
 * a comment explaining a partial is documentation, not copy.
 */
function mustacheRanges(source) {
  const ranges = [];
  for (let index = 0; index < source.length - 1; index++) {
    if (source[index] !== '{' || source[index + 1] !== '{') continue;
    let depth = 0;
    let cursor = index;
    while (cursor < source.length) {
      if (source[cursor] === '{') depth++;
      else if (source[cursor] === '}') {
        depth--;
        if (depth === 0) break;
      }
      cursor++;
    }
    if (depth !== 0) break; // Unbalanced: leave the rest of the file alone.
    ranges.push([index, cursor + 1]);
    index = cursor;
  }
  return ranges;
}

/**
 * Angular control-flow headers: `@if (…) {`, `@for (…; …) {`, `@switch (…) {`.
 *
 * These sit in TEXT position, not inside a tag, and their conditions contain comparisons:
 *
 *     @if (inv.balance > 0 && inv.balance < inv.total) {
 *
 * A scan for `>…<` reads that `>` and that `<` as tag boundaries and externalises the middle of
 * the condition — producing a template that does not compile. Same failure as the one in
 * attribute values, in the one other place an expression lives outside quotes.
 */
function controlFlowHeaderRanges(source) {
  const ranges = [];
  const pattern = /@(if|else\s+if|for|switch|case|defer|placeholder|loading|empty|let)\b\s*\(/g;

  for (const match of source.matchAll(pattern)) {
    let depth = 0;
    let index = match.index + match[0].length - 1;
    while (index < source.length) {
      const char = source[index];
      if (char === '"' || char === "'") {
        index++;
        while (index < source.length && source[index] !== char) index++;
      } else if (char === '(') depth++;
      else if (char === ')') {
        depth--;
        if (depth === 0) break;
      }
      index++;
    }
    ranges.push([match.index, Math.min(index + 1, source.length)]);
  }
  return ranges;
}

/**
 * Every quoted attribute value, found by scanning rather than by a regex.
 *
 * A regex for a tag (`/<[a-z][^]*?>/`) stops at the first `>` — and the first `>` in
 * `[class.warn]="(a / b) >= 0.8 && (a / b) < 1"` is INSIDE the quotes, so the tag appears to end
 * mid-attribute and the rest goes unmasked. That is the same class of mistake as the one this
 * mask exists to prevent, one level up. Tracking quote state while walking is the only way to
 * know where a tag really ends.
 */
function attributeValueRanges(source) {
  const ranges = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '<') {
      index++;
      continue;
    }
    // Not a tag: `a < b` in text. Only a name, a closing slash or a doctype starts one.
    if (!/[a-zA-Z@!/]/.test(source[index + 1] ?? '')) {
      index++;
      continue;
    }

    index++;
    while (index < source.length && source[index] !== '>') {
      const quote = source[index];
      if (quote === '"' || quote === "'") {
        const start = index;
        index++;
        while (index < source.length && source[index] !== quote) index++;
        ranges.push([start, Math.min(index + 1, source.length)]);
      }
      index++;
    }
    index++;
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
  // Entities first: `&nbsp;·&nbsp;` is decoration between two expressions, but the letters in
  // `nbsp` make it look like a word.
  const prose = text.replace(/&[a-z]+;|&#x?[0-9a-f]+;/gi, ' ');
  if (!HAS_LETTERS.test(prose)) return false;
  // A single all-caps token is usually an acronym or a code (NCF, RNC, ITBIS, SKU) that reads the
  // same in every language. Two or more words is prose.
  if (/^[A-Z0-9/&.\-]+$/.test(prose.trim()) && !prose.trim().includes(' ')) return false;
  // A translation key is the opposite of prose: it is already the externalised form. Components
  // that resolve their own inputs take one as a plain attribute (`title="SETTINGS.X.TITLE"`), and
  // reading that as text would have produced `'SETTINGS.X.SETTINGS_X_TITLE' | translate` — a key
  // wrapping a key, resolving to nothing. The codemod must be a no-op on work it already did.
  if (isTranslationKey(prose.trim())) return false;
  return true;
}

/**
 * `SECTION.SUBSECTION.KEY` — dotted SCREAMING_SNAKE, two or more segments.
 *
 * Two segments is the minimum on purpose: a lone `TOTAL` is a word a reader sees, and the acronym
 * rule above already covers it.
 */
function isTranslationKey(text) {
  return /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/.test(text);
}


/**
 * Inline elements that can carry a fragment of a sentence.
 *
 * A text node sitting next to one of these is probably half of something, and joining the halves
 * is not this tool's job — it is a person's, because the result needs a judgement about where the
 * emphasis belongs in each language.
 */

/**
 * Find `{{ … }}` spans, matching braces rather than scanning for the first `}}`.
 *
 * `{{ 'KEY' | translate: { name: value } }}` contains a nested object literal, so a regex that
 * stops at the first `}}` misses it entirely — and a text node that "contains no interpolation"
 * is then treated as plain prose and wrapped a second time. Running the extraction twice would
 * have produced `{{ '…' | translate }}` inside another `{{ '…' | translate }}`, which is the kind
 * of damage a codemod must not be able to do on a re-run.
 */
function findInterpolations(text) {
  const found = [];
  for (let index = 0; index < text.length - 1; index++) {
    if (text[index] !== '{' || text[index + 1] !== '{') continue;

    let depth = 0;
    let cursor = index;
    while (cursor < text.length) {
      if (text[cursor] === '{') depth++;
      else if (text[cursor] === '}') {
        depth--;
        if (depth === 0) break;
      }
      cursor++;
    }
    if (depth !== 0) break; // Unbalanced: leave the whole node alone.

    const whole = text.slice(index, cursor + 1);
    found.push({ 0: whole, 1: whole.slice(2, -2).trim(), index });
    index = cursor;
  }
  return found;
}

function stripInterpolations(text) {
  let out = '';
  let cursor = 0;
  for (const hole of findInterpolations(text)) {
    out += text.slice(cursor, hole.index) + '\u0000';
    cursor = hole.index + hole[0].length;
  }
  return out + text.slice(cursor);
}

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


/**
 * Find the text nodes, by walking the source rather than matching `>([^<>]*)<`.
 *
 * Three separate bugs came out of that regex, all the same mistake: `>` and `<` are ordinary
 * characters inside an expression, and the expression can live in an attribute value
 * (`[class.warn]="a >= 0.8"`), in a control-flow header (`@if (a > 0 && a < b)`), or in an
 * interpolation (`{{ a > 0 ? 'x' : 'y' }}`). Each one was read as a tag boundary, and the
 * "text node" between them was a piece of somebody's condition. Two templates stopped compiling.
 *
 * Masking the first two got most of it; the third cannot be masked, because an interpolation is
 * legitimately PART of a text node — `Hola {{name}}, bienvenido` is one sentence. So the scan has
 * to know the difference: skip over an interpolation, and keep going to the real `<`.
 *
 * Yields the same shape as the regex it replaces — `{ index, 0: whole, 1: text }`, where `index`
 * points at the opening `>` and `0` is the full `>text<` span. Both are used: `1` is the text,
 * and `index + 0.length` is what `isSplitSentence` needs to look at the tag on the far side.
 */
function textNodes(source, masked) {
  const nodes = [];
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '>' || inRange(masked, index)) {
      index++;
      continue;
    }

    const open = index;
    let cursor = index + 1;
    let closed = false;

    while (cursor < source.length) {
      // An interpolation is part of the text, not a boundary. Step over it whole.
      if (source[cursor] === '{' && source[cursor + 1] === '{') {
        let depth = 0;
        while (cursor < source.length) {
          if (source[cursor] === '{') depth++;
          else if (source[cursor] === '}') {
            depth--;
            if (depth === 0) break;
          }
          cursor++;
        }
        cursor++;
        continue;
      }
      if (source[cursor] === '<' || source[cursor] === '>') {
        closed = source[cursor] === '<';
        break;
      }
      cursor++;
    }

    if (closed) {
      nodes.push({
        index: open,
        0: source.slice(open, cursor + 1),
        1: source.slice(open + 1, cursor),
      });
    }
    index = cursor;
  }
  return nodes;
}

const catalogue = {};
const report = { rewritten: 0, attributes: 0, mixed: [], skipped: [], textSites: [], attributeSites: [] };

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

for (const unit of scanUnits()) {
  const { file, source: original } = unit;

  // An explicit opt-out, for the one thing in the product that must NOT be translated: the
  // wordmark. A brand is a name, not a word, and `no-hardcoded-strings.spec.ts` honours the same
  // marker so the exception is declared in one place and visible in the file it applies to.
  if (original.includes('i18n-ignore-file')) continue;

  const namespace = CONFIG.namespace(file);
  const masked = maskedRanges(original);

  // Collected first, applied last: rewriting as we scan invalidates every later index.
  const edits = [];

  // ---- Text nodes -----------------------------------------------------------
  for (const match of textNodes(original, masked)) {
    const start = match.index + 1;
    if (inRange(masked, start)) continue;

    const rawText = match[1];
    const trimmed = rawText.trim();
    if (!trimmed) continue;

    // A control-flow header (`@if (...) {`) or a stray brace is not prose in any form.
    if (/@[a-z]+\s*[({]|^\s*\}/.test(rawText)) continue;

    const interpolations = findInterpolations(rawText);
    const literalPart = stripInterpolations(rawText).trim();

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
      report.textSites.push({ file, text: trimmed.slice(0, 80) });
      continue;
    }

    if (!isProse(trimmed)) continue;

    const key = keyFor(namespace, trimmed);
    const leading = rawText.slice(0, rawText.indexOf(trimmed[0]));
    const trailing = rawText.slice(rawText.lastIndexOf(trimmed.at(-1)) + 1);
    edits.push({ start, end: start + rawText.length, text: leading + CONFIG.wrap(key) + trailing });
    report.rewritten++;
    report.textSites.push({ file, text: trimmed.slice(0, 80) });
  }

  // ---- Human-readable attributes -------------------------------------------
  const ATTRS = /(\s)(placeholder|title|alt|aria-label|aria-description|label)(\s*=\s*)"([^"]*)"/g;
  for (const match of original.matchAll(ATTRS)) {
    if (inRange(masked, match.index)) continue;
    const [whole, space, name, equals, value] = match;
    const trimmed = value.trim();
    if (!isProse(trimmed) || /\{\{|\}\}/.test(value)) continue;

    const key = keyFor(namespace, trimmed);

    // Property binding, not `[attr.…]`.
    //
    // `label="Dirección fiscal"` on `<app-input>` is an @Input, and rewriting it to
    // `[attr.label]` would set an HTML attribute the component never reads — the field would
    // silently lose its label. Property binding is correct for both cases: `placeholder`,
    // `title` and `alt` are real DOM properties on the native elements that take them, and an
    // @Input on a component.
    //
    // ARIA is the exception: `aria-label` is an attribute with no property behind it, so it has
    // to go through `[attr.]`.
    const binding = name.startsWith('aria-') ? `[attr.${name}]` : `[${name}]`;
    const replacement = `${space}${binding}="'${key}' | translate"`;
    const hbsReplacement = `${space}${name}${equals}"${CONFIG.wrapAttribute(key)}"`;
    edits.push({
      start: match.index,
      end: match.index + whole.length,
      text: HBS ? hbsReplacement : replacement,
    });
    report.attributes++;
    report.attributeSites.push({ file, text: `${name}="${trimmed.slice(0, 80)}"` });
  }

  if (!edits.length) continue;

  edits.sort((a, b) => b.start - a.start);
  let source = original;
  for (const edit of edits) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }

  if (!DRY && unit.writable) writeFileSync(file, source);
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

// In report mode the counts are an assertion the build makes; a bare number tells nobody which
// template broke it, so every offender is named. Listing them is what turns a red suite into a
// fix.
function listSites(label, sites) {
  for (const item of sites.slice(0, 60)) {
    console.log(`  ${label} ${relative(CONFIG.roots[0], item.file)}: ${item.text}`);
  }
}

console.log(`text nodes externalised   ${report.rewritten}`);
if (DRY) listSites('text', report.textSites);
console.log(`attributes externalised   ${report.attributes}`);
if (DRY) listSites('attribute', report.attributeSites);
console.log(`catalogue keys added      ${countLeaves(catalogue)}`);
console.log(`mixed blocks for a human  ${report.mixed.length}`);
for (const item of report.mixed.slice(0, 60)) {
  console.log(`  ${relative(CONFIG.roots[0], item.file)}: ${item.text}`);
}

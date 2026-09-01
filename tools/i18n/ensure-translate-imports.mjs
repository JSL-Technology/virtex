#!/usr/bin/env node
/**
 * Makes sure every component imports the pipes its template uses.
 *
 * A standalone component that uses `| translate` without `TranslateModule` in its `imports` fails
 * to compile — but only when that template is compiled, which for a lazily-loaded route means the
 * error appears the first time somebody opens that screen. Moving 1,244 strings into the
 * catalogue without this would have traded untranslated text for broken routes.
 *
 *   node tools/i18n/ensure-translate-imports.mjs --dry
 *   node tools/i18n/ensure-translate-imports.mjs
 *
 * Handles the two shapes a component's template can take — `templateUrl` beside the class, and an
 * inline `template:` — and leaves a component that already imports the module alone.
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const ROOT = 'apps/core/client-web/src/app';
const DRY = process.argv.includes('--dry');


/** Relative specifier from a component to the shared formatting pipes. */
function formatPipesSpecifier(file) {
  const target = join(ROOT, 'core', 'i18n', 'pipes', 'format.pipes');
  let specifier = relative(dirname(file), target).split(sep).join('/');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  return specifier;
}

/** Insert after the last COMPLETE import statement, never inside a multi-line one. */
function insertImport(source, statement) {
  if (source.includes(statement)) return source;
  const pattern =
    /^import\s(?:[^;'"]|'[^']*'|"[^"]*")*?from\s*['"][^'"]+['"];|^import\s*['"][^'"]+['"];/gms;
  const matches = [...source.matchAll(pattern)];
  if (!matches.length) return `${statement}\n${source}`;
  const end = matches.at(-1).index + matches.at(-1)[0].length;
  return `${source.slice(0, end)}\n${statement}${source.slice(end)}`;
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return full.endsWith('.ts') && !full.endsWith('.spec.ts') ? [full] : [];
  });
}

/** The template a component renders, whether it is inline or a file beside it. */
function templateOf(file, source) {
  const url = /templateUrl\s*:\s*['"]([^'"]+)['"]/.exec(source);
  if (url) {
    const path = resolve(dirname(file), url[1]);
    return existsSync(path) ? readFileSync(path, 'utf8') : '';
  }
  const inline = /template\s*:\s*`([\s\S]*?)`/.exec(source);
  return inline ? inline[1] : '';
}

const changed = [];
const unresolved = [];

for (const file of sourceFiles(ROOT)) {
  const original = readFileSync(file, 'utf8');
  if (!/@Component\s*\(/.test(original)) continue;

  const template = templateOf(file, original);
  const usesTranslate = /\|\s*translate\b/.test(template);
  const usesFormat = /\|\s*vx(Number|Money|Percent|Compact|Date|RelativeTime|List)\b/.test(template);
  if (!usesTranslate && !usesFormat) continue;

  let source = original;
  const needed = [];
  if (usesTranslate && !/\bTranslateModule\b/.test(source)) needed.push('TranslateModule');
  if (usesFormat && !/\bFORMAT_PIPES\b/.test(source)) needed.push('...FORMAT_PIPES');
  if (!needed.length) continue;

  // 1. The import statements.
  if (needed.includes('...FORMAT_PIPES')) {
    const formatSpecifier = formatPipesSpecifier(file);
    source = insertImport(source, `import { FORMAT_PIPES } from '${formatSpecifier}';`);
  }
  if (needed.includes('TranslateModule')) {
  if (/from\s+'@ngx-translate\/core'/.test(source)) {
    source = source.replace(
      /import\s*\{([^}]*)\}\s*from\s*'@ngx-translate\/core';/,
      (whole, inner) => {
        const names = [...new Set([...inner.split(',').map((n) => n.trim()).filter(Boolean), 'TranslateModule'])];
        return `import { ${names.sort().join(', ')} } from '@ngx-translate/core';`;
      },
    );
  } else {
    source = insertImport(source, `import { TranslateModule } from '@ngx-translate/core';`);
  }
  }

  // 2. The component's `imports` array.
  const importsArray = /(@Component\s*\(\s*\{[\s\S]*?\bimports\s*:\s*\[)([\s\S]*?)(\])/.exec(source);
  if (importsArray) {
    const [whole, head, body, tail] = importsArray;
    const entries = body.split(',').map((entry) => entry.trim()).filter(Boolean);
    entries.push(...needed);
    source = source.replace(whole, `${head}${entries.join(', ')}${tail}`);
  } else {
    // A component with no `imports` at all: either it is declared in an NgModule, or the array
    // was omitted. Reported rather than guessed at — inserting one would change how the component
    // is declared, which is not a rename.
    unresolved.push(relative(ROOT, file));
    continue;
  }

  if (!DRY) writeFileSync(file, source);
  changed.push(relative(ROOT, file));
}

console.log(`components given their pipes      ${changed.length}`);
console.log(`components needing a person       ${unresolved.length}`);
for (const file of unresolved) console.log(`  ${file}`);

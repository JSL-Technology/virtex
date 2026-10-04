import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Every icon a template names exists on its component (QA A-16).
 *
 * `[img]="XIcon"` where the class declares no `XIcon` binds `undefined`; `lucide-icon` throws in
 * `ngOnChanges`, and the exception aborts the whole change-detection pass. In the security settings
 * that pass was the one that would have opened the 2FA dialog: «Activar» did nothing, with no
 * request and no message — only a console error nobody reads. The compiler does not catch it in
 * these templates, so this does.
 */

const APP = join(__dirname, '..', '..');
const ICON_BINDING = /\[img\]="([A-Za-z_$][\w$]*)"/g;

/** Every regular-expression metacharacter, backslash included, taken literally. */
function escapeRegExp(text: string): string {
  return text.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function templates(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.html') ? [path] : [];
  });
}

describe('icon references', () => {
  it('name a member the component declares', () => {
    const offenders: string[] = [];
    for (const html of templates(APP)) {
      const ts = html.replace(/\.html$/, '.ts');
      if (!existsSync(ts)) continue;
      const source = readFileSync(ts, 'utf8');
      const template = readFileSync(html, 'utf8');
      // Names the template itself declares: `as x`, `let x`, `@for (x of …)`, `@let x =`.
      const local = new Set(
        [...template.matchAll(/\b(?:as|let)\s+([A-Za-z_$][\w$]*)|@for\s*\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1] ?? m[2]),
      );
      for (const [, name] of template.matchAll(ICON_BINDING)) {
        if (local.has(name)) continue;
        const declared = new RegExp(`(^|\\s|\\.)${escapeRegExp(name)}\\s*[=:!?(]|get\\s+${escapeRegExp(name)}\\b`, 'm');
        if (!declared.test(source)) offenders.push(`${relative(APP, html)} → ${name}`);
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});

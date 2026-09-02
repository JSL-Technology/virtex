import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * A route's `title` is text the reader sees — in the browser tab, in the history, in a bookmark —
 * and it is the one piece of visible text no template scanner can reach, because it lives in a
 * TypeScript object rather than in HTML.
 *
 * That blind spot cost 115 titles: hardcoded prose, half of it Spanish and half English, so a
 * reader on `es` could open "Chart of Accounts" and a reader on `en` could open "Cuentas por
 * Pagar". `TranslatedTitleStrategy` passes an unknown key through unchanged, which is the right
 * fallback and is also why nothing ever failed.
 */

const WORKSPACE_ROOT = join(__dirname, '..', '..', '..', '..', '..', '..', '..');
const CLIENT_SOURCE = join(WORKSPACE_ROOT, 'apps', 'core', 'client-web', 'src');
const CATALOGUES = join(CLIENT_SOURCE, 'assets', 'i18n');

const KEY = /^[A-Z][A-Z0-9_]*(\.[A-Z0-9_]+)+$/;

function routeFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return routeFiles(path);
    return entry.name.endsWith('.routes.ts') ? [path] : [];
  });
}

function routeTitles(): { file: string; title: string }[] {
  const found: { file: string; title: string }[] = [];
  for (const path of routeFiles(CLIENT_SOURCE)) {
    const source = readFileSync(path, 'utf8');
    for (const match of source.matchAll(/title: '([^']*)'/g)) {
      found.push({ file: relative(CLIENT_SOURCE, path), title: match[1] });
    }
  }
  return found;
}

function lookup(catalogue: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    catalogue,
  );
}

describe('route titles', () => {
  const titles = routeTitles();

  it('are found at all (the scan itself has to work)', () => {
    expect(titles.length).toBeGreaterThan(50);
  });

  it('are translation keys, never prose', () => {
    const prose = titles.filter(({ title }) => !KEY.test(title));
    expect(prose).toEqual([]);
  });

  for (const language of ['es', 'en', 'pt']) {
    it(`resolve to a string in ${language}`, () => {
      const catalogue = JSON.parse(readFileSync(join(CATALOGUES, `${language}.json`), 'utf8'));
      const missing = titles
        .filter(({ title }) => typeof lookup(catalogue, title) !== 'string')
        .map(({ file, title }) => `${file}: ${title}`);
      expect([...new Set(missing)]).toEqual([]);
    });
  }
});

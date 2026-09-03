import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every link in the finance group opens something.
 *
 * ## Why this test exists
 *
 * The sidebar declared 295 links, of which 250 resolved to no route at all — clicking one fell
 * through to the `**` fallback and redirected. The finance group alone advertised hedge accounting,
 * in-house banking, supply-chain finance, dunning, factoring and chargebacks, none of which the
 * product had. A menu is a promise about what the application does; one where four links in five
 * lead nowhere teaches the reader to distrust the fifth, and it buried the working entries among
 * the ones that were not.
 *
 * ## Why only the finance group
 *
 * The same defect runs through operations, HR, PSA and the rest, and trimming those means deciding
 * what half a dozen other modules are supposed to be — not something to settle from a finance
 * change. This gate holds the ground that has been cleared, and fails the build if a finance entry
 * is added ahead of the route that serves it.
 */
const APP_ROOT = join(__dirname, '..', '..');

/** Every path segment declared by any route file, which is what a link is matched against. */
function declaredSegments(): Set<string> {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.routes.ts')) files.push(path);
    }
  };
  walk(APP_ROOT);

  const segments = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(/path:\s*'([^']*)'/g)) {
      for (const part of match[1].split('/')) {
        if (part) segments.add(part);
      }
    }
  }
  return segments;
}

/** The `path:` literals inside the finance group, which ends where OPERATIONS begins. */
function financeLinks(): string[] {
  const menu = readFileSync(join(__dirname, 'sidebar-menu.ts'), 'utf8');
  const start = menu.indexOf('── FINANCE ──');
  const end = menu.indexOf('── OPERATIONS ──');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return [...menu.slice(start, end).matchAll(/path:\s*'(\/[^']*)'/g)].map((match) => match[1]);
}

describe('sidebar links', () => {
  const segments = declaredSegments();
  const links = financeLinks();

  it('finds finance links to check (guards against a silently empty sweep)', () => {
    expect(links.length).toBeGreaterThan(15);
  });

  it('every finance link resolves to a declared route', () => {
    const dead = links.filter((link) =>
      link
        .split('/')
        .filter(Boolean)
        .some((part) => !segments.has(part)),
    );
    expect(dead).toEqual([]);
  });

  it('lists no link twice', () => {
    const seen = new Map<string, number>();
    for (const link of links) seen.set(link, (seen.get(link) ?? 0) + 1);
    expect([...seen.entries()].filter(([, count]) => count > 1).map(([link]) => link)).toEqual([]);
  });
});

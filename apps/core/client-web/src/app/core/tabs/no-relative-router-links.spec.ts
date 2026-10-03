import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * No page links relative to "where it is" (QA A-13).
 *
 * Pages open inside tabs that the tab wrapper mounts, not the router outlet, so the
 * `ActivatedRoute` they are given describes the tab's params and not a position in the route tree.
 * A relative link — `['./', id, 'edit']`, `'../list'` — therefore resolves against nothing: the
 * journal entry list linked every number and every "More actions" that way, and none of them
 * opened anything, so a posted entry could not be looked at. Absolute paths are what every other
 * list uses; the tenant prefix is added by the router, not by the link.
 */

const CLIENT_SOURCE = join(__dirname, '..', '..', '..');

/** `routerLink="./x"`, `routerLink="../x"`, `[routerLink]="['./', …]"`, `[routerLink]="['../x']"`. */
const RELATIVE_LINK = /routerLink\]?\s*=\s*"\s*(?:\[\s*)?['"]?\.{1,2}\//;

function templates(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return templates(path);
    return entry.name.endsWith('.html') || (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'))
      ? [path]
      : [];
  });
}

describe('router links', () => {
  it('are absolute, because a page inside a tab has no position to be relative to', () => {
    const offenders = templates(CLIENT_SOURCE).flatMap((path) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, index }))
        .filter(({ line }) => RELATIVE_LINK.test(line))
        .map(({ index }) => `${relative(CLIENT_SOURCE, path)}:${index + 1}`),
    );
    expect(offenders).toEqual([]);
  });
});

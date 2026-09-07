import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

/**
 * Every route says what it requires.
 *
 * `PermissionsGuard` is an `APP_GUARD` and denies when a route declares nothing, so an undeclared
 * route fails closed rather than open. That is the safe direction, but it fails at runtime, in
 * production, on a user — and the failure looks like a permissions bug rather than a missing
 * declaration. This test moves the discovery to the build.
 *
 * ## Why a source scan rather than a running application
 *
 * Booting the Nest application to walk its route table means resolving every provider: a database,
 * a Redis instance and a mail transport, for a question that is answered by the decorators alone.
 * The scan reads what a reviewer reads.
 *
 * ## What counts as a declaration
 *
 * One of four, on the handler or on its controller:
 *
 *  - `@HasPermission(...)`  — the ordinary case.
 *  - `@CheckPermissions(...)` — an ABAC policy stands in for the permission.
 *  - `@Public()` — no session at all, so there is nobody to check.
 *  - `@AuthenticatedOnly(reason)` — being signed in IS the authorisation, and the author wrote why.
 *
 * A new route that declares none of these fails here, naming itself.
 */

const APP_DIR = join(__dirname, '..', '..', '..');

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...controllerFiles(full));
    } else if (entry.endsWith('.controller.ts') && !entry.endsWith('.spec.ts')) {
      out.push(full);
    }
  }
  return out;
}

const DECLARATIONS = ['@HasPermission', '@CheckPermissions', '@Public()', '@AuthenticatedOnly'];
const HTTP_METHOD = /@(Get|Post|Put|Patch|Delete)\(/g;

interface Route {
  file: string;
  verb: string;
  handler: string;
  declared: boolean;
}

function routesIn(file: string): Route[] {
  const src = readFileSync(file, 'utf8');
  const classMatch = /@Controller\([\s\S]*?export\s+class\s+(\w+)/.exec(src);
  // Decorators between @Controller and `export class` apply to every handler in the file.
  const classHeader = classMatch ? src.slice(classMatch.index, classMatch.index + classMatch[0].length) : '';
  const classDeclares = DECLARATIONS.some((d) => classHeader.includes(d));

  const hits = [...src.matchAll(HTTP_METHOD)];
  return hits.map((hit, i) => {
    const start = hit.index as number;
    // Decorators sit either above the HTTP one (since the previous handler) or just below it.
    const previousEnd = i > 0 ? (hits[i - 1].index as number) : (classMatch ? classMatch.index + classMatch[0].length : 0);
    const above = src.slice(previousEnd, start);
    const below = src.slice(start, start + 700);
    const handler = /\n\s*(?:async\s+)?(\w+)\s*\(/.exec(src.slice(start, start + 800));

    return {
      file: file.slice(APP_DIR.length + 1),
      verb: hit[1].toUpperCase(),
      handler: handler ? handler[1] : '(anónimo)',
      declared:
        classDeclares || DECLARATIONS.some((d) => above.includes(d) || below.includes(d)),
    };
  });
}

describe('autorización de rutas', () => {
  const routes = controllerFiles(APP_DIR).flatMap(routesIn);

  it('encuentra las rutas del backend', () => {
    // Guards the scan itself: a refactor that renames controllers must not turn this suite into a
    // test that passes because it found nothing to check.
    expect(routes.length).toBeGreaterThan(300);
  });

  it('toda ruta declara permiso, política, acceso público o @AuthenticatedOnly', () => {
    const undeclared = routes.filter((r) => !r.declared);

    expect(
      undeclared.map((r) => `${r.verb} ${r.file} → ${r.handler}()`).sort(),
    ).toEqual([]);
  });

  it('cada @AuthenticatedOnly explica por qué no hace falta permiso', () => {
    // The decorator takes a required string, so TypeScript already rejects an empty call. What it
    // cannot reject is a placeholder, and a placeholder is how "no permission needed" stops being
    // a decision and goes back to being an oversight.
    const thin: string[] = [];

    for (const file of controllerFiles(APP_DIR)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/@AuthenticatedOnly\(([\s\S]*?)\)\s*\n/g)) {
        const reason = m[1].replace(/['"`+\s]/g, '');
        if (reason.length < 60) {
          thin.push(`${file.slice(APP_DIR.length + 1)}: «${m[1].trim().slice(0, 50)}…»`);
        }
      }
    }

    expect(thin).toEqual([]);
  });
});

import { readFileSync, readdirSync, statSync } from 'fs';
import { ALL_PERMISSIONS } from '../../shared/permissions';
import { isPlatformPermission } from '../platform-permissions';
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

const APP_DIR = join(__dirname, '..', '..');

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
  /**
   * Un recurso COMPARTIDO por todos los inquilinos no se administra con un permiso de inquilino.
   *
   * Esta es la regla que faltaba, y su ausencia fue el hallazgo crítico de la auditoría. Las
   * tablas `plugins` y `plugin_versions` son globales a propósito —una extensión se escribe una
   * vez y se ofrece a todo el mundo, así que no llevan `organization_id`—, pero sus rutas de
   * escritura estaban protegidas por `extensions:manage`, un permiso ordinario del catálogo de
   * inquilino que el `'*'` del rol ADMINISTRADOR de CADA cliente satisface.
   *
   * El resultado: cualquiera que se registrara podía publicar una versión de cualquier extensión
   * del catálogo y, como se ejecutaba la más reciente, correr ese código en el aislado y en el
   * navegador de los demás inquilinos.
   *
   * Arreglar esas cinco rutas no impide que la próxima tabla global repita el patrón. Esto sí:
   * una ruta que escriba el catálogo de extensiones tiene que declarar un permiso de plataforma,
   * que `RolesService` se niega a meter en un rol de empresa y que `'*'` no satisface.
   */
  it('toda escritura sobre un recurso de plataforma exige un permiso de plataforma', () => {
    // Los controladores que administran algo compartido por todos los inquilinos. Añadir una
    // tabla global sin añadirla aquí es la omisión que esto busca; el nombre del fichero es el
    // ancla porque es lo que un autor ve mientras escribe la ruta.
    const PLATFORM_SURFACES = ['extensions.controller.ts'];

    /**
     * Escrituras de estos controladores que NO tocan el recurso compartido, con su razón.
     *
     * Una lista con nombres y motivos, no una expresión regular: la exención tiene que ser algo
     * que alguien decidió y escribió, igual que `@AuthenticatedOnly(motivo)`. Si mañana una de
     * estas rutas empieza a escribir el catálogo, quitar su línea de aquí es el cambio que lo
     * refleja.
     */
    const TENANT_SCOPED: Record<string, string> = {
      setConsent:
        'Escribe la relación de ESTE inquilino con la extensión —qué versión acepta y qué ' +
        'capacidades le concede—, no el catálogo. Es la acción de inquilino por excelencia.',
      execute:
        'Ejecutar una extensión INSTALADA es una acción de inquilino. El código en línea sí ' +
        'exige `platform:extensions:run_arbitrary_code`, y se comprueba en el servicio porque ' +
        'depende del cuerpo de la petición, no de la ruta.',
    };
    const WRITE_VERB = /^\s*@(Post|Put|Patch|Delete)\(/;
    const ANY_VERB = /^\s*@(Get|Post|Put|Patch|Delete)\(/;

    const unprotected: string[] = [];

    for (const file of controllerFiles(APP_DIR)) {
      const relative = file.slice(APP_DIR.length + 1);
      if (!PLATFORM_SURFACES.some((surface) => relative.endsWith(surface))) continue;

      const lines = readFileSync(file, 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (!WRITE_VERB.test(line)) return;

        // La ventana de decoradores de ESTA ruta: hacia atrás hasta el final de la anterior,
        // hacia delante hasta la firma del manejador.
        //
        // Recorrer un número fijo de caracteres hacia delante no vale, y lo comprobé: con una
        // ventana de 700 caracteres el test seguía en verde después de quitarle el decorador a
        // `register`, porque alcanzaba el de `revoke`. Un test que no falla cuando el fallo
        // existe es peor que no tenerlo, porque se le cree.
        let start = index;
        while (start > 0 && !ANY_VERB.test(lines[start - 1])) {
          const previous = lines[start - 1].trim();
          if (previous === '' || previous.startsWith('@') || previous.startsWith('*') ||
              previous.startsWith('/**') || previous.startsWith('//') || previous.startsWith('*/')) {
            start -= 1;
            continue;
          }
          break;
        }

        let end = index + 1;
        let handler = '(anónimo)';
        while (end < lines.length) {
          const candidate = lines[end].trim();
          if (candidate === '' || candidate.startsWith('@') || candidate.startsWith('//')) {
            end += 1;
            continue;
          }
          handler = /^(?:async\s+)?(\w+)\s*\(/.exec(candidate)?.[1] ?? '(anónimo)';
          break;
        }

        const declaration = lines.slice(start, end).join('\n');

        if (TENANT_SCOPED[handler]) return;

        if (!declaration.includes('@RequiresPlatformPermission')) {
          unprotected.push(`${relative} → ${handler}()`);
        }
      });
    }

    expect(unprotected.sort()).toEqual([]);
  });

  /**
   * El nivel de plataforma no se puede delegar a un rol de empresa.
   *
   * Sin esto, el tier sería decorativo: un administrador de inquilino con `'*'` crearía un rol
   * que lleva `platform:extensions:publish` y volvería a estar donde estábamos.
   */
  it('ningún permiso de plataforma aparece en el catálogo de permisos de inquilino', () => {
    const leaked = ALL_PERMISSIONS.filter((permission) => isPlatformPermission(permission));
    expect(leaked).toEqual([]);
  });
});

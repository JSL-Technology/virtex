import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { resolveRoute } from '../modules/module-registry';

/**
 * Todo `routerLink` a una vista del área de trabajo tiene que casar con una ruta declarada en un
 * manifest. Si no casa, `resolveRoute` devuelve null, el host de pestañas abre la definición
 * genérica («en construcción», MODULE_LIST) y —además de mostrar una página de obra— la ventana
 * NUNCA es hojeable, así que «vista previa al abrir» no se dispara ahí.
 *
 * Este test recorre las plantillas, extrae cada `routerLink`, lo vuelve concreto (los trozos
 * dinámicos → `1`) y comprueba que resuelve. Lista los que no, que son exactamente los enlaces rotos
 * que hacen que la vista previa «no funcione» en ese módulo.
 */

// __dirname = .../client-web/src/app/core/tabs → tres niveles arriba es .../client-web/src
const CLIENT_SOURCE = join(__dirname, '..', '..', '..');
const FEATURES = join(CLIENT_SOURCE, 'app', 'features');

function htmlFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
  });
}

/** Primeros segmentos que no viven en un manifest: públicos, modales o marketing/legales. */
const NON_WORKSPACE_FIRST = new Set([
  'auth', 'payment', 'unauthorized', 'global-search', 'notifications',
  'settings', // se abre como modal (fragmento), interceptado por un guard, no como pestaña
  'contact', 'privacy', 'security', 'terms', // páginas de marketing/legales, fuera del área
]);

function isNonWorkspace(url: string): boolean {
  const first = url.split('/').filter(Boolean)[0] ?? '';
  // Prefijo de idioma (`/es/...`) o un placeholder de variable de idioma (`/1/...`): rutas públicas.
  if (/^[a-z]{2}$/i.test(first) || first === '1') return true;
  return NON_WORKSPACE_FIRST.has(first);
}

/**
 * Enlaces de detalle/creación que apuntan a páginas que TODAVÍA NO EXISTEN (feature incompleta):
 * abren la página genérica «en construcción». No son un enlace mal escrito —no hay ruta a la que
 * apuntar— sino trabajo pendiente. Se listan aquí para que el test no falle por ellos, pero queden
 * a la vista. Al construir esas páginas y declarar sus rutas, hay que quitarlas de esta lista.
 */
const KNOWN_INCOMPLETE = new Set([
  '/purchasing/orders/new',
  '/purchasing/orders/1/edit',
  '/purchasing/requisitions/new',
]);

/** `['/a', x.id, 'edit']` → `/a/1/edit`. Devuelve null para enlaces relativos o no-ruta. */
function toConcrete(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, -1);
    const parts = inner.split(',').map((s) => s.trim()).filter(Boolean);
    const first = parts[0]?.match(/^'([^']*)'$/) ?? parts[0]?.match(/^"([^"]*)"$/);
    // Array relativo (`['bank-accounts', …]`, `['./', …]`): resuelve contra la ruta activa, no es
    // absoluto y no se puede validar aquí. Se ignora.
    if (!first || !first[1].startsWith('/')) return null;
    const segs = parts.map((p) => {
      const m = p.match(/^'([^']*)'$/) ?? p.match(/^"([^"]*)"$/);
      return m ? m[1] : '1'; // trozo dinámico → id ficticio
    });
    return '/' + segs.join('/').split('/').filter(Boolean).join('/');
  }
  const m = trimmed.match(/^'([^']*)'$/) ?? trimmed.match(/^"([^"]*)"$/);
  const val = m ? m[1] : trimmed;
  if (!val.startsWith('/')) return null; // relativos / fragmentos: se ignoran
  return val;
}

function collectLinks(): { file: string; url: string }[] {
  const found: { file: string; url: string }[] = [];
  const re = /\[routerLink\]="(\[[^"]*\])"|routerLink="([^"{]*)"/g;
  for (const file of htmlFiles(FEATURES)) {
    const rel = relative(CLIENT_SOURCE, file);
    if (rel.includes('features/auth/')) continue; // shell público, rutas fuera del área
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(re)) {
      const raw = match[1] ?? match[2];
      if (!raw) continue;
      const url = toConcrete(raw);
      if (!url || isNonWorkspace(url) || KNOWN_INCOMPLETE.has(url)) continue;
      found.push({ file: rel, url });
    }
  }
  return found;
}

describe('routerLinks resuelven a una ruta real (si no, no hay preview y sale «en construcción»)', () => {
  it('todos los enlaces de las plantillas casan con un manifest', () => {
    const links = collectLinks();
    const broken = links
      .filter(({ url }) => resolveRoute(url) === null)
      .map(({ file, url }) => `${url}   ←   ${file}`);
    const unique = [...new Set(broken)].sort();
    // eslint-disable-next-line no-console
    if (unique.length) console.log('\nENLACES ROTOS (' + unique.length + '):\n' + unique.join('\n'));
    expect(unique).toEqual([]);
  });
});

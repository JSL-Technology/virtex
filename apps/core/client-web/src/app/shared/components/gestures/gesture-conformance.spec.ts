import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { MODULES } from '../../../core/modules/module-registry';
import { WindowKind } from '../../../core/modules/module-manifest';

/**
 * Cada gesto tiene un armazón, y esta prueba es lo que impide que vuelva a haber treinta y cinco.
 *
 * ## Por qué se lee el código fuente
 *
 * Porque la alternativa es una guía de estilo, y una guía de estilo es una regla que alguien tiene
 * que recordar. Antes de los armazones, las treinta y cinco listas del producto tenían treinta y
 * cinco maneras de decir «cargando» y cerca de la mitad no decía nada al quedarse vacía; ninguna de
 * esas diferencias fue una decisión. Lo que las produjo no fue descuido: fue que nada las notaba.
 *
 * Una pantalla nueva que declare `WindowKind.LIST` y dibuje su propio encabezado hace fallar esta
 * prueba nombrando el archivo. No hay lista de excepciones a propósito: una excepción se convierte
 * en la norma en cuanto la segunda persona la copia. Si una pantalla no es una lista, lo que hay
 * que corregir es el `kind` del manifiesto —que es exactamente lo que se hizo con las importaciones
 * y exportaciones de datos, que eran un asistente y un formulario declarados como listas—.
 */
describe('conformidad de los gestos', () => {
  const APP = join(__dirname, '..', '..', '..');

  /** `../../../features/x/y` en el manifiesto → ruta del archivo en disco. */
  const SHELL_BY_KIND: Partial<Record<WindowKind, string>> = {
    [WindowKind.LIST]: 'vx-list-shell',
    [WindowKind.DOCUMENT]: 'vx-document-shell',
    [WindowKind.DRAFT]: 'vx-draft-shell',
    [WindowKind.INBOX]: 'vx-inbox-shell',
  };

  /**
   * El código de cada ruta: su plantilla si la tiene en un archivo, y si no, su componente —hay
   * pantallas con la plantilla en línea, y esconderse ahí no puede ser una forma de saltarse esto.
   */
  function sourceOf(loaderSource: string): { file: string; code: string } | null {
    const match = loaderSource.match(/import\('([^']+)'\)/);
    if (!match) return null;
    const base = join(APP, match[1].replace(/^(\.\.\/)+/, ''));
    for (const candidate of [`${base}.html`, `${base}.ts`]) {
      if (existsSync(candidate)) return { file: candidate, code: readFileSync(candidate, 'utf8') };
    }
    return null;
  }

  const manifestSources = new Map<string, string>();
  for (const module of MODULES) {
    const file = join(APP, 'core', 'modules', 'manifests', `${module.id.split('-')[0]}.manifest.ts`);
    if (existsSync(file)) manifestSources.set(module.id, readFileSync(file, 'utf8'));
  }

  /** Bloques `{ … }` de ruta, con su `kind` y su `load()`, leídos del manifiesto como texto. */
  function declaredRoutes(): { kind: WindowKind; loader: string; path: string }[] {
    const routes: { kind: WindowKind; loader: string; path: string }[] = [];
    for (const source of new Set(manifestSources.values())) {
      for (const block of source.split(/\n {4}\{\n/).slice(1)) {
        const body = block.split(/\n {4}\},?/)[0];
        const kind = body.match(/kind: WindowKind\.(\w+)/)?.[1] as WindowKind | undefined;
        const loader = body.match(/import\('[^']+'\)/)?.[0];
        const path = body.match(/path: '([^']*)'/)?.[1] ?? '';
        if (kind && loader) routes.push({ kind, loader, path });
      }
    }
    return routes;
  }

  const ROUTES = declaredRoutes();

  it('lee manifiestos de verdad', () => {
    // Sin esto, un fallo del análisis haría pasar la prueba con cero rutas, que es peor que fallar.
    expect(ROUTES.length).toBeGreaterThan(60);
  });

  for (const [kind, selector] of Object.entries(SHELL_BY_KIND)) {
    it(`toda ventana ${kind} usa <${selector}>`, () => {
      const infractoras = ROUTES.filter((route) => route.kind === kind)
        .map((route) => ({ route, source: sourceOf(route.loader) }))
        .filter(({ source }) => source !== null && !source.code.includes(selector))
        .map(({ source }) => (source as { file: string }).file.replace(APP, '').replace(/^\//, ''));

      expect([...new Set(infractoras)]).toEqual([]);
    });
  }
});

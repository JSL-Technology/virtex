import { MODULES, ROUTE_INDEX, resolveRoute, buildModuleRoutes, buildMenu, railModules } from './module-registry';
import { isKnownIcon } from './module-icons';
import { fullPath } from './module-manifest';
import { SIDEBAR_MENU } from '../../layout/sidebar/sidebar-menu';

/**
 * The manifests are the only place a route exists, and these are the properties that keep it so.
 *
 * The predecessor of this file, `sidebar-routes.spec.ts`, was well written and validated the wrong
 * table: it walked the menu against the ROUTER config, which had stopped being what decides what
 * renders. It passed green while 40 of 50 links opened an "under construction" card. A test that
 * checks the table nobody reads is worse than no test — it sustains the belief that the links work.
 *
 * So these assertions are about the derivation itself. If the menu is generated from the routes,
 * a dead link cannot exist; what remains worth proving is that the generation stays the only path.
 */
describe('manifiestos de módulo', () => {
  it('declara todas las rutas del ERP', () => {
    // Guards the suite against silently checking nothing after a refactor.
    expect(ROUTE_INDEX.length).toBeGreaterThan(70);
  });

  it('cada ruta declara un permiso', () => {
    const sinPermiso = ROUTE_INDEX.filter((r) => !r.route.permission?.trim()).map((r) => r.path);
    expect(sinPermiso).toEqual([]);
  });

  it('no hay dos rutas con el mismo camino', () => {
    // Two manifests claiming one URL is the same class of bug as two routing tables, one scale
    // down: whichever wins, the other is dead code that reads as if it worked.
    const seen = new Map<string, string[]>();
    for (const { path, module } of ROUTE_INDEX) {
      seen.set(path, [...(seen.get(path) ?? []), module.id]);
    }
    const duplicadas = [...seen.entries()]
      .filter(([, owners]) => owners.length > 1)
      .map(([path, owners]) => `${path} ← ${owners.join(', ')}`);
    expect(duplicadas).toEqual([]);
  });

  it('toda entrada de menú resuelve a la ruta que la generó', () => {
    // The derivation makes this true by construction. It is asserted anyway because "by
    // construction" is a property of today's `buildMenu`, and this is what would break if someone
    // reintroduced a hand-written entry.
    const rotas: string[] = [];
    for (const module of MODULES) {
      for (const section of buildMenu(module)) {
        for (const entry of section.entries) {
          const match = resolveRoute(entry.path);
          if (!match) rotas.push(`${module.id}: ${entry.path}`);
        }
      }
    }
    expect(rotas).toEqual([]);
  });

  it('el sidebar no ofrece ningún enlace muerto', () => {
    const rotos = SIDEBAR_MENU.flatMap((g) => g.items)
      .filter((i) => i.path && !resolveRoute(i.path))
      .map((i) => i.path as string);
    expect(rotos).toEqual([]);
  });

  it('no ofrece dos veces el mismo enlace', () => {
    // Ported from `sidebar-links.spec.ts`, which scraped this file's predecessor as text and only
    // covered the finance group. A repeated entry is not cosmetic: it means two manifests both
    // claim to be the way in to one screen, and whichever the user learns, the other is a
    // different-looking door to the same room.
    const conteo = new Map<string, number>();
    for (const item of SIDEBAR_MENU.flatMap((g) => g.items)) {
      if (item.path) conteo.set(item.path, (conteo.get(item.path) ?? 0) + 1);
    }
    const repetidos = [...conteo.entries()].filter(([, n]) => n > 1).map(([path]) => path);
    expect(repetidos).toEqual([]);
  });

  it('la ruta literal gana a la paramétrica', () => {
    // `/invoices/list` used to be a menu entry, no such route existed, `:id` swallowed it, and the
    // user landed on the detail of an invoice called "list". Specificity ordering is what stops a
    // near-miss from resolving to the wrong window instead of to nothing.
    const nueva = resolveRoute('/invoices/new');
    expect(nueva?.entry.path).toBe('/invoices/new');

    const detalle = resolveRoute('/invoices/abc-123');
    expect(detalle?.entry.path).toBe('/invoices/:id');
    expect(detalle?.params['id']).toBe('abc-123');
  });

  it('una URL que nadie declara no resuelve', () => {
    // The honest answer to an unknown URL is "nothing owns this", not a placeholder that looks
    // like a page under construction.
    expect(resolveRoute('/no/existe/esto')).toBeNull();
  });

  it('la tabla de rutas de Angular sale de los mismos manifiestos', () => {
    const generadas = buildModuleRoutes().map((r) => `/${r.path}`).sort();
    const declaradas = ROUTE_INDEX.map((r) => r.path).sort();
    expect(generadas).toEqual(declaradas);
  });

  it('cada ruta de Angular lleva el permiso de su manifiesto', () => {
    const routes = buildModuleRoutes();
    for (const route of routes) {
      const match = resolveRoute(`/${route.path}`);
      expect((route.data as { permissions: string[] }).permissions).toEqual([
        match?.entry.route.permission,
      ]);
    }
  });

  it('todo icono declarado existe', () => {
    const desconocidos = new Set<string>();
    for (const module of MODULES) {
      if (!isKnownIcon(module.icon)) desconocidos.add(module.icon);
      for (const route of module.routes) {
        if (route.icon && !isKnownIcon(route.icon)) desconocidos.add(route.icon);
      }
    }
    expect([...desconocidos]).toEqual([]);
  });

  it('los módulos del rail tienen al menos una entrada de menú', () => {
    for (const module of railModules()) {
      expect(buildMenu(module).length).toBeGreaterThan(0);
    }
  });

  it('fullPath compone el camino con la base del módulo', () => {
    const contabilidad = MODULES.find((m) => m.id === 'contabilidad');
    expect(contabilidad).toBeDefined();
    const periodos = contabilidad?.routes.find((r) => r.path === 'periods');
    expect(fullPath(contabilidad!, periodos!)).toBe('/accounting/periods');
  });
});

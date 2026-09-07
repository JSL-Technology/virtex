import { MODULES, ROUTE_INDEX, resolveRoute, buildModuleRoutes, buildMenu, railModules, ownerOf } from './module-registry';
import { isKnownIcon } from './module-icons';
import { ModuleManifest, fullPath } from './module-manifest';

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

  it('toda entrada de menú se alcanza desde algún módulo del riel', () => {
    // The hole this closes: a manifest marked `hidden` kept its routes resolvable and its menu
    // entries declared, and they then appeared in no menu at all. Six screens — almacenes, unidades
    // de medida, bancos, métodos y términos de pago, hojas de datos — were reachable only by typing
    // the URL. `hidden` is now for a module with nothing worth opening; a module that lives under
    // someone else's prefix says `panelOf` instead.
    const alcanzables = new Set(
      railModules().flatMap((m) => buildMenu(m).flatMap((s) => s.entries.map((e) => e.path))),
    );
    const huerfanas = MODULES.flatMap((m) =>
      buildMenu(m)
        .flatMap((s) => s.entries.map((e) => e.path))
        .filter((path) => !alcanzables.has(path))
        .map((path) => `${m.id}: ${path}`),
    );
    expect(huerfanas).toEqual([]);
  });

  it('ningún módulo del riel repite el nombre de otro', () => {
    // Two buttons both reading "Tesorería" is what a satellite in the rail looked like.
    const nombres = railModules().map((m) => m.titleKey);
    expect(nombres).toEqual([...new Set(nombres)]);
  });

  it('un satélite lleva a su dueño, no a un panel propio', () => {
    const almacenes = resolveRoute('/masters/warehouses');
    expect(almacenes?.entry.module.id).toBe('inventario-masters');
    expect(ownerOf(almacenes?.entry.module as ModuleManifest).id).toBe('inventario');
  });

  it('los cuatro grupos salen siempre en el mismo orden', () => {
    // The fixed shape is the whole argument for the module panel: whatever module you are in, what
    // needs your attention is at the top and the reference data is where it was next door. A module
    // with nothing in a group omits the heading; it never reorders the rest.
    const ORDEN = ['inbox', 'documents', 'masters', 'analysis'];
    for (const module of MODULES) {
      const grupos = buildMenu(module).map((s) => s.group);
      expect({ module: module.id, grupos }).toEqual({
        module: module.id,
        grupos: ORDEN.filter((g) => grupos.includes(g as (typeof grupos)[number])),
      });
    }
  });

  it('no ofrece dos veces el mismo enlace', () => {
    // Ported from `sidebar-links.spec.ts`, which scraped a hand-written menu as text and only
    // covered the finance group. A repeated entry is not cosmetic: it means two manifests both
    // claim to be the way in to one screen, and whichever the user learns, the other is a
    // different-looking door to the same room.
    // Over the rail's modules, which is what a user actually sees: a satellite's entries appear
    // both in its own `buildMenu` and merged into its owner's, and that is the mechanism working,
    // not a duplicate door.
    const conteo = new Map<string, number>();
    for (const module of railModules()) {
      for (const entry of buildMenu(module).flatMap((s) => s.entries)) {
        conteo.set(entry.path, (conteo.get(entry.path) ?? 0) + 1);
      }
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

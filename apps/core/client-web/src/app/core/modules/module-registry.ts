import { Routes } from '@angular/router';
import { ModuleManifest, ModuleRoute, MenuGroup, fullPath } from './module-manifest';
import { WORKSPACE_MODULE } from './manifests/workspace.manifest';
import { VENTAS_MODULE } from './manifests/ventas.manifest';
import { COMPRAS_MODULE } from './manifests/compras.manifest';
import { INVENTARIO_MODULE, INVENTARIO_MASTERS_MODULE } from './manifests/inventario.manifest';
import { TESORERIA_MODULE, TESORERIA_MASTERS_MODULE } from './manifests/tesoreria.manifest';
import { CONTABILIDAD_MODULE } from './manifests/contabilidad.manifest';
import { ANALISIS_MODULE, DATASHEETS_MODULE } from './manifests/analisis.manifest';
import { ADMINISTRACION_MODULE, ROADMAP_MODULE } from './manifests/administracion.manifest';

/**
 * Every module the ERP has. The one list.
 *
 * Importing a manifest costs nothing at load time: a manifest holds lazy `load()` closures, never
 * a component, so the initial bundle is unchanged.
 */
export const MODULES: ModuleManifest[] = [
  WORKSPACE_MODULE,
  VENTAS_MODULE,
  COMPRAS_MODULE,
  INVENTARIO_MODULE,
  INVENTARIO_MASTERS_MODULE,
  TESORERIA_MODULE,
  TESORERIA_MASTERS_MODULE,
  CONTABILIDAD_MODULE,
  ANALISIS_MODULE,
  DATASHEETS_MODULE,
  ADMINISTRACION_MODULE,
  ROADMAP_MODULE,
].sort((a, b) => a.order - b.order);

export interface RegisteredRoute {
  module: ModuleManifest;
  route: ModuleRoute;
  /** `/accounting/journal-entries/:id/edit` */
  path: string;
  segments: string[];
}

/**
 * Flat index of every declared route, ordered so the most specific wins.
 *
 * Ordering is by literal segments first, then by depth. `/invoices/new` therefore beats
 * `/invoices/:id`, which is not a nicety: the sidebar used to link `/invoices/list`, no such route
 * existed, the parameter swallowed it, and the user landed on the detail of an invoice whose id
 * was the word "list".
 */
export const ROUTE_INDEX: RegisteredRoute[] = MODULES.flatMap((module) =>
  module.routes.map((route) => {
    const path = fullPath(module, route);
    return { module, route, path, segments: path.split('/').filter(Boolean) };
  }),
).sort((a, b) => {
  const literals = (r: RegisteredRoute) => r.segments.filter((s) => !s.startsWith(':')).length;
  return literals(b) - literals(a) || b.segments.length - a.segments.length;
});

export interface ResolvedRoute {
  entry: RegisteredRoute;
  params: Record<string, string>;
}

/** The route that owns this URL, or null. There is no fallback: an unmatched URL is a 404. */
export function resolveRoute(url: string): ResolvedRoute | null {
  const path = url.split('?')[0].split('#')[0];
  const segments = path.split('/').filter(Boolean);

  for (const entry of ROUTE_INDEX) {
    if (entry.segments.length !== segments.length) continue;

    const params: Record<string, string> = {};
    const matched = entry.segments.every((part, i) => {
      if (part.startsWith(':')) {
        params[part.slice(1)] = decodeURIComponent(segments[i]);
        return true;
      }
      return part === segments[i];
    });

    if (matched) return { entry, params };
  }

  return null;
}

/**
 * The Angular route table, generated.
 *
 * `app.routes.ts` no longer lists the authenticated routes by hand. It asks for them, so the
 * router and the window host cannot disagree about what exists — which they did, 15 patterns
 * against roughly ninety routes, for as long as both lists were maintained separately.
 */
export function buildModuleRoutes(): Routes {
  return ROUTE_INDEX.map(({ route, path }) => ({
    path: path.slice(1),
    loadComponent: route.load,
    title: route.titleKey,
    data: {
      ...(route.data ?? {}),
      permissions: [route.permission],
      windowKind: route.kind,
    },
  }));
}

export interface MenuEntry {
  path: string;
  labelKey: string;
  icon: string;
  permission: string;
}

export interface MenuSection {
  group: MenuGroup;
  entries: MenuEntry[];
}

/**
 * The module panel, derived from the routes.
 *
 * A menu entry that points nowhere stops being expressible: there is no list of links to keep in
 * step with a list of pages, because the links ARE the pages. The four groups always appear in the
 * same order, in every module — that fixed shape is what makes the second module cost nothing to
 * learn.
 */
const GROUP_ORDER: MenuGroup[] = ['inbox', 'documents', 'masters', 'analysis'];

export function buildMenu(module: ModuleManifest): MenuSection[] {
  const sections = new Map<MenuGroup, MenuEntry[]>();

  // The module's own routes first, then its satellites' — the ones that own a different URL prefix
  // but belong to this module's panel. Without this, a satellite's screens appear in no menu.
  for (const source of [module, ...satellitesOf(module)]) {
    for (const route of source.routes) {
      if (!route.menu) continue;
      const entry: MenuEntry = {
        path: fullPath(source, route),
        labelKey: route.menu.labelKey,
        icon: route.icon ?? source.icon,
        permission: route.permission,
      };
      const list = sections.get(route.menu.group);
      if (list) list.push(entry);
      else sections.set(route.menu.group, [entry]);
    }
  }

  return GROUP_ORDER.filter((g) => sections.has(g)).map((group) => ({
    group,
    entries: sections.get(group) as MenuEntry[],
  }));
}

/** Manifests whose entries belong to this module's panel, in their declared order. */
export function satellitesOf(module: ModuleManifest): ModuleManifest[] {
  return MODULES.filter((m) => m.panelOf === module.id);
}

/**
 * The module whose panel a route belongs to.
 *
 * A satellite resolves to its owner, so opening `/masters/warehouses` shows the Inventory panel
 * rather than a panel of its own with one entry in it.
 */
export function ownerOf(module: ModuleManifest): ModuleManifest {
  if (!module.panelOf) return module;
  return MODULES.find((m) => m.id === module.panelOf) ?? module;
}

/**
 * Modules shown in the rail, in business order.
 *
 * Satellites are excluded because they are not places — they are parts of a place that happen to
 * live under another URL prefix. Two rail buttons both reading "Tesorería" is what the alternative
 * looked like.
 */
export function railModules(): ModuleManifest[] {
  return MODULES.filter(
    (m) => !m.hidden && !m.panelOf && buildMenu(m).some((section) => section.entries.length > 0),
  );
}

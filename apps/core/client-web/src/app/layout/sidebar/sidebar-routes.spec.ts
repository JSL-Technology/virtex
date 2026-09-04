import { Route, Routes } from '@angular/router';
import { APP_ROUTES } from '../../app.routes';
import { SIDEBAR_MENU, SidebarGroup } from './sidebar-menu';

/**
 * Every link in the sidebar goes somewhere.
 *
 * ## Why this needed a test rather than a sweep
 *
 * The menu is a hand-maintained list of 224 paths and the router is a separate hand-maintained
 * tree. Nothing connected them, so a link whose page was never built, or whose route was renamed,
 * looked exactly like one that worked — until a user clicked it and the `**` wildcard sent them to
 * a redirector. A one-time sweep fixes today's list and says nothing about tomorrow's, and the menu
 * is edited far more often than the router.
 *
 * ## How the match is decided
 *
 * The route config is walked directly rather than by navigating: navigation would run the guards,
 * instantiate every lazily loaded page component and take minutes for 224 links, and none of that
 * is what the question asks. `loadChildren` is awaited, because a lazily loaded child route file is
 * still a declaration; `loadComponent` is not, because whether a component imports cleanly is a
 * different question from whether a path resolves.
 *
 * The wildcard is deliberately not treated as a match. `path: '**'` matches everything, which is
 * exactly why a broken link is invisible: it resolves, and the user lands somewhere that is not
 * where the menu said they would go.
 */

/** A route we can descend into without executing a component. */
interface ResolvedRoute {
  path: string;
  children: ResolvedRoute[];
  /** Whether this node is a real destination rather than a pass-through. */
  terminal: boolean;
}

async function resolve(routes: Routes): Promise<ResolvedRoute[]> {
  const out: ResolvedRoute[] = [];

  for (const route of routes as Route[]) {
    // The wildcard resolves everything and therefore proves nothing.
    if (route.path === '**') continue;

    let children: Routes = route.children ?? [];

    if (route.loadChildren) {
      const loaded = await (route.loadChildren as () => Promise<unknown>)();
      children = extractRoutes(loaded);
    }

    out.push({
      path: route.path ?? '',
      children: await resolve(children),
      terminal: Boolean(route.component || route.loadComponent || route.redirectTo),
    });
  }

  return out;
}

/** A lazy route file may export the array directly or as a named or default export. */
function extractRoutes(loaded: unknown): Routes {
  if (Array.isArray(loaded)) return loaded as Routes;
  if (loaded && typeof loaded === 'object') {
    for (const value of Object.values(loaded as Record<string, unknown>)) {
      if (Array.isArray(value)) return value as Routes;
    }
  }
  return [];
}

/** Whether `segments` is fully consumed by some branch of the tree. */
function matches(segments: string[], routes: ResolvedRoute[]): boolean {
  if (segments.length === 0) {
    // An empty remainder matches a node that is itself a destination, or one with an index child.
    return routes.some(
      (route) => route.path === '' && (route.terminal || matches([], route.children)),
    );
  }

  return routes.some((route) => {
    const routeSegments = route.path.split('/').filter(Boolean);

    // A pass-through with an empty path: try to consume the remainder in its children.
    if (routeSegments.length === 0) {
      return route.children.length > 0 && matches(segments, route.children);
    }

    if (routeSegments.length > segments.length) return false;

    const consumed = routeSegments.every(
      // `:id` and friends match any single segment.
      (piece, index) => piece.startsWith(':') || piece === segments[index],
    );
    if (!consumed) return false;

    const remainder = segments.slice(routeSegments.length);
    if (remainder.length === 0) {
      return route.terminal || matches([], route.children);
    }
    return matches(remainder, route.children);
  });
}

/** Every `path` the menu offers, with the label that leads to it. */
function sidebarLinks(menu: SidebarGroup[]): { path: string; key: string }[] {
  const links: { path: string; key: string }[] = [];
  for (const group of menu) {
    for (const item of group.items) {
      if (item.path) links.push({ path: item.path, key: item.translationKey });
      for (const sub of item.subItems ?? []) {
        links.push({ path: sub.path, key: sub.translationKey });
      }
    }
  }
  return links;
}

describe('sidebar links', () => {
  let tree: ResolvedRoute[];

  beforeAll(async () => {
    tree = await resolve(APP_ROUTES);
  });

  it('finds the menu and the router', () => {
    // Guards the guard: an empty menu or an empty route tree would make everything below pass by
    // checking nothing. The floor is deliberately well below today's count — encoding the exact
    // number would turn every ordinary menu edit into a failing test, which is how a guard gets
    // deleted.
    expect(sidebarLinks(SIDEBAR_MENU).length).toBeGreaterThan(25);
    expect(tree.length).toBeGreaterThan(0);
  });

  it('leads every menu entry to a declared route', () => {
    const broken = sidebarLinks(SIDEBAR_MENU)
      .filter(({ path }) => !matches(path.split('/').filter(Boolean), tree))
      .map(({ path, key }) => `${path} (${key})`);

    expect(broken).toEqual([]);
  });

  it('gives every menu entry a distinct path', () => {
    const seen = new Map<string, string[]>();
    for (const { path, key } of sidebarLinks(SIDEBAR_MENU)) {
      seen.set(path, [...(seen.get(path) ?? []), key]);
    }
    const duplicated = [...seen.entries()]
      .filter(([, keys]) => keys.length > 1)
      .map(([path, keys]) => `${path}: ${keys.join(', ')}`);

    expect(duplicated).toEqual([]);
  });
});

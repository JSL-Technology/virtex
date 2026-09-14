import { Route, Routes } from '@angular/router';
import { APP_ROUTES } from './app.routes';

/**
 * A route declared after a catch-all is not a route. It is dead code that looks like a feature.
 *
 * `/unauthorized` was declared below the authenticated shell. The shell is `path: ''` with a `**`
 * child, and an empty parent path consumes no segments, so its catch-all child matches every URL
 * there is — the shell wins before the router ever looks further down the list. The symptom was
 * not a 404, which someone would have noticed. `permissionsGuard` redirected correctly, the
 * address bar read `/unauthorized?url=/accounting/journal-entries`, and what rendered underneath
 * was the workspace with the user's own home screen on it. A refusal was indistinguishable from a
 * navigation that quietly went nowhere.
 *
 * Declaration order is invisible at a glance and survives review easily, so it is asserted here
 * rather than trusted: moving `unauthorized` back below the shell fails this file.
 */
describe('Client routes — reachability of top-level routes', () => {
  /**
   * Whether this route matches every URL beneath it.
   *
   * Either it is itself `**`, or it consumes nothing (`path: ''` without `pathMatch: 'full'`) and
   * holds a descendant that does. The second case is the one that bit us: nothing in the shell's
   * own declaration says "catch-all", and the child that makes it one sits forty lines away.
   */
  const swallowsEverything = (route: Route): boolean => {
    if (route.path === '**') return true;
    if (route.path !== '' || route.pathMatch === 'full') return false;
    return (route.children ?? []).some((child) => swallowsEverything(child));
  };

  const describeRoute = (route: Route): string =>
    route.path === '' ? "path: '' (the shell)" : `path: '${route.path}'`;

  it('declares no reachable route after a catch-all', () => {
    const shadowed: string[] = [];
    let swallower: Route | null = null;

    for (const route of APP_ROUTES) {
      if (swallower && route.path !== '**') {
        shadowed.push(`${describeRoute(route)} is unreachable behind ${describeRoute(swallower)}`);
      }
      if (!swallower && swallowsEverything(route)) swallower = route;
    }

    expect(shadowed).toEqual([]);
  });

  /**
   * The specific route that was lost, named outright.
   *
   * The rule above would also pass if `unauthorized` were deleted, and a permissions refusal that
   * lands nowhere is exactly as broken whether the route is misplaced or absent.
   */
  it('resolves /unauthorized to the access-denied page, not to the shell', async () => {
    const index = APP_ROUTES.findIndex((route) => route.path === 'unauthorized');
    expect(index).toBeGreaterThanOrEqual(0);

    const earlier: Routes = APP_ROUTES.slice(0, index);
    expect(earlier.filter((route) => swallowsEverything(route)).map(describeRoute)).toEqual([]);

    // And it still loads the page it claims to, rather than a route left pointing at nothing.
    const loaded = await (APP_ROUTES[index].loadComponent as () => Promise<unknown>)();
    expect((loaded as { name?: string }).name).toBe('UnauthorizedPage');
  });
});

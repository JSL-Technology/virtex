import { Route, Routes, UrlSegment } from '@angular/router';
import { APP_ROUTES } from './app.routes';

/**
 * Every URL the backend emails or redirects to must match a route.
 *
 * This existed as a class of bug rather than a single one: password reset, user invitations, the
 * registration magic link, the social sign-up hand-off and every OAuth error redirect all pointed
 * at paths the router does not have. Each fell through to the authenticated shell, whose guard
 * redirected to the login page and discarded the query string on the way — so the flows appeared
 * to "work" (the user landed on a real page) while the token or error code was silently dropped.
 *
 * The paths below are exactly what `FrontendUrlService` produces. Resolving them here means a
 * route rename breaks a build instead of a customer's password reset.
 */
describe('Client routes — links emitted by the backend', () => {
  /** Resolve a route's children, following `loadChildren` so lazy branches are covered too. */
  const childrenOf = async (route: Route): Promise<Routes> => {
    if (route.children) return route.children;
    if (!route.loadChildren) return [];
    const loaded = await (route.loadChildren as () => Promise<unknown>)();
    return Array.isArray(loaded) ? (loaded as Routes) : [];
  };

  /**
   * Walk the configured route tree by path segment.
   *
   * A `**` counts only when it sits under a route with a concrete path of its own. That
   * distinction is the whole point of this test: `/settings/**` is a deliberate wildcard (those
   * screens are reopened in a modal outlet, so the shape is intended), whereas the root fallback
   * and the authenticated shell's `**` swallow every URL indiscriminately. Every broken link
   * below was "accepted" by one of the latter — which is exactly why nobody noticed.
   */
  const walk = async (
    config: Routes,
    remaining: string[],
    underConcretePath = false,
  ): Promise<boolean> => {
    if (remaining.length === 0) return true;

    for (const route of config) {
      if (route.path === '**') {
        if (underConcretePath) return true;
        continue;
      }

      if (route.matcher) {
        // langCodeMatcher / countryCodeMatcher consume one segment when it matches.
        const consumed = route.matcher(
          remaining.map((path) => new UrlSegment(path, {})),
          null as never,
          route,
        );
        if (
          consumed &&
          (await walk(await childrenOf(route), remaining.slice(consumed.consumed.length), false))
        ) {
          return true;
        }
        continue;
      }

      const routeSegments = (route.path ?? '').split('/').filter(Boolean);

      // A pathless route contributes structure, not a segment: descend without consuming.
      if (routeSegments.length === 0) {
        if (await walk(await childrenOf(route), remaining, false)) return true;
        continue;
      }

      const matches =
        routeSegments.length <= remaining.length &&
        routeSegments.every((seg, i) => seg.startsWith(':') || seg === remaining[i]);
      if (!matches) continue;

      const rest = remaining.slice(routeSegments.length);
      if (rest.length === 0) return true;
      if (await walk(await childrenOf(route), rest, true)) return true;
    }

    return false;
  };

  const resolves = (url: string): Promise<boolean> => {
    const path = url.split('#')[0].split('?')[0];
    const segments = path.split('/').filter(Boolean);
    return segments.length === 0 ? Promise.resolve(true) : walk(APP_ROUTES, segments);
  };

  it.each([
    ['password reset', '/es/auth/reset-password'],
    ['password reset (en)', '/en/auth/reset-password'],
    ['invitation', '/es/auth/set-password'],
    ['registration magic link', '/es/do/auth/register'],
    ['registration magic link (other country)', '/es/mx/auth/register'],
    ['login', '/es/auth/login'],
    ['forgot password', '/es/auth/forgot-password'],
    ['dashboard', '/dashboard'],
    ['billing', '/settings/billing'],
    ['profile (email-change confirmation)', '/settings/my-profile'],
    ['checkout complete', '/auth/checkout-complete'],
  ])('resolves the %s link', async (_label, url) => {
    await expect(resolves(url)).resolves.toBe(true);
  });

  /**
   * The counter-examples. Every one of these was a real link the backend sent, and every one of
   * them missed its route. If this block ever passes, the guard above has stopped guarding.
   */
  it.each([
    ['reset password without a language prefix', '/auth/reset-password'],
    ['invitation without a language prefix', '/auth/set-password'],
    ['registration without a country segment', '/es/auth/register'],
    ['social sign-up with no prefixes at all', '/auth/register'],
    ['login without a language prefix', '/auth/login'],
  ])('still rejects the old broken form: %s', async (_label, url) => {
    await expect(resolves(url)).resolves.toBe(false);
  });
});

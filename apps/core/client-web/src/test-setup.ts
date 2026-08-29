import { setupZoneTestEnv } from 'jest-preset-angular/setup-env/zone';
import { of } from 'rxjs';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { TranslateModule } from '@ngx-translate/core';
import { provideHighcharts } from 'highcharts-angular';
import { API_URL } from './app/core/tokens/api-url.token';

setupZoneTestEnv({
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

/**
 * Ambient providers every component in this application needs.
 *
 * Standalone components inject `HttpClient`, `Router`, animations and the translate pipe through
 * the root injector, which the TestBed does not populate on its own. Each spec was left to
 * assemble that itself, and most did not: 37 suites failed with NG0201 ("No provider found for
 * _HttpClient") before reaching an assertion, so a third of the frontend test suite was reporting
 * nothing about the code it named.
 *
 * `TestBed.configureTestingModule` merges successive calls, and a `beforeEach` registered here
 * runs before the one inside a spec file, so a spec that declares its own providers still wins —
 * this only fills in what would otherwise be missing.
 *
 * `provideHttpClientTesting` is deliberate: it installs `HttpTestingController` and makes every
 * request assertable, so a component that fires an unexpected call fails loudly instead of
 * reaching the network from a unit test.
 */
beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [TranslateModule.forRoot()],
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      provideRouter([]),
      provideNoopAnimations(),
      // Services build their URLs from this token; without it every one of them fails to
      // construct. The value is deliberately obvious so a request that escapes the
      // HttpTestingController is recognisable in a failure message.
      { provide: API_URL, useValue: 'http://test.local/api/v1' },
      // Chart widgets inject the Highcharts loader at construction time.
      provideHighcharts({ instance: () => import('highcharts') }),
      // `provideRouter` alone does not populate the router state until the first navigation, so
      // anything injecting ActivatedRoute — including every RouterLink in a template — threw
      // "Cannot read properties of undefined (reading 'root')" during component construction.
      // A route stub is both simpler and more predictable than driving a navigation per spec.
      { provide: ActivatedRoute, useValue: activatedRouteStub() },
    ],
  });
});

/** Minimal ActivatedRoute with every observable a component might read already present. */
function activatedRouteStub(): Partial<ActivatedRoute> {
  const empty = convertToParamMap({});
  return {
    snapshot: {
      paramMap: empty,
      queryParamMap: empty,
      params: {},
      queryParams: {},
      data: {},
      fragment: null,
      url: [],
    } as never,
    paramMap: of(empty),
    queryParamMap: of(empty),
    params: of({}),
    queryParams: of({}),
    data: of({}),
    fragment: of(null),
    url: of([]),
    parent: null,
    children: [],
    outlet: 'primary',
  } as Partial<ActivatedRoute>;
}

/**
 * `window.matchMedia` has no jsdom implementation. Components that read a media query (the theme
 * service, responsive layout helpers) threw `matchMedia is not a function` on construction.
 * The stub reports "does not match", which is the correct default for a headless environment.
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined, // deprecated, still called by some libraries
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

/** jsdom implements neither; several layout components observe their host element. */
for (const name of ['ResizeObserver', 'IntersectionObserver'] as const) {
  if (!(name in window)) {
    Object.defineProperty(window, name, {
      writable: true,
      value: class {
        observe = () => undefined;
        unobserve = () => undefined;
        disconnect = () => undefined;
        takeRecords = () => [];
      },
    });
  }
}

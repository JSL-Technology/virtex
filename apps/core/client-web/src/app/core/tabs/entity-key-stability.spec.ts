import { TestBed } from '@angular/core/testing';

import { TabRegistryService } from './tab-registry.service';
import { MODULES } from '../modules/module-registry';

/**
 * An entity key must be a pure function of the route.
 *
 * It is what makes a window addressable: open the same URL twice and the workspace focuses the
 * window that already has it. Fourteen of the `…/new` routes built theirs from
 * `crypto.randomUUID()`, so every call produced a different key and the match could never happen.
 *
 * Observed: typed "TEST-QA Sin guardar" into New customer (the header read "Unsaved"), opened
 * Invoices, came back to New customer — and got a SECOND, empty "New customer" window in front of
 * the one holding the text. Nothing was lost, but nothing said so either; the reasonable reading
 * at the keyboard is that the typing went nowhere.
 *
 * Purity is not visible by reading one manifest entry, and a random key looks deliberate enough to
 * survive review, so it is asserted here against every route the product declares.
 */
describe('Window identity — entity keys are stable', () => {
  let registry: TabRegistryService;

  beforeEach(() => {
    registry = TestBed.inject(TabRegistryService);
  });

  /** Every declared route, with a concrete value substituted for each `:param`. */
  const routes = MODULES.flatMap((module) =>
    module.routes.map((route) => ({
      pattern: route.path,
      url: '/' + route.path.replace(/:(\w+)/g, (_, name: string) => `sample-${name}`),
    })),
  );

  it('declares routes to test', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('gives the same URL the same key every time it is resolved', () => {
    const unstable = routes.filter(({ url }) => {
      const first = registry.resolve(url).definition.entityKeyFn?.(
        registry.resolve(url).params,
      );
      const second = registry.resolve(url).definition.entityKeyFn?.(
        registry.resolve(url).params,
      );
      return first !== second;
    });

    expect(unstable.map((r) => r.pattern)).toEqual([]);
  });

  it('gives each draft route one key, not one per visit', () => {
    const drafts = routes.filter(({ pattern }) => pattern.endsWith('/new'));
    // Every module that can create something declares a draft route; if this ever reads zero the
    // filter above has drifted and the assertion below would be vacuously true.
    expect(drafts.length).toBeGreaterThan(10);

    for (const { url, pattern } of drafts) {
      const resolved = registry.resolve(url);
      const key = resolved.definition.entityKeyFn?.(resolved.params);
      expect(typeof key).toBe('string');
      expect(key).toBe(registry.resolve(url).definition.entityKeyFn?.(resolved.params));
      // The shape that broke it, named so the failure explains itself.
      expect(key).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
      expect(pattern).toBeTruthy();
    }
  });

  it('keeps distinct records on distinct keys, so dedupe does not collapse them', () => {
    const one = registry.resolve('/hcm/employees/e-1/edit');
    const two = registry.resolve('/hcm/employees/e-2/edit');

    expect(one.definition.entityKeyFn?.(one.params)).not.toBe(
      two.definition.entityKeyFn?.(two.params),
    );
  });

  it('keeps a draft distinct from the records of its own kind', () => {
    const draft = registry.resolve('/hcm/employees/new');
    const record = registry.resolve('/hcm/employees/e-1/edit');

    expect(draft.definition.entityKeyFn?.(draft.params)).not.toBe(
      record.definition.entityKeyFn?.(record.params),
    );
  });
});

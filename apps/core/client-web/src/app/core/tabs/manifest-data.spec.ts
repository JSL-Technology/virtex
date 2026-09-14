import { TestBed } from '@angular/core/testing';

import { TabRegistryService } from './tab-registry.service';
import { MODULES } from '../modules/module-registry';

/**
 * The manifest's static `data` has to reach the window it configures.
 *
 * Two windows in the product are the same component told apart by one value: the ageing report is
 * `{ side: 'payables' }` or `{ side: 'receivables' }`, and it reads that from
 * `ActivatedRoute.snapshot.data`. Windows are mounted by the tab registry rather than a router
 * outlet, and `toDefinition` dropped `data` on the floor — so the payables window fell back to its
 * default and rendered what CUSTOMERS owe us under a "Supplier" heading, reconciled against the
 * receivables control account. Nothing failed; the report was simply about the other side of the
 * ledger, and no supplier balance was reachable from the product at all.
 *
 * The defect is invisible to a component test, because a spec hands the component its route data
 * directly and gets the right answer. It lives in the seam, so it is tested at the seam.
 */
describe('manifest data reaches the window', () => {
  let registry: TabRegistryService;

  beforeEach(() => {
    registry = TestBed.inject(TabRegistryService);
  });

  it('carries `data` from the manifest onto the tab definition', () => {
    expect(registry.resolve('/reports/aging/payables').definition.data).toEqual({
      side: 'payables',
    });
    expect(registry.resolve('/reports/aging/receivables').definition.data).toEqual({
      side: 'receivables',
    });
  });

  it('keeps every declared `data` in the manifests reachable', () => {
    const declared = MODULES.flatMap((module) =>
      module.routes
        .filter((route) => route.data !== undefined)
        .map((route) => ({
          path: `/${[module.basePath, route.path].filter(Boolean).join('/')}`,
          data: route.data,
        })),
    );

    // If a manifest declares data, something has to deliver it; a silent drop is the defect.
    expect(declared.length).toBeGreaterThan(0);
    for (const entry of declared) {
      expect(registry.resolve(entry.path).definition.data).toEqual(entry.data);
    }
  });
});

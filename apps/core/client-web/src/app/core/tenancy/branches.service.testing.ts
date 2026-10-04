import { Provider, computed, signal } from '@angular/core';
import { of } from 'rxjs';
import { BranchesService, MyBranches } from './branches.service';

/**
 * A `BranchesService` for page tests: the company has the branches given, by default none.
 *
 * Every document form and list now carries the branch picker, which asks the server for the
 * person's branches. A page test that is not about branches should neither see that request nor
 * have to answer it; one that is passes the branches it wants.
 */
export function provideTestBranches(mine: Partial<MyBranches> = {}): Provider {
  const state = signal<MyBranches>({ branches: [], closed: [], defaultBranchId: null, restricted: false, ...mine });
  const stub: Partial<BranchesService> = {
    mine: state.asReadonly(),
    hasBranches: computed(() => state().branches.length > 0),
    ensureMine: () => Promise.resolve(state()),
    invalidate: () => undefined,
    label: (id) => {
      const branch = [...state().branches, ...state().closed].find((b) => b.id === id);
      return branch ? `${branch.code} · ${branch.name}` : null;
    },
    list: () => of([]),
  };
  return { provide: BranchesService, useValue: stub };
}

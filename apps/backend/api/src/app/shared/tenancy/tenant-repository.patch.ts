import { DataSource, EntityManager, Repository } from 'typeorm';
import { currentTenantStore } from './tenant-context';

/**
 * Routes existing data access through the request's tenant-bound connection.
 *
 * ## The problem this solves
 *
 * The policies installed by `TenantRowLevelSecurity1789002100000` read a setting that lives on a
 * connection. Setting it is easy; making sure the request's queries run on THAT connection is not,
 * because 91 services obtain their repository through `@InjectRepository`, and those repositories
 * are bound to the DataSource's default entity manager — which hands out whatever connection the
 * pool has free.
 *
 * The alternative was to change how all 91 services get their manager. That is a mechanical edit of
 * the entire data layer, reviewed as one diff, verifiable only by running everything — precisely the
 * kind of change that gets half-applied and leaves the other half silently unprotected.
 *
 * ## What is patched, and why a prototype
 *
 * Two accessors, once, at startup:
 *
 *  - `Repository.manager` — resolves to the request's manager when there is one. Almost every
 *    Repository method delegates to `this.manager`, so this covers find, save, remove and
 *    `createQueryBuilder` alike.
 *  - `DataSource.transaction` — 96 call sites open transactions this way. Left alone, each would
 *    take a fresh connection from the pool, without the tenant setting, and see nothing.
 *
 * Patching a library prototype is not a thing to do lightly, and it is done here because the
 * alternative is worse: an invariant that holds only where somebody remembered to apply it. The
 * patch is idempotent, falls back to the original behaviour outside a request, and is proven by
 * `verify:rls-runtime`, which runs real queries through the real injector as two different tenants.
 */
let patched = false;

export function patchDataAccessForTenancy(): void {
  if (patched) return;
  patched = true;

  // ── Repository.manager ─────────────────────────────────────────────────────
  //
  // TypeORM assigns `manager` in the constructor. Declaring an accessor pair on the prototype means
  // that assignment lands in `__tenantDefaultManager`, and every read consults the request first.
  const MANAGER_FIELD = Symbol.for('virtex.defaultManager');

  Object.defineProperty(Repository.prototype, 'manager', {
    configurable: true,
    enumerable: true,
    get(this: Record<symbol, unknown>): EntityManager {
      const store = currentTenantStore();
      return (store?.manager ?? this[MANAGER_FIELD]) as EntityManager;
    },
    set(this: Record<symbol, unknown>, manager: EntityManager) {
      this[MANAGER_FIELD] = manager;
    },
  });

  // ── DataSource.transaction ─────────────────────────────────────────────────
  //
  // Inside a request, the transaction must run on the connection that already carries the tenant.
  // `EntityManager.transaction` on that manager opens it there; outside a request nothing changes.
  const originalTransaction = DataSource.prototype.transaction;

  DataSource.prototype.transaction = function patchedTransaction(
    this: DataSource,
    ...args: unknown[]
  ) {
    const store = currentTenantStore();
    if (!store) {
      return (originalTransaction as (...a: unknown[]) => unknown).apply(this, args);
    }
    return (store.manager.transaction as (...a: unknown[]) => unknown).apply(store.manager, args);
  } as typeof DataSource.prototype.transaction;
}

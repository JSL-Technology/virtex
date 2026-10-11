import { DataSource, EntityManager, QueryRunner, Repository } from 'typeorm';
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
 *  - `DataSource.createQueryRunner` — every OTHER way to reach the database opens a runner through
 *    it: `dataSource.manager.find(...)`, `dataSource.query(...)` and a runner a service opens to
 *    control its own transaction (the issue preview does). 146 call sites. A runner created inside
 *    a tenant context now carries that tenant from the moment it connects, and gives the
 *    connection back to the pool with the setting reset. Before, all of them read from a clean
 *    connection: for the unprivileged role that is zero rows, so those screens were empty in
 *    production and only there.
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

  // ── DataSource.createQueryRunner ───────────────────────────────────────────
  const originalCreateQueryRunner = DataSource.prototype.createQueryRunner;

  DataSource.prototype.createQueryRunner = function patchedCreateQueryRunner(
    this: DataSource,
    ...args: Parameters<DataSource['createQueryRunner']>
  ) {
    const runner = originalCreateQueryRunner.apply(this, args);
    const store = currentTenantStore();
    if (!store) return runner;
    bindRunnerToTenant(runner, store.organizationId);
    return runner;
  } as typeof DataSource.prototype.createQueryRunner;
}

/**
 * Stamps the tenant on a runner's connection when it connects, and resets it on release.
 *
 * Session-level (`set_config(..., false)`) because the runner may run many statements, inside and
 * outside transactions. RESET on release, never left behind: the connection returns to a shared
 * pool, and whoever borrows it next must not inherit this tenant. The flag is set BEFORE the
 * stamping query, because `query()` itself calls `connect()` and would otherwise recurse.
 */
function bindRunnerToTenant(runner: QueryRunner, organizationId: string): void {
  const connect = runner.connect.bind(runner);
  const release = runner.release.bind(runner);
  let stamped = false;

  runner.connect = async () => {
    const connection = await connect();
    if (!stamped) {
      stamped = true;
      try {
        await runner.query(`SELECT set_config('app.current_organization', $1, false)`, [organizationId]);
      } catch (error) {
        stamped = false;
        throw error;
      }
    }
    return connection;
  };

  runner.release = async () => {
    if (stamped && !runner.isReleased) {
      stamped = false;
      await runner.query(`RESET app.current_organization`).catch(() => undefined);
    }
    return release();
  };
}

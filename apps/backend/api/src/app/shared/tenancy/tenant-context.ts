import { AsyncLocalStorage } from 'node:async_hooks';
import type { EntityManager } from 'typeorm';

/**
 * The tenant whose data the current unit of work may touch, and the connection bound to it.
 *
 * ## Why `AsyncLocalStorage`
 *
 * The row-level policies key off a PostgreSQL setting, `app.current_organization`, which lives on a
 * CONNECTION. So the tenant has to travel with whichever connection serves the request — not with a
 * parameter that 91 services would each have to remember to pass, which is the failure mode this
 * whole change exists to end.
 *
 * `i18n/request-locale.ts` already established the pattern here for the request's language. This is
 * the same shape for a stricter purpose: the locale being wrong shows the wrong words, the tenant
 * being wrong shows another company's ledger.
 */
export interface TenantStore {
  organizationId: string;
  /** Entity manager pinned to the connection where `app.current_organization` was set. */
  manager: EntityManager;
}

const storage = new AsyncLocalStorage<TenantStore>();

export function runInTenantContext<T>(store: TenantStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function currentTenantStore(): TenantStore | undefined {
  return storage.getStore();
}

/** The organization the current work belongs to, or undefined outside a request. */
export function currentOrganizationId(): string | undefined {
  return storage.getStore()?.organizationId;
}

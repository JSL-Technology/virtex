import type { DataSource } from 'typeorm';

/**
 * For unit tests of code that opens its own tenant connection (`runAsTenantJob`): a DataSource whose
 * runner accepts the tenant setting and records it, without a database.
 */
export function fakeTenantDataSource(): DataSource & { tenantQueries: string[] } {
  const tenantQueries: string[] = [];
  const runner = {
    connect: async () => undefined,
    query: async (sql: string) => {
      tenantQueries.push(sql.trim());
      return [];
    },
    release: async () => undefined,
  };
  // Reads through the default manager find nothing: a company with no market stated, no settings.
  const manager = { findOne: async () => null, find: async () => [], query: async () => [] };
  return {
    tenantQueries,
    manager,
    createQueryRunner: () => runner,
    createEntityManager: () => manager,
  } as unknown as DataSource & { tenantQueries: string[] };
}

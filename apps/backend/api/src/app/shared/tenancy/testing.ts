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
  return {
    tenantQueries,
    createQueryRunner: () => runner,
    createEntityManager: () => ({}),
  } as unknown as DataSource & { tenantQueries: string[] };
}

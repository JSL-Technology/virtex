import type { DataSource } from 'typeorm';

/**
 * For unit tests of code that opens its own tenant connection (`runAsTenantJob`): a DataSource whose
 * runner accepts the tenant setting and records it, without a database.
 */
export function fakeTenantDataSource(): DataSource & { tenantQueries: string[]; managerQueries: Array<[string, unknown[]]> } {
  const tenantQueries: string[] = [];
  const managerQueries: Array<[string, unknown[]]> = [];
  const runner = {
    connect: async () => undefined,
    query: async (sql: string) => {
      tenantQueries.push(sql.trim());
      return [];
    },
    release: async () => undefined,
  };
  // Reads through the default manager find nothing: a company with no market stated, no settings.
  const manager = {
    findOne: async () => null,
    find: async () => [],
    query: async (sql: string, params: unknown[] = []) => {
      managerQueries.push([sql.trim(), params]);
      return [];
    },
  };
  return {
    tenantQueries,
    managerQueries,
    manager,
    createQueryRunner: () => runner,
    createEntityManager: () => manager,
  } as unknown as DataSource & { tenantQueries: string[]; managerQueries: Array<[string, unknown[]]> };
}

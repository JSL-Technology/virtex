import { TenantIsolationCheck } from './tenant-isolation.check';

/**
 * The boot-time proof that tenant isolation applies to the application's connection.
 *
 * Only the branches that decide whether the application serves at all are tested here; the SQL
 * itself runs against Postgres in `verify:rls-runtime`.
 */
describe('TenantIsolationCheck', () => {
  const originalEnv = process.env['NODE_ENV'];
  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
  });

  const check = (query: jest.Mock) =>
    new TenantIsolationCheck({ options: { type: 'postgres' }, query } as never);

  const enforcing = { user: 'virtex_app', bypasses: false, policies: 120, exempt: 0 };

  it('refuses to start in production when the check itself cannot run', async () => {
    // A role that cannot read the catalogues is exactly the misconfiguration being looked for;
    // it used to disable the check with a warning.
    process.env['NODE_ENV'] = 'production';
    const query = jest.fn().mockRejectedValue(new Error('permission denied for table pg_authid'));
    await expect(check(query).onApplicationBootstrap()).rejects.toThrow(/could not verify/);
  });

  it('tolerates a failing check in development', async () => {
    process.env['NODE_ENV'] = 'development';
    const query = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(check(query).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('starts when isolation applies and covers the schema', async () => {
    process.env['NODE_ENV'] = 'production';
    const query = jest.fn().mockResolvedValueOnce([enforcing]).mockResolvedValueOnce([]);
    await expect(check(query).onApplicationBootstrap()).resolves.toBeUndefined();
  });

  it('refuses to start in production for a role that bypasses row-level security', async () => {
    process.env['NODE_ENV'] = 'production';
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ ...enforcing, user: 'postgres', bypasses: true }])
      .mockResolvedValueOnce([]);
    await expect(check(query).onApplicationBootstrap()).rejects.toThrow(/does not apply/);
  });

  it('refuses to start in production when a table is neither covered nor classified', async () => {
    process.env['NODE_ENV'] = 'production';
    const query = jest
      .fn()
      .mockResolvedValueOnce([enforcing])
      .mockResolvedValueOnce([{ table_name: 'brand_new_table' }]);
    await expect(check(query).onApplicationBootstrap()).rejects.toThrow(/does not cover/);
  });
});

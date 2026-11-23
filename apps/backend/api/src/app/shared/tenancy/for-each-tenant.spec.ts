import { DataSource } from 'typeorm';
import { forEachTenant } from './tenant-job';

/** A job over every company stops when the application's connections are gone. */
describe('forEachTenant', () => {
  it('stops at shutdown instead of failing every company left, one by one', async () => {
    let initialized = true;
    const runner = {
      connect: jest.fn(async () => undefined),
      startTransaction: jest.fn(async () => undefined),
      query: jest.fn(async () => undefined),
      commitTransaction: jest.fn(async () => undefined),
      rollbackTransaction: jest.fn(async () => undefined),
      release: jest.fn(async () => undefined),
      manager: {},
      isTransactionActive: true,
    };
    const dataSource = {
      get isInitialized() {
        return initialized;
      },
      createQueryRunner: () => runner,
      createEntityManager: () => ({}),
      query: jest.fn(),
    } as unknown as DataSource;
    const seen: string[] = [];
    const errors: string[] = [];

    await forEachTenant(
      dataSource,
      async (organizationId) => {
        seen.push(organizationId);
        if (organizationId === 'b') initialized = false; // `app.close()` while the job runs
      },
      ['a', 'b', 'c', 'd'],
      (organizationId) => errors.push(organizationId),
    );

    expect(seen).toEqual(['a', 'b']);
    expect(errors).toEqual([]);
  });
});

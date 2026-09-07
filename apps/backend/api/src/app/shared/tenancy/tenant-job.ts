import { DataSource } from 'typeorm';
import { runInTenantContext } from './tenant-context';

/**
 * Runs background work as one tenant.
 *
 * ## Why a queue job needs this and an HTTP request does not
 *
 * `TenantConnectionInterceptor` binds the tenant from the signed-in user. A queue job has no
 * request and no user: it wakes up on a schedule or on an event, so nothing tells the connection
 * which company it is acting for. Under the row-level policies that is not a subtle failure — the
 * job simply sees nothing — but "sees nothing" in a recurring-entry poster means entries silently
 * stop being posted, which is the kind of quiet wrong answer this whole change exists to remove.
 *
 * So a job that touches tenant data has to say whose data it is, and the tenant has to travel in
 * the job's payload rather than being looked up: looking it up requires reading a row, and reading
 * that row is precisely what has no context yet.
 */
export async function runAsTenantJob<T>(
  dataSource: DataSource,
  organizationId: string,
  work: () => Promise<T>,
): Promise<T> {
  if (!organizationId) {
    throw new Error(
      'A background job that reads tenant data must carry its organizationId. Without it the ' +
        'row-level policies deny every row and the job appears to succeed having done nothing.',
    );
  }

  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.query(`SELECT set_config('app.current_organization', $1, false)`, [organizationId]);

  try {
    return await runInTenantContext(
      { organizationId, manager: dataSource.createEntityManager(runner) },
      work,
    );
  } finally {
    // RESET, never an empty string: the connection returns to a shared pool, and a value left
    // behind would be inherited by whoever picks it up next.
    await runner.query(`RESET app.current_organization`).catch(() => undefined);
    await runner.release().catch(() => undefined);
  }
}

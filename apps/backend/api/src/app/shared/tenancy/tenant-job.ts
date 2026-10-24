import { DataSource, EntityManager } from 'typeorm';
import { currentTenantStore, runInTenantContext } from './tenant-context';

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

/**
 * Database work as one tenant, on the connection the current unit of work already holds — or, when
 * it holds none (a route under `ShortLivedConnections` while it waits on a model), on one opened
 * for just this work and given back straight after.
 */
export function withTenant<T>(dataSource: DataSource, organizationId: string, work: () => Promise<T>): Promise<T> {
  return currentTenantStore() ? work() : runAsTenantJob(dataSource, organizationId, work);
}

/**
 * Runs `work` once per tenant, each inside that tenant's own context.
 *
 * The shape every scheduled job that acts for all tenants needs. A cron has no request, so a query
 * it runs directly sees no tenant and — under the row-level policies, with the application
 * connected as the unprivileged role — no rows: the job runs on schedule and silently does
 * nothing. `organizations` is the directory of tenants and has no policy, so it can be listed
 * without a context; everything else happens inside `runAsTenantJob`.
 *
 * One tenant failing never stops the others; the failure is handed to `onError`.
 *
 * @param only restricts the run to these tenants (tests, or a job retried for one company).
 */
export async function forEachTenant(
  dataSource: DataSource,
  work: (organizationId: string) => Promise<void>,
  only?: readonly string[],
  onError: (organizationId: string, error: unknown) => void = (organizationId, error) =>
    console.error(`Tenant job failed for ${organizationId}: ${(error as Error)?.message ?? error}`),
): Promise<void> {
  const ids: string[] = only?.length
    ? [...only]
    : (await dataSource.query(`SELECT "id" FROM "organizations" ORDER BY "created_at" ASC`)).map(
        (row: { id: string }) => row.id,
      );
  for (const organizationId of ids) {
    try {
      await runAsTenantJob(dataSource, organizationId, () => work(organizationId));
    } catch (error) {
      onError(organizationId, error);
    }
  }
}

/**
 * Da contexto de inquilino a una transacción que acaba de CREAR ese inquilino.
 *
 * ## El problema del huevo y la gallina
 *
 * Provisionar una empresa nueva —su catálogo de cuentas, sus segmentos, sus impuestos— escribe
 * filas de un inquilino que todavía no existía cuando la petición empezó. No hay contexto que
 * heredar: el alta ocurre precisamente ANTES de que haya empresa a la que pertenecer. Con las
 * políticas en vigor, `WITH CHECK` rechaza esas escrituras —«new row violates row-level security
 * policy»—, y el alta falla entera.
 *
 * Que falle es correcto: la alternativa sería que las políticas no gobernasen la escritura, y
 * entonces un inquilino podría crear filas estampadas con el id de otro. Lo que hace falta es
 * decirle a la transacción, en cuanto la empresa tiene id, que a partir de ahí actúa como ella.
 *
 * ## Por qué `local = true`
 *
 * El ajuste se limita a ESTA transacción y se deshace al terminar, con commit o con rollback. Un
 * `set_config(..., false)` dentro de una transacción dejaría el valor pegado a la conexión, que
 * vuelve a un pool compartido: quien la cogiera después heredaría el contexto de una empresa que
 * no es la suya, y eso es exactamente la fuga que las políticas existen para impedir.
 */
export async function stampTenantOnTransaction(
  manager: EntityManager,
  organizationId: string,
): Promise<void> {
  await manager.query(`SELECT set_config('app.current_organization', $1, true)`, [organizationId]);
}

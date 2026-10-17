import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryRunner } from 'typeorm';
import { Observable, defer, from, switchMap } from 'rxjs';
import { finalize } from 'rxjs/operators';
import { AuthenticatedRequest } from '@virteex/shared/util-auth';
import { runInTenantContext } from './tenant-context';

/**
 * Pins each request to one connection and stamps the tenant on it.
 *
 * ## Why a connection and not a transaction
 *
 * The tenant setting lives on a connection, so the request's queries have to share one. A
 * transaction would also achieve that, and would additionally force every read into a transaction
 * it does not need and change the semantics of the 96 places that open their own. Holding a query
 * runner gives the same connection affinity without imposing that.
 *
 * The cost is honest and worth naming: a request occupies a pool connection for its whole life,
 * including time spent on work that is not database work. For an ERP, where nearly every request is
 * database-bound anyway, that is a fair trade for an isolation guarantee the application cannot
 * forget to apply. The pool size becomes the concurrency limit, which is a knob rather than a
 * surprise.
 *
 * ## Why RESET matters as much as SET
 *
 * The connection goes back to a shared pool. A setting left behind would be inherited by whoever
 * picks it up next — one tenant reading another's data through a stale variable, which is the exact
 * failure the policies exist to prevent. `finalize` runs on success, error and unsubscribe alike.
 *
 * Requests without a tenant — signing in, the health probe, a Stripe webhook — pass straight
 * through. They must: authentication runs before there is an organization to bind to.
 *
 * ## Por qué el contexto envuelve la suscripción
 *
 * Ver el comentario en `switchMap`. En resumen: un interceptor de dentro que aplaza
 * `next.handle()` tras una promesa ejecutaba el manejador fuera del contexto, y entonces el
 * inquilino no viajaba. Envolver la suscripción cubre a cualquier interceptor que aplace, no
 * solo al que lo hacía hoy.
 */
/** How long a transaction left open by late work may run before it is rolled back. */
const TRANSACTION_GRACE_MS = 5_000;

@Injectable()
export class TenantConnectionInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TenantConnectionInterceptor.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const organizationId = request.user?.organizationId;

    if (!organizationId) return next.handle();

    return defer(() => {
      const queryRunner = this.dataSource.createQueryRunner();

      return from(
        queryRunner.connect().then(async () => {
          // `set_config` rather than `SET`, because SET takes no parameters and building the
          // statement by hand would put a caller-influenced value into SQL text.
          await queryRunner.query(`SELECT set_config('app.current_organization', $1, false)`, [
            organizationId,
          ]);
          return queryRunner;
        }),
      ).pipe(
        switchMap((runner) => {
          const store = {
            organizationId,
            manager: this.dataSource.createEntityManager(runner),
          };

          // El contexto se abre alrededor de la SUSCRIPCIÓN, no de la construcción.
          //
          // `runInTenantContext(store, () => next.handle())` parecía bastar y no bastaba.
          // `next.handle()` devuelve un observable; quién ejecuta el manejador es quien se
          // SUSCRIBE a él. Cuando todos los interceptores de dentro llaman a `next.handle()` en
          // el acto, la suscripción cae dentro de la llamada y el almacén está puesto. Pero un
          // interceptor que APLAZA —`from(promesa).pipe(switchMap(() => next.handle()))`, que es
          // exactamente lo que hace el de idempotencia— llama al manejador en un microtask
          // posterior, y ese microtask heredaba un contexto sin inquilino: la transacción del
          // servicio cogía una conexión limpia del pool, sin `app.current_organization`, y las
          // políticas no veían NADA. No era un error visible, era una tabla vacía.
          //
          // Rompía las 17 rutas con `@Idempotent()`, que son justo las que mueven dinero:
          // contabilizar un asiento, aprobar y pagar una factura de proveedor, emitir una
          // factura, registrar un cobro, crear una orden de compra, dar de baja un activo, el
          // cierre anual y una transferencia de tesorería.
          return new Observable<unknown>((subscriber) =>
            runInTenantContext(store, () => next.handle().subscribe(subscriber)),
          ).pipe(
            finalize(() => {
              void this.returnToPool(runner, organizationId);
            }),
          );
        }),
      );
    });
  }

  /**
   * Hands the pinned connection back clean: no tenant variable and, above all, no open transaction.
   *
   * A transaction still active at this point belongs to work that outlived its request — a write
   * fired without being awaited, or a handler interrupted by an aborted request. Releasing the
   * connection as it was (which is what happened before) gave the pool a connection that was
   * "idle in transaction": its row locks stayed held, every later request that touched those rows
   * waited, the pool drained, and the whole API stopped answering every tenant (QA C-01). Rolling
   * back is the only safe choice here — the work that owned the transaction can no longer finish
   * on a released runner anyway — and it is logged loudly so the caller that leaked gets fixed.
   */
  /**
   * Lets a transaction that outlived its request finish — a late audit row is legitimate work —
   * and rolls it back only if it is still open after a short grace period.
   */
  private async settleTransaction(runner: QueryRunner, organizationId: string): Promise<void> {
    if (!runner.isTransactionActive) return;
    const deadline = Date.now() + TRANSACTION_GRACE_MS;
    while (runner.isTransactionActive && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (!runner.isTransactionActive) return;
    this.logger.error(
      `Conexión devuelta con una transacción abierta (organización ${organizationId}); ` +
        'se revierte para no dejar bloqueos. Algún trabajo de la petición no se esperó.',
    );
    await runner.rollbackTransaction().catch(() => runner.query('ROLLBACK'));
  }

  private async returnToPool(runner: QueryRunner, organizationId: string): Promise<void> {
    try {
      await this.settleTransaction(runner, organizationId);
      // RESET, not set_config to '': it returns the variable to unset, which is what the
      // policies read as "no tenant". Assigning an empty string leaves a value behind that
      // is not a uuid.
      await runner.query(`RESET app.current_organization`);
      // Checked again with no `await` between the check and the release below: work that started
      // a transaction while RESET was in flight is caught here, before the pool can hand the
      // connection to anyone else (`startTransaction` sets the flag synchronously).
      await this.settleTransaction(runner, organizationId);
    } catch (error) {
      // A connection whose state could not be verified must not be reused by another tenant:
      // releasing it WITH an error makes pg-pool destroy it instead of returning it.
      const discard = (runner as unknown as { releasePostgresConnection?: (err: unknown) => Promise<void> })
        .releasePostgresConnection;
      if (discard) {
        await discard.call(runner, error).catch(() => undefined);
        return;
      }
    }
    await runner.release().catch(() => undefined);
  }
}

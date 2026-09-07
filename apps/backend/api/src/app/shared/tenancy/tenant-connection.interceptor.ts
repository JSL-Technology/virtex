import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
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
 */
@Injectable()
export class TenantConnectionInterceptor implements NestInterceptor {
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
        switchMap((runner) =>
          runInTenantContext(
            { organizationId, manager: this.dataSource.createEntityManager(runner) },
            () => next.handle(),
          ).pipe(
            finalize(() => {
              // RESET, not set_config to '': it returns the variable to unset, which is what the
              // policies read as "no tenant". Assigning an empty string leaves a value behind that
              // is not a uuid.
              void runner
                .query(`RESET app.current_organization`)
                .catch(() => undefined)
                .finally(() => void runner.release().catch(() => undefined));
            }),
          ),
        ),
      );
    });
  }
}

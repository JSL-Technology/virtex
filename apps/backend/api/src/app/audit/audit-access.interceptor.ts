import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { AuditTrailService } from './audit.service';
import { ActionType } from './entities/audit-log.entity';
import { AUDIT_ACCESS_KEY, AuditAccessOptions } from './audit-access.decorator';

/**
 * The other half of an audit trail: who looked.
 *
 * `ActionType` had no value for reading anything, so an accounting product shipped with an audit
 * of every change to financial data and none at all of access to it. Who opened the general
 * ledger, who exported the 607 for a period they do not work on, who pulled the customer list the
 * week before resigning — none of it left a trace. For a tenant under external audit, or subject
 * to SOX, an access log is not a feature request.
 *
 * Only endpoints carrying `@AuditAccess` are recorded. Logging every GET would bury the accesses
 * that matter under list refreshes, and an audit table nobody can read is not a control.
 *
 * The row is written after the handler succeeds. A request that was refused — by the permission
 * guard, by the tenant scope — did not access anything, and recording it as an access would make
 * the log's central claim false.
 */
@Injectable()
export class AuditAccessInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditAccessInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly audit: AuditTrailService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const options = this.reflector.getAllAndOverride<AuditAccessOptions | undefined>(
      AUDIT_ACCESS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return next.handle();

    const request = context.switchToHttp().getRequest<{
      user?: { id?: string; organizationId?: string };
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      ip?: string;
      method?: string;
      url?: string;
    }>();

    return next.handle().pipe(
      tap({
        next: () => this.record(options, request),
      }),
    );
  }

  private record(
    options: AuditAccessOptions,
    request: {
      user?: { id?: string; organizationId?: string };
      params?: Record<string, unknown>;
      query?: Record<string, unknown>;
      ip?: string;
      method?: string;
      url?: string;
    },
  ): void {
    const userId = request.user?.id;
    if (!userId) return;

    // What was accessed, not merely that something was. A row saying "read a report" answers no
    // question anybody would ask this table.
    const identifiers: Record<string, unknown> = {};
    for (const key of options.identifiers ?? []) {
      const value = request.params?.[key] ?? request.query?.[key];
      if (value !== undefined) identifiers[key] = value;
    }

    void this.audit
      .record(
        userId,
        options.entity,
        // An access has no single row behind it: what identifies it is the query. The entity's own
        // name is the id, and the parameters that scoped it are the payload.
        options.entity,
        options.action,
        {
          action: options.action === ActionType.EXPORT ? 'export' : 'read',
          endpoint: `${request.method ?? 'GET'} ${request.url ?? ''}`.trim(),
          ...identifiers,
        },
        undefined,
        request.ip,
        request.user?.organizationId ?? null,
      )
      .catch((error: Error) =>
        this.logger.error(
          `No se pudo registrar el acceso a ${options.entity}: ${error.message}`,
        ),
      );
  }
}

import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  UseInterceptors,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityTarget, ObjectLiteral } from 'typeorm';
import { Observable, from, switchMap } from 'rxjs';
import { currentTenantStore } from '../../shared/tenancy/tenant-context';
import { AuthenticatedUser } from '../../security/principal';
import { assertDocumentInScope, loadBranchScope } from './branch.contract';

const BRANCH_SCOPED = 'organizations:branch-scoped-document';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BranchScopedTarget {
  entity: EntityTarget<ObjectLiteral>;
  param: string;
}

/**
 * The document named in the route belongs to one of the caller's branches, or the call is refused.
 *
 *     @Post(':id/void')
 *     @BranchScoped(Invoice)
 *     void(@Param('id') id: string, ...) { ... }
 *
 * ## Why a decorator and not a check in each service method
 *
 * Lists are narrowed in the query, and opening a document by id checks it — but every OTHER thing
 * done to one document (issue, void, pay, receive, convert, edit) went straight to the service by
 * id. A person limited to one store could act on another store's invoice by pasting its id. There
 * are dozens of such routes across sales, purchasing, treasury and point of sale; a check written
 * into each service method is one that the next method forgets. Declared on the route, it is
 * visible in review next to the permission it accompanies.
 *
 * ## Why an interceptor and not a guard
 *
 * Row-level security binds the tenant to the connection in an interceptor, which runs after every
 * guard. A guard reading the document would read it without a tenant and find nothing — and «not
 * found» must not mean «allowed». As an interceptor it runs on the tenant's connection.
 *
 * A document that does not exist passes through, so the handler answers 404 as it always did; a
 * malformed id passes too, for the route's own pipe to refuse. A person with every branch costs one
 * small query and never touches the document.
 */
export function BranchScoped(entity: EntityTarget<ObjectLiteral>, param = 'id'): MethodDecorator & ClassDecorator {
  return applyDecorators(
    SetMetadata(BRANCH_SCOPED, { entity, param } satisfies BranchScopedTarget),
    UseInterceptors(BranchScopeInterceptor),
  );
}

@Injectable()
export class BranchScopeInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const target = this.reflector.getAllAndOverride<BranchScopedTarget | undefined>(BRANCH_SCOPED, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<{ user?: AuthenticatedUser; params?: Record<string, string> }>();
    const user = request.user;
    const id = target ? request.params?.[target.param] : undefined;
    if (!target || !user?.organizationId || !id || !UUID.test(id)) return next.handle();

    return from(this.assertInScope(target.entity, id, user)).pipe(switchMap(() => next.handle()));
  }

  private async assertInScope(entity: EntityTarget<ObjectLiteral>, id: string, user: AuthenticatedUser): Promise<void> {
    const manager = currentTenantStore()?.manager ?? this.dataSource.manager;
    const scope = await loadBranchScope(manager, user.organizationId, user.id);
    if (!scope.allowed) return;
    const row = await manager
      .createQueryBuilder(entity, 'document')
      .select('document.branchId', 'branchId')
      .where('document.id = :id', { id })
      .andWhere('document.organizationId = :organizationId', { organizationId: user.organizationId })
      .getRawOne<{ branchId: string | null }>();
    if (!row) return;
    assertDocumentInScope(scope, row.branchId);
  }
}

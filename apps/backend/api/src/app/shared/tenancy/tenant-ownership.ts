import { EntityManager, EntityTarget, In, ObjectLiteral } from 'typeorm';
import { NotFoundError } from '../../i18n/localized.exception';

/**
 * Proves that ids a request REFERENCES belong to the tenant making it.
 *
 * ## Why this exists
 *
 * Reading a resource by id was already scoped (`where: { id, organizationId }`) everywhere. What
 * was not scoped is the ids that arrive INSIDE a payload and become foreign keys: a parent account,
 * the product on a price-list line, the component of a bill of materials, the GL account of a
 * landed cost, the task of a timesheet. The audit of 2026-10-31 (MT-03) reproduced six of them:
 * the row was written pointing at another company's data, and — where the relation was loaded
 * eagerly — the other company's record came back in the response.
 *
 * Row-level security does not catch this. PostgreSQL checks foreign keys WITHOUT applying RLS, so
 * an INSERT referencing a row the session cannot see still succeeds. The check has to happen in the
 * application, before the write, inside the same transaction; composite `(organization_id, id)`
 * foreign keys are the database-level backstop where the schema allows them.
 *
 * ## The answer when an id is foreign
 *
 * "Not found", exactly as if the id did not exist. Saying "belongs to another tenant" would confirm
 * that it exists, which is itself a leak.
 */
export interface OwnershipOptions {
  /** The localized error key to answer with. Defaults to a generic "referenced record not found". */
  errorKey?: string;
  /**
   * The tenant column, for the few tables that name it differently. A property name when `entity`
   * is a class; a column name when it is a table name.
   */
  tenantColumn?: string;
  /** Field name reported back to the client, so the form can point at the right input. */
  field?: string;
}

const DEFAULT_ERROR = 'common.referenced_record_not_found';

export async function assertTenantOwns<T extends ObjectLiteral>(
  manager: EntityManager,
  /** An entity of this module, or the TABLE NAME of another module's table. */
  entity: EntityTarget<T> | string,
  ids: string | null | undefined | ReadonlyArray<string | null | undefined>,
  organizationId: string,
  options: OwnershipOptions = {},
): Promise<void> {
  const wanted = [...new Set((Array.isArray(ids) ? ids : [ids]).filter((id): id is string => !!id))];
  if (wanted.length === 0) return;
  if (!organizationId) {
    // A reference checked against no tenant is a reference not checked. Refuse rather than pass.
    throw new NotFoundError(options.errorKey ?? DEFAULT_ERROR, { field: options.field ?? null });
  }

  let found: number;
  if (typeof entity === 'string' && /^[a-z_][a-z0-9_]*$/.test(entity)) {
    // A table of ANOTHER module, named rather than imported: importing its entity is exactly the
    // cross-module coupling `verify:boundaries` forbids. The name is a code constant, never input;
    // the pattern above refuses anything that is not a plain identifier.
    const column = options.tenantColumn ?? 'organization_id';
    if (!/^[a-z_][a-z0-9_]*$/.test(column)) throw new Error(`Invalid tenant column: ${column}`);
    const [row] = await manager.query(
      `SELECT COUNT(*)::int AS n FROM "${entity}" WHERE id = ANY($1::uuid[]) AND "${column}" = $2`,
      [wanted, organizationId],
    );
    found = Number(row?.n ?? 0);
  } else {
    const tenantColumn = options.tenantColumn ?? 'organizationId';
    found = await manager.getRepository(entity).count({
      where: { id: In(wanted), [tenantColumn]: organizationId } as never,
    });
  }

  if (found !== wanted.length) {
    throw new NotFoundError(options.errorKey ?? DEFAULT_ERROR, { field: options.field ?? null });
  }
}

/**
 * A person referenced by id (an assignee, an approver, an owner) must be a member of the tenant.
 *
 * Asked of the membership table directly rather than through the identity module's entity, which
 * the module boundary forbids importing here.
 */
export async function assertTenantMember(
  manager: EntityManager,
  userId: string | null | undefined,
  organizationId: string,
  options: Pick<OwnershipOptions, 'errorKey' | 'field'> = {},
): Promise<void> {
  if (!userId) return;
  const [row] = await manager.query(
    `SELECT EXISTS (
       SELECT 1 FROM user_organizations WHERE user_id = $1 AND organization_id = $2
     ) AS member`,
    [userId, organizationId],
  );
  if (!row?.member) {
    throw new NotFoundError(options.errorKey ?? DEFAULT_ERROR, { field: options.field ?? null });
  }
}

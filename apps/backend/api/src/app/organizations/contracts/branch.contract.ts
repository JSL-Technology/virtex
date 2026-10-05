import { EntityManager, JoinColumn, ManyToOne, SelectQueryBuilder, ObjectLiteral } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { UserBranchAccess } from '../entities/user-branch-access.entity';
import { UserOrganization } from '../entities/user-organization.entity';
import { BadRequestError, ForbiddenError } from '../../i18n/localized.exception';

/**
 * The branch a document was issued from, as a constraint and not only a column.
 *
 * Published here — the organizations module's public surface — so sales, purchasing, treasury and
 * point of sale can declare it without importing identity's entities. Always the same meaning:
 * `branch_id → branches.id ON DELETE RESTRICT`. A branch with documents is deactivated, never
 * deleted, because a document must keep saying where it was issued.
 *
 *     @Column({ name: 'branch_id', type: 'uuid', nullable: true })
 *     branchId: string | null;
 *
 *     @IssuedAtBranch('FK_invoices_branch')
 *     branch?: BranchRef | null;
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function IssuedAtBranch(constraintName: string): PropertyDecorator {
  const relation = ManyToOne(() => Branch, { nullable: true, onDelete: 'NO ACTION' });
  const join = JoinColumn({ name: 'branch_id', foreignKeyConstraintName: constraintName });
  return (target, propertyKey) => {
    join(target, propertyKey);
    relation(target, propertyKey);
  };
}

/** What a document can know about its branch without importing identity's entity. */
export interface BranchRef {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

/**
 * Where one person may work inside one company.
 *
 * `allowed` null means every branch. A list of ids means only those — and an empty list cannot
 * happen, because an empty restriction is stored as no rows, which is «every branch».
 */
export interface BranchScope {
  allowed: string[] | null;
  defaultBranchId: string | null;
}

export async function loadBranchScope(
  manager: EntityManager,
  organizationId: string,
  userId: string | null,
): Promise<BranchScope> {
  // No person behind the call — a scheduled job, a system import — means no personal limits and
  // no personal default: the document falls back to the headquarters.
  if (!userId) return { allowed: null, defaultBranchId: null };
  const [rows, membership] = await Promise.all([
    manager.find(UserBranchAccess, { where: { organizationId, userId }, select: { branchId: true } }),
    manager.findOne(UserOrganization, { where: { organizationId, userId }, select: { defaultBranchId: true } }),
  ]);
  return {
    allowed: rows.length ? rows.map((row) => row.branchId) : null,
    defaultBranchId: membership?.defaultBranchId ?? null,
  };
}

/**
 * The branch a new document is issued from.
 *
 * The one requested, if the person may use it; otherwise their default branch; otherwise the
 * headquarters — so a company that has set up branches never gets a document from nowhere, and a
 * company that has none keeps issuing documents exactly as before (`null`).
 *
 * Refuses a branch of another company, an inactive branch, and a branch outside the person's
 * scope. Those are the three ways a document could claim to come from a place it did not.
 */
export async function resolveDocumentBranch(
  manager: EntityManager,
  organizationId: string,
  userId: string | null,
  requestedBranchId?: string | null,
): Promise<string | null> {
  const scope = await loadBranchScope(manager, organizationId, userId);

  if (requestedBranchId) {
    await assertBranchUsable(manager, organizationId, scope, requestedBranchId);
    return requestedBranchId;
  }

  const candidates = [scope.defaultBranchId];
  if (scope.allowed?.length === 1) candidates.push(scope.allowed[0]);
  for (const candidate of candidates) {
    if (!candidate) continue;
    const usable = await manager.findOne(Branch, { where: { id: candidate, organizationId, isActive: true } });
    if (usable && (!scope.allowed || scope.allowed.includes(usable.id))) return usable.id;
  }

  const headquarters = await manager.findOne(Branch, { where: { organizationId, isHeadquarters: true, isActive: true } });
  if (headquarters && (!scope.allowed || scope.allowed.includes(headquarters.id))) return headquarters.id;

  if (scope.allowed) {
    // Restricted to several branches with no default: there is no right guess.
    throw new BadRequestError('organizations.branches.branch_required');
  }
  return null;
}

/**
 * The branch of a draft being edited: unchanged unless another one is asked for, and then only one
 * the editor may use — the same three refusals as on creation. A draft may move, an issued document
 * may not; callers only reach this for documents still editable.
 */
export async function reassignDocumentBranch(
  manager: EntityManager,
  organizationId: string,
  actorUserId: string | null,
  current: string | null,
  requested: string | null | undefined,
): Promise<string | null> {
  if (requested === undefined || requested === null || requested === current) return current;
  return resolveDocumentBranch(manager, organizationId, actorUserId, requested);
}

export async function assertBranchUsable(
  manager: EntityManager,
  organizationId: string,
  scope: BranchScope,
  branchId: string,
): Promise<void> {
  const branch = await manager.findOne(Branch, { where: { id: branchId, organizationId } });
  if (!branch) throw new BadRequestError('organizations.branches.not_found');
  if (!branch.isActive) throw new BadRequestError('organizations.branches.inactive');
  if (scope.allowed && !scope.allowed.includes(branchId)) {
    throw new ForbiddenError('organizations.branches.outside_your_scope');
  }
}

/**
 * Narrows a document query to the person's branches.
 *
 * Documents with no branch — issued before the company set branches up — stay visible only to
 * people with every branch: a restricted person sees their branches' documents and nothing else.
 */
export function applyBranchScope<T extends ObjectLiteral>(
  query: SelectQueryBuilder<T>,
  alias: string,
  scope: BranchScope,
  requestedBranchId?: string | null,
): SelectQueryBuilder<T> {
  if (requestedBranchId) {
    // It arrives from a query string: a malformed id is a bad request, not a database error.
    if (!UUID.test(requestedBranchId)) throw new BadRequestError('organizations.branches.not_found');
    if (scope.allowed && !scope.allowed.includes(requestedBranchId)) {
      throw new ForbiddenError('organizations.branches.outside_your_scope');
    }
    return query.andWhere(`${alias}.branchId = :scopeBranchId`, { scopeBranchId: requestedBranchId });
  }
  if (scope.allowed) {
    return query.andWhere(`${alias}.branchId IN (:...scopeAllowedBranches)`, { scopeAllowedBranches: scope.allowed });
  }
  return query;
}

/**
 * Refuses a document from outside the person's branches.
 *
 * Applied where one document is opened by id, so a restricted person cannot reach by URL what the
 * list already hides from them. A document with no branch is visible only to people with every
 * branch, exactly as in the list.
 */
export function assertDocumentInScope(scope: BranchScope, branchId: string | null | undefined): void {
  if (!scope.allowed) return;
  if (!branchId || !scope.allowed.includes(branchId)) {
    throw new ForbiddenError('organizations.branches.outside_your_scope');
  }
}

/**
 * The warehouse a branch's documents take stock from by default, when it has one set.
 *
 * Read here so inventory can place a sale or a receipt without importing identity's entities.
 */
export async function branchDefaultWarehouseId(
  manager: EntityManager,
  organizationId: string,
  branchId: string | null | undefined,
): Promise<string | null> {
  if (!branchId) return null;
  const branch = await manager.findOne(Branch, {
    where: { id: branchId, organizationId },
    select: { id: true, defaultWarehouseId: true },
  });
  return branch?.defaultWarehouseId ?? null;
}

/**
 * The fiscal establishment and emission point a branch issues from, when it has both.
 *
 * Markets that number per establishment (Ecuador's `002-001-…`) read this so a document issued at
 * a branch carries that branch's codes and draws from that emission point's own sequence. Null
 * when the document has no branch or the branch has not been given both codes — the market's
 * tenant-wide configuration applies then, exactly as before branches existed.
 */
export async function branchFiscalCodes(
  manager: EntityManager,
  organizationId: string,
  branchId: string | null | undefined,
): Promise<{ establishment: string; emissionPoint: string } | null> {
  if (!branchId) return null;
  const branch = await manager.findOne(Branch, {
    where: { id: branchId, organizationId },
    select: { id: true, fiscalEstablishmentCode: true, emissionPointCode: true },
  });
  if (!branch?.fiscalEstablishmentCode || !branch.emissionPointCode) return null;
  return { establishment: branch.fiscalEstablishmentCode, emissionPoint: branch.emissionPointCode };
}

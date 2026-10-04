import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, QueryFailedError, Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { UserBranchAccess } from '../entities/user-branch-access.entity';
import { UserOrganization } from '../entities/user-organization.entity';
import { CreateBranchDto, SetUserBranchAccessDto, UpdateBranchDto } from '../dto/branch.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../../i18n/localized.exception';
import { loadBranchScope } from '../contracts/branch.contract';

/** A branch with how many people are limited to it. */
export interface BranchSummary extends Branch {
  restrictedUserCount: number;
}

/** The branches one person may use, for the pickers on documents. */
export interface MyBranches {
  /** Where the person may issue documents: their branches that are open. */
  branches: Pick<Branch, 'id' | 'code' | 'name' | 'isHeadquarters'>[];
  /**
   * Their branches that were closed. Never offered for a new document, but the documents they
   * issued still name them, so a list or a detail can label them instead of showing an id.
   */
  closed: Pick<Branch, 'id' | 'code' | 'name'>[];
  defaultBranchId: string | null;
  /** True when the person is limited to the listed branches rather than seeing all of them. */
  restricted: boolean;
}

export interface UserBranchAccessView {
  userId: string;
  branchIds: string[];
  defaultBranchId: string | null;
}

/**
 * The company's branches and who may work in which.
 *
 * Rules kept here, in one place:
 *   - the first branch is the headquarters; there is never more than one, and it cannot be
 *     deactivated while it is the headquarters (move the title first);
 *   - a branch referenced by any document is deactivated, never deleted;
 *   - a branch's default warehouse is one of that branch's own warehouses;
 *   - a person's default branch is one they may use.
 */
@Injectable()
export class BranchesService {
  constructor(
    @InjectRepository(Branch) private readonly branches: Repository<Branch>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(organizationId: string): Promise<BranchSummary[]> {
    const [list, restricted] = await Promise.all([
      this.branches.find({ where: { organizationId }, order: { isHeadquarters: 'DESC', code: 'ASC' } }),
      this.dataSource
        .getRepository(UserBranchAccess)
        .createQueryBuilder('access')
        .select('access.branchId', 'branchId')
        .addSelect('COUNT(access.userId)', 'count')
        .where('access.organizationId = :organizationId', { organizationId })
        .groupBy('access.branchId')
        .getRawMany<{ branchId: string; count: string }>(),
    ]);
    const counts = new Map(restricted.map((row) => [row.branchId, Number(row.count)]));
    return list.map((branch) => Object.assign(branch, { restrictedUserCount: counts.get(branch.id) ?? 0 }));
  }

  async findOne(id: string, organizationId: string): Promise<Branch> {
    const branch = await this.branches.findOne({ where: { id, organizationId } });
    if (!branch) throw new NotFoundError('organizations.branches.not_found');
    return branch;
  }

  /** The active branches the caller may issue documents from, and their default. */
  async mine(organizationId: string, userId: string): Promise<MyBranches> {
    const scope = await loadBranchScope(this.dataSource.manager, organizationId, userId);
    const where = scope.allowed ? { organizationId, id: In(scope.allowed) } : { organizationId };
    const rows = await this.branches.find({
      where,
      order: { isHeadquarters: 'DESC', code: 'ASC' },
      select: { id: true, code: true, name: true, isHeadquarters: true, isActive: true },
    });
    const branches = rows
      .filter((b) => b.isActive)
      .map(({ id, code, name, isHeadquarters }) => ({ id, code, name, isHeadquarters }));
    const closed = rows.filter((b) => !b.isActive).map(({ id, code, name }) => ({ id, code, name }));
    const defaultBranchId =
      scope.defaultBranchId && branches.some((b) => b.id === scope.defaultBranchId) ? scope.defaultBranchId : null;
    return { branches, closed, defaultBranchId, restricted: scope.allowed !== null };
  }

  async create(dto: CreateBranchDto, organizationId: string): Promise<Branch> {
    return this.dataSource.transaction(async (manager) => {
      const code = normalizeCode(dto.code);
      await this.assertCodeFree(manager, organizationId, code);
      const existing = await manager.count(Branch, { where: { organizationId } });
      // The first branch a company declares is where it is registered.
      const isHeadquarters = existing === 0 ? true : dto.isHeadquarters === true;
      if (isHeadquarters) await this.clearHeadquarters(manager, organizationId);

      const branch = manager.create(Branch, {
        organizationId,
        code,
        name: dto.name.trim(),
        address: dto.address ?? null,
        city: dto.city ?? null,
        state: dto.state ?? null,
        postalCode: dto.postalCode ?? null,
        phone: dto.phone ?? null,
        fiscalEstablishmentCode: dto.fiscalEstablishmentCode ?? null,
        emissionPointCode: dto.emissionPointCode ?? null,
        defaultWarehouseId: null,
        isHeadquarters,
        isActive: true,
      });
      const saved = await manager.save(branch);
      if (dto.defaultWarehouseId) {
        await this.assertWarehouseOfBranch(manager, organizationId, saved.id, dto.defaultWarehouseId);
        saved.defaultWarehouseId = dto.defaultWarehouseId;
        await manager.save(saved);
      }
      return saved;
    });
  }

  async update(id: string, dto: UpdateBranchDto, organizationId: string): Promise<Branch> {
    return this.dataSource.transaction(async (manager) => {
      const branch = await manager.findOne(Branch, { where: { id, organizationId } });
      if (!branch) throw new NotFoundError('organizations.branches.not_found');

      if (dto.code !== undefined) {
        const code = normalizeCode(dto.code);
        if (code !== branch.code) await this.assertCodeFree(manager, organizationId, code);
        branch.code = code;
      }
      if (dto.name !== undefined) branch.name = dto.name.trim();
      if (dto.address !== undefined) branch.address = dto.address;
      if (dto.city !== undefined) branch.city = dto.city;
      if (dto.state !== undefined) branch.state = dto.state;
      if (dto.postalCode !== undefined) branch.postalCode = dto.postalCode;
      if (dto.phone !== undefined) branch.phone = dto.phone;
      if (dto.fiscalEstablishmentCode !== undefined) branch.fiscalEstablishmentCode = dto.fiscalEstablishmentCode;
      if (dto.emissionPointCode !== undefined) branch.emissionPointCode = dto.emissionPointCode;
      if (dto.defaultWarehouseId !== undefined) {
        if (dto.defaultWarehouseId) await this.assertWarehouseOfBranch(manager, organizationId, branch.id, dto.defaultWarehouseId);
        branch.defaultWarehouseId = dto.defaultWarehouseId ?? null;
      }

      if (dto.isHeadquarters === true && !branch.isHeadquarters) {
        if (dto.isActive === false || !branch.isActive) throw new BadRequestError('organizations.branches.headquarters_must_be_active');
        await this.clearHeadquarters(manager, organizationId);
        branch.isHeadquarters = true;
      } else if (dto.isHeadquarters === false && branch.isHeadquarters) {
        // The title moves by naming another branch, never by removing it: documents fall back to it.
        throw new BadRequestError('organizations.branches.headquarters_move_instead');
      }

      if (dto.isActive !== undefined) {
        if (dto.isActive === false && branch.isHeadquarters) {
          throw new BadRequestError('organizations.branches.headquarters_cannot_deactivate');
        }
        branch.isActive = dto.isActive;
      }
      return manager.save(branch);
    });
  }

  /** Only a branch nothing was ever issued from; anything else is deactivated. */
  async remove(id: string, organizationId: string): Promise<void> {
    const branch = await this.findOne(id, organizationId);
    if (branch.isHeadquarters) throw new BadRequestError('organizations.branches.headquarters_cannot_delete');
    try {
      await this.branches.delete({ id: branch.id, organizationId });
    } catch (error) {
      if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23503') {
        throw new ConflictError('organizations.branches.in_use');
      }
      throw error;
    }
  }

  async getUserAccess(organizationId: string, userId: string): Promise<UserBranchAccessView> {
    await this.assertMember(this.dataSource.manager, organizationId, userId);
    const scope = await loadBranchScope(this.dataSource.manager, organizationId, userId);
    return { userId, branchIds: scope.allowed ?? [], defaultBranchId: scope.defaultBranchId };
  }

  async setUserAccess(organizationId: string, userId: string, dto: SetUserBranchAccessDto): Promise<UserBranchAccessView> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertMember(manager, organizationId, userId);
      const branchIds = [...new Set(dto.branchIds)];
      if (branchIds.length) {
        const found = await manager.count(Branch, { where: { organizationId, id: In(branchIds) } });
        if (found !== branchIds.length) throw new BadRequestError('organizations.branches.not_found');
      }
      const defaultBranchId = dto.defaultBranchId ?? null;
      if (defaultBranchId) {
        const branch = await manager.findOne(Branch, { where: { id: defaultBranchId, organizationId } });
        if (!branch) throw new BadRequestError('organizations.branches.not_found');
        if (!branch.isActive) throw new BadRequestError('organizations.branches.inactive');
        if (branchIds.length && !branchIds.includes(defaultBranchId)) {
          throw new BadRequestError('organizations.branches.default_outside_access');
        }
      }

      await manager.delete(UserBranchAccess, { organizationId, userId });
      if (branchIds.length) {
        await manager.insert(
          UserBranchAccess,
          branchIds.map((branchId) => ({ organizationId, userId, branchId })),
        );
      }
      await manager.update(UserOrganization, { organizationId, userId }, { defaultBranchId });
      return { userId, branchIds, defaultBranchId };
    });
  }

  private async assertMember(manager: EntityManager, organizationId: string, userId: string): Promise<void> {
    const member = await manager.exists(UserOrganization, { where: { organizationId, userId } });
    if (!member) throw new NotFoundError('organizations.branches.user_not_member');
  }

  private async assertCodeFree(manager: EntityManager, organizationId: string, code: string): Promise<void> {
    const taken = await manager.exists(Branch, { where: { organizationId, code } });
    if (taken) throw new ConflictError('organizations.branches.code_taken', { code });
  }

  private async clearHeadquarters(manager: EntityManager, organizationId: string): Promise<void> {
    await manager.update(Branch, { organizationId, isHeadquarters: true }, { isHeadquarters: false });
  }

  /**
   * Warehouses belong to supply chain; this asks the table rather than importing its entity, which
   * the module boundary forbids. Tenant-scoped explicitly as well as by row-level security.
   */
  private async assertWarehouseOfBranch(
    manager: EntityManager,
    organizationId: string,
    branchId: string,
    warehouseId: string,
  ): Promise<void> {
    const rows: { branch_id: string | null }[] = await manager.query(
      `SELECT "branch_id" FROM "warehouses" WHERE "id" = $1 AND "organization_id" = $2`,
      [warehouseId, organizationId],
    );
    if (!rows.length) throw new BadRequestError('organizations.branches.warehouse_not_found');
    if (rows[0].branch_id !== branchId) throw new BadRequestError('organizations.branches.warehouse_of_other_branch');
  }
}

function normalizeCode(code: string): string {
  return code.trim().toUpperCase();
}

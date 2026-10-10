import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Dimension } from './entities/dimension.entity';
import { DimensionValue } from './entities/dimension-value.entity';
import { DimensionRule } from './entities/dimension-rule.entity';
import { CreateDimensionDto, DimensionValueDto, UpdateDimensionDto } from './dto/dimension.dto';
import { CreateDimensionRuleDto } from './dto/dimension-rule.dto';
import { Account } from '../chart-of-accounts/entities/account.entity';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';

/** A value as the screens read it: its parent by code, and whether lines carry it. */
export interface DimensionValueView {
  id: string;
  value: string;
  name: string | null;
  isActive: boolean;
  parent: string | null;
  inUse: boolean;
}

export interface DimensionView {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  /** Lines carry it: its name can no longer change, nor can it be deleted. */
  inUse: boolean;
  values: DimensionValueView[];
}

export interface DimensionRuleView {
  accountId: string;
  accountCode: string;
  accountName: unknown;
  dimensionId: string;
  dimensionName: string;
  isRequired: boolean;
}

/**
 * Analytic dimensions — cost centres, projects, regions, whatever the company analyses its books
 * by — their values, and the rules that make one mandatory on an account.
 *
 * A journal line is tagged by dimension NAME and value CODE (`{"Centro de Costo": "VENTAS"}`), the
 * convention the budget control and the analytical view read. So once lines carry a name or a code
 * it is immutable here: renaming it would silently move the history out of every report. A value
 * no longer wanted is retired with `isActive: false`, which posting then refuses on new lines.
 */
@Injectable()
export class DimensionsService {
  constructor(
    @InjectRepository(Dimension)
    private readonly dimensionRepository: Repository<Dimension>,
    @InjectRepository(DimensionRule)
    private readonly dimensionRuleRepository: Repository<DimensionRule>,
    private readonly dataSource: DataSource,
  ) {}

  async findAll(organizationId: string): Promise<DimensionView[]> {
    const dimensions = await this.dimensionRepository.find({
      where: { organizationId },
      relations: ['values'],
      order: { name: 'ASC' },
    });
    const usage = await this.usage(this.dataSource.manager, organizationId);
    return dimensions.map((dimension) => toView(dimension, usage));
  }

  async findOne(id: string, organizationId: string): Promise<DimensionView> {
    const dimension = await this.load(this.dataSource.manager, id, organizationId);
    return toView(dimension, await this.usage(this.dataSource.manager, organizationId, dimension.name));
  }

  async create(dto: CreateDimensionDto, organizationId: string): Promise<DimensionView> {
    assertValueTree(dto.values);
    const id = await this.dataSource.transaction(async (manager) => {
      const taken = await manager.findOne(Dimension, { where: { organizationId, name: dto.name.trim() } });
      if (taken) throw new ConflictError('dimensions.dimension_name_taken', { name: dto.name.trim() });
      const dimension = await manager.save(
        manager.create(Dimension, {
          organizationId,
          name: dto.name.trim(),
          description: dto.description?.trim() || null,
          isActive: dto.isActive ?? true,
        }),
      );
      await this.writeValues(manager, dimension, [], dto.values);
      return dimension.id;
    });
    return this.findOne(id, organizationId);
  }

  async update(id: string, dto: UpdateDimensionDto, organizationId: string): Promise<DimensionView> {
    if (dto.values) assertValueTree(dto.values);
    await this.dataSource.transaction(async (manager) => {
      const dimension = await this.load(manager, id, organizationId, true);
      const name = dto.name?.trim();
      if (name && name !== dimension.name) {
        await this.assertDimensionUnused(manager, organizationId, dimension.name);
        const taken = await manager.findOne(Dimension, { where: { organizationId, name } });
        if (taken) throw new ConflictError('dimensions.dimension_name_taken', { name });
        dimension.name = name;
      }
      if (dto.description !== undefined) dimension.description = dto.description?.trim() || null;
      if (dto.isActive !== undefined) dimension.isActive = dto.isActive;
      const existing = dimension.values ?? [];
      // Saved without the relation, so the cascade does not rewrite the values behind our back.
      await manager.save(Dimension, { id: dimension.id, name: dimension.name, description: dimension.description, isActive: dimension.isActive, organizationId });
      if (dto.values) await this.writeValues(manager, dimension, existing, dto.values);
    });
    return this.findOne(id, organizationId);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const dimension = await manager.findOne(Dimension, { where: { id, organizationId } });
      if (!dimension) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
      await this.assertDimensionUnused(manager, organizationId, dimension.name);
      await manager.delete(Dimension, { id, organizationId });
    });
  }

  // ── Rules ────────────────────────────────────────────────────────────────

  /** Every account that requires a dimension, for the rules screen. */
  async listRules(organizationId: string): Promise<DimensionRuleView[]> {
    const rows = await this.dimensionRuleRepository
      .createQueryBuilder('rule')
      .innerJoinAndSelect('rule.account', 'account')
      .innerJoinAndSelect('rule.dimension', 'dimension')
      .where('dimension.organizationId = :organizationId', { organizationId })
      .andWhere('account.organizationId = :organizationId', { organizationId })
      .orderBy('account.code', 'ASC')
      .addOrderBy('dimension.name', 'ASC')
      .getMany();
    return rows.map((rule) => ({
      accountId: rule.accountId,
      accountCode: rule.account.code,
      accountName: rule.account.name,
      dimensionId: rule.dimensionId,
      dimensionName: rule.dimension.name,
      isRequired: rule.isRequired,
    }));
  }

  async getRulesForAccount(accountId: string, organizationId: string): Promise<DimensionRule[]> {
    const account = await this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId });
    if (!account) throw new NotFoundError('dimensions.account_account_id_not_found', { accountId });
    return this.dimensionRuleRepository.find({ where: { accountId }, relations: ['dimension'] });
  }

  async createRule(dto: CreateDimensionRuleDto, organizationId: string): Promise<DimensionRule> {
    const { accountId, dimensionId } = dto;
    const [account, dimension] = await Promise.all([
      this.dataSource.getRepository(Account).findOneBy({ id: accountId, organizationId }),
      this.dimensionRepository.findOneBy({ id: dimensionId, organizationId }),
    ]);
    if (!account) throw new NotFoundError('dimensions.account_account_id_not_found_your', { accountId });
    if (!dimension) throw new NotFoundError('dimensions.dimension_dimension_id_not_found_your', { dimensionId });
    if (!account.isPostable) {
      throw new BadRequestError('dimensions.rule_account_not_postable', { code: account.code });
    }
    const existing = await this.dimensionRuleRepository.findOneBy({ accountId, dimensionId });
    if (existing) {
      throw new ConflictError('dimensions.rule_already_exists', { code: account.code, dimension: dimension.name });
    }
    return this.dimensionRuleRepository.save(this.dimensionRuleRepository.create({ accountId, dimensionId, isRequired: true }));
  }

  async deleteRule(accountId: string, dimensionId: string, organizationId: string): Promise<void> {
    const rule = await this.dimensionRuleRepository.findOne({
      where: { accountId, dimensionId },
      relations: ['account'],
    });
    if (!rule || rule.account.organizationId !== organizationId) {
      throw new NotFoundError('dimensions.specified_dimension_rule_not_found');
    }
    await this.dimensionRuleRepository.remove(rule);
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private async load(manager: EntityManager, id: string, organizationId: string, lock = false): Promise<Dimension> {
    if (lock) {
      // Locked before the values are read, so two edits of the same dimension serialise.
      const locked = await manager.findOne(Dimension, {
        where: { id, organizationId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
    }
    const dimension = await manager.findOne(Dimension, { where: { id, organizationId }, relations: ['values'] });
    if (!dimension) throw new NotFoundError('dimensions.dimension_id_not_found', { id });
    return dimension;
  }

  /**
   * Make the dimension's values the ones requested: matched by id, else by code; new ones
   * inserted; missing ones deleted (refused when used); codes renamed (refused when used); then
   * each parent set, which the closure table follows.
   */
  private async writeValues(
    manager: EntityManager,
    dimension: Dimension,
    existing: DimensionValue[],
    requested: DimensionValueDto[],
  ): Promise<void> {
    const repository = manager.getTreeRepository(DimensionValue);
    const byId = new Map(existing.map((value) => [value.id, value]));
    const byCode = new Map(existing.map((value) => [value.value, value]));
    const kept = new Set<string>();
    const saved = new Map<string, DimensionValue>();

    for (const dto of requested) {
      const code = dto.value.trim();
      const current = (dto.id && byId.get(dto.id)) || byCode.get(code);
      if (dto.id && !byId.has(dto.id)) {
        throw new NotFoundError('dimensions.value_not_found', { value: code });
      }
      if (current) {
        if (current.value !== code) {
          await this.assertValueUnused(manager, dimension.organizationId, dimension.name, current.value);
        }
        current.value = code;
        current.name = dto.name?.trim() || null;
        current.isActive = dto.isActive ?? current.isActive;
        kept.add(current.id);
        saved.set(code, current);
      } else {
        const created = repository.create({
          value: code,
          name: dto.name?.trim() || null,
          isActive: dto.isActive ?? true,
          dimension,
          dimensionId: dimension.id,
          parent: null,
        });
        saved.set(code, created);
      }
    }

    const removed = existing.filter((value) => !kept.has(value.id));
    for (const value of removed) {
      await this.assertValueUnused(manager, dimension.organizationId, dimension.name, value.value);
    }
    if (removed.length > 0) await repository.remove(removed);

    // First without parents, so every value exists before any points at it.
    for (const value of saved.values()) {
      value.parent = null;
      value.parentId = null;
      await repository.save(value);
    }
    for (const dto of requested) {
      const parentCode = dto.parent?.trim();
      if (!parentCode) continue;
      const value = saved.get(dto.value.trim()) as DimensionValue;
      const parent = saved.get(parentCode) as DimensionValue;
      value.parent = parent;
      value.parentId = parent.id;
      await repository.save(value);
    }
  }

  /** How many lines carry each dimension and value of the tenant. */
  private async usage(
    manager: EntityManager,
    organizationId: string,
    onlyDimension?: string,
  ): Promise<Map<string, Set<string>>> {
    const rows = await manager.query<{ dimension: string; value: string }[]>(
      `SELECT DISTINCT tag.key AS dimension, tag.value AS value
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
         CROSS JOIN LATERAL jsonb_each_text(COALESCE(l.dimensions, '{}'::jsonb)) AS tag(key, value)
        WHERE e.organization_id = $1
          AND ($2::text IS NULL OR tag.key = $2)`,
      [organizationId, onlyDimension ?? null],
    );
    const usage = new Map<string, Set<string>>();
    for (const row of rows) {
      const values = usage.get(row.dimension) ?? new Set<string>();
      values.add(row.value);
      usage.set(row.dimension, values);
    }
    return usage;
  }

  /** Refuses when any of the tenant's journal lines is tagged with this dimension. */
  private async assertDimensionUnused(manager: EntityManager, organizationId: string, name: string): Promise<void> {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND l.dimensions ? $2`,
      [organizationId, name],
    );
    if (count > 0) throw new ConflictError('dimensions.dimension_in_use', { name, count });
  }

  /** Refuses when any of the tenant's journal lines carries this value of the dimension. */
  private async assertValueUnused(
    manager: EntityManager,
    organizationId: string,
    name: string,
    value: string,
  ): Promise<void> {
    const [{ count }] = await manager.query(
      `SELECT COUNT(*)::int AS count
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND l.dimensions ->> $2 = $3`,
      [organizationId, name, value],
    );
    if (count > 0) throw new ConflictError('dimensions.dimension_value_in_use', { name, value, count });
  }
}

/**
 * The values requested form a forest: unique codes, every parent one of them, no value its own
 * ancestor.
 */
export function assertValueTree(values: readonly DimensionValueDto[]): void {
  const codes = new Set<string>();
  for (const value of values) {
    const code = value.value.trim();
    if (codes.has(code)) throw new BadRequestError('dimensions.value_duplicated', { value: code });
    codes.add(code);
  }
  const parentOf = new Map<string, string>();
  for (const value of values) {
    const parent = value.parent?.trim();
    if (!parent) continue;
    if (!codes.has(parent)) throw new BadRequestError('dimensions.parent_value_not_found', { value: value.value, parent });
    parentOf.set(value.value.trim(), parent);
  }
  for (const start of parentOf.keys()) {
    const seen = new Set<string>([start]);
    let current = parentOf.get(start);
    while (current) {
      if (seen.has(current)) throw new BadRequestError('dimensions.value_cycle', { value: start });
      seen.add(current);
      current = parentOf.get(current);
    }
  }
}

function toView(dimension: Dimension, usage: Map<string, Set<string>>): DimensionView {
  const used = usage.get(dimension.name) ?? new Set<string>();
  const values = [...(dimension.values ?? [])].sort((a, b) => a.value.localeCompare(b.value));
  const codeById = new Map(values.map((value) => [value.id, value.value]));
  return {
    id: dimension.id,
    name: dimension.name,
    description: dimension.description ?? null,
    isActive: dimension.isActive,
    inUse: used.size > 0,
    values: values.map((value) => ({
      id: value.id,
      value: value.value,
      name: value.name ?? null,
      isActive: value.isActive,
      parent: value.parentId ? (codeById.get(value.parentId) ?? null) : null,
      inUse: used.has(value.value),
    })),
  };
}

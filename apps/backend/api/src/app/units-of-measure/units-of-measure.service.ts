import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { UnitOfMeasure } from './entities/unit-of-measure.entity';
import { TenantUnitOfMeasure } from './entities/tenant-unit-of-measure.entity';
import { CreateUnitOfMeasureDto } from './dto/create-unit-of-measure.dto';
import { CreateTenantUnitOfMeasureDto } from './dto/create-tenant-unit-of-measure.dto';
import { ConflictError, NotFoundError } from '../i18n/localized.exception';

/** One unit as the screens list it: the shared catalogue and the company's own, side by side. */
export interface UnitView {
  id: string;
  symbol: string;
  category: string;
  /** Catalogue key for a shared unit; absent for a company unit, which carries `name`. */
  nameKey?: string;
  /** The company's own words for its unit. */
  name?: string;
  scope: 'platform' | 'company';
}

/**
 * Units of measure: a **global** catalogue, plus each company's own (QA M-18).
 *
 * The shared catalogue carries no `organization_id`: a kilogram is a kilogram in every tenant, and
 * writing to it is gated behind the platform permission because it changes reference data for
 * everybody. What a company sells by and nobody else does — «saco de 50 kg», «bulto» — lives in
 * `tenant_units_of_measure`, under row-level security. Products reference a unit by symbol, so the
 * two are interchangeable to everything that uses them; a company symbol may not shadow a shared one.
 */
@Injectable()
export class UnitsOfMeasureService {
  constructor(
    @InjectRepository(UnitOfMeasure)
    private readonly uomRepository: Repository<UnitOfMeasure>,
    @InjectRepository(TenantUnitOfMeasure)
    private readonly tenantUnits: Repository<TenantUnitOfMeasure>,
    private readonly dataSource: DataSource,
  ) {}

  /** The shared catalogue and, when a company is known, its own units. */
  async findAll(organizationId?: string | null): Promise<UnitView[]> {
    // tenant-scope-guard-allow: units of measure are a global reference catalogue (see class doc).
    const shared = await this.uomRepository.find();
    const own = organizationId
      ? await this.tenantUnits.find({ where: { organizationId } })
      : [];
    return [
      ...shared.map((u): UnitView => ({ id: u.id, symbol: u.symbol, category: u.category, nameKey: u.nameKey, scope: 'platform' })),
      ...own.map((u): UnitView => ({ id: u.id, symbol: u.symbol, category: u.category, name: u.name, scope: 'company' })),
    ];
  }

  async create(createUomDto: CreateUnitOfMeasureDto): Promise<UnitOfMeasure> {
    const uom = this.uomRepository.create(createUomDto);
    return this.uomRepository.save(uom);
  }

  /** A unit of the company's own. Its symbol is unique in the company and never a shared one's. */
  async createForTenant(organizationId: string, dto: CreateTenantUnitOfMeasureDto): Promise<UnitView> {
    // tenant-scope-guard-allow: checking the global catalogue for a clashing symbol.
    const clashesShared = await this.uomRepository.exists({ where: { symbol: dto.symbol } });
    const clashesOwn = await this.tenantUnits.exists({ where: { organizationId, symbol: dto.symbol } });
    if (clashesShared || clashesOwn) {
      throw new ConflictError('uom.errors.symbol_taken', { symbol: dto.symbol });
    }
    const saved = await this.tenantUnits.save(this.tenantUnits.create({ ...dto, organizationId }));
    return { id: saved.id, symbol: saved.symbol, category: saved.category, name: saved.name, scope: 'company' };
  }

  /** Removes a company unit no product uses; one in use is named as such, not silently orphaned. */
  async removeForTenant(organizationId: string, id: string): Promise<void> {
    const unit = await this.tenantUnits.findOne({ where: { id, organizationId } });
    if (!unit) throw new NotFoundError('uom.errors.not_found', { id });
    const rows: Array<{ count: number }> = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM "products" WHERE "organization_id" = $1 AND "unit_of_measure" = $2`,
      [organizationId, unit.symbol],
    );
    const inUse = Number(rows[0]?.count ?? 0);
    if (inUse > 0) {
      throw new ConflictError('uom.errors.in_use', { symbol: unit.symbol, count: inUse });
    }
    await this.tenantUnits.remove(unit);
  }
}

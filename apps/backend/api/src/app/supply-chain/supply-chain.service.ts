import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateBinLocationDto } from './dto/create-bin-location.dto';
import { UpdateBinLocationDto } from './dto/update-bin-location.dto';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { UpdateLandedCostDto } from './dto/update-landed-cost.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { assertNotInUse } from '../common/database/dependents';
import { assertBranchUsable } from '../organizations/contracts/branch.contract';

/**
 * Warehouse management master data: warehouses, bin locations and landed-cost schemes.
 *
 * Declared as entities with no service and no controller. This is the tenant-scoped register that
 * inventory and procurement build on. Every query is scoped by `organizationId`, and a bin
 * location can only be attached to a warehouse of the same tenant.
 */
@Injectable()
export class SupplyChainService {
  constructor(
    @InjectRepository(Warehouse)
    private readonly warehouseRepository: Repository<Warehouse>,
    @InjectRepository(BinLocation)
    private readonly binLocationRepository: Repository<BinLocation>,
    @InjectRepository(LandedCost)
    private readonly landedCostRepository: Repository<LandedCost>,
  ) {}

  // ── Warehouses ───────────────────────────────────────────────────────────────

  findAllWarehouses(organizationId: string, branchId?: string): Promise<Warehouse[]> {
    return this.warehouseRepository.find({
      where: branchId ? { organizationId, branchId } : { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOneWarehouse(id: string, organizationId: string): Promise<Warehouse> {
    const warehouse = await this.warehouseRepository.findOne({
      where: { id, organizationId },
    });
    if (!warehouse) {
      throw new NotFoundError('wms.warehouse_not_found', { id });
    }
    return warehouse;
  }

  /** A company's first warehouse is its default: stock must always have somewhere to go. */
  async createWarehouse(dto: CreateWarehouseDto, organizationId: string): Promise<Warehouse> {
    if (dto.branchId) await this.assertBranch(organizationId, dto.branchId);
    return this.warehouseRepository.manager.transaction(async (manager) => {
      const hasDefault = await manager.exists(Warehouse, { where: { organizationId, isDefault: true } });
      const makeDefault = dto.isDefault === true || !hasDefault;
      if (makeDefault) await this.clearDefault(manager, organizationId);
      return manager.save(
        manager.create(Warehouse, {
          ...dto,
          branchId: dto.branchId ?? null,
          organizationId,
          isActive: makeDefault ? true : (dto.isActive ?? true),
          isDefault: makeDefault,
        }),
      );
    });
  }

  /**
   * Edit a warehouse.
   *
   * The default moves by designating another warehouse, never by un-designating this one, so there
   * is always exactly one. A warehouse is closed only once empty and not the default: stock in a
   * closed warehouse could be neither sold nor counted, and the default is where documents with
   * nowhere else to go put their stock.
   */
  async updateWarehouse(
    id: string,
    dto: UpdateWarehouseDto,
    organizationId: string,
  ): Promise<Warehouse> {
    const warehouse = await this.findOneWarehouse(id, organizationId);
    if (dto.branchId) await this.assertBranch(organizationId, dto.branchId);
    if (dto.isDefault === false && warehouse.isDefault) {
      throw new BadRequestError('supply_chain.default_warehouse_move_instead');
    }
    return this.warehouseRepository.manager.transaction(async (manager) => {
      const closing = dto.isActive === false && warehouse.isActive;
      if (closing) {
        if (warehouse.isDefault && dto.isDefault !== true) {
          throw new BadRequestError('supply_chain.default_warehouse_cannot_close');
        }
        const [{ held }] = await manager.query<{ held: string | null }[]>(
          `SELECT SUM(ABS("quantity_on_hand")) AS "held" FROM "stock_levels" WHERE "warehouse_id" = $1`,
          [id],
        );
        if (Number(held ?? 0) > 0) {
          throw new BadRequestError('supply_chain.warehouse_holds_stock', { name: warehouse.name });
        }
      }
      if (dto.isDefault === true && !warehouse.isDefault) {
        if (dto.isActive === false || !warehouse.isActive) {
          throw new BadRequestError('supply_chain.default_warehouse_must_be_active');
        }
        await this.clearDefault(manager, organizationId);
      }
      const { isDefault, ...changes } = dto;
      const merged = manager.merge(Warehouse, warehouse, changes);
      if (isDefault === true) merged.isDefault = true;
      return manager.save(Warehouse, merged);
    });
  }

  private async clearDefault(manager: EntityManager, organizationId: string): Promise<void> {
    await manager.update(Warehouse, { organizationId, isDefault: true }, { isDefault: false });
  }

  /** A warehouse is assigned to one of this company's active branches, or to none. */
  private assertBranch(organizationId: string, branchId: string): Promise<void> {
    return assertBranchUsable(this.warehouseRepository.manager, organizationId, { allowed: null, defaultBranchId: null }, branchId);
  }

  /** A warehouse that holds bins or stock is deactivated, not deleted: the stock is somewhere. */
  async removeWarehouse(id: string, organizationId: string): Promise<void> {
    const warehouse = await this.findOneWarehouse(id, organizationId);
    if (warehouse.isDefault) throw new BadRequestError('supply_chain.default_warehouse_cannot_delete');
    await this.warehouseRepository.manager.transaction(async (manager) => {
      await assertNotInUse(manager, 'warehouses', id, 'supply_chain.warehouse_in_use_deactivate_instead');
      await manager.delete(Warehouse, { id, organizationId });
    });
  }

  // ── Bin locations ────────────────────────────────────────────────────────────

  findBinLocations(organizationId: string, warehouseId?: string): Promise<BinLocation[]> {
    return this.binLocationRepository.find({
      where: { organizationId, ...(warehouseId ? { warehouseId } : {}) },
      order: { code: 'ASC' },
    });
  }

  async findOneBinLocation(id: string, organizationId: string): Promise<BinLocation> {
    const bin = await this.binLocationRepository.findOne({
      where: { id, organizationId },
    });
    if (!bin) {
      throw new NotFoundError('wms.bin_location_not_found', { id });
    }
    return bin;
  }

  async createBinLocation(
    dto: CreateBinLocationDto,
    organizationId: string,
  ): Promise<BinLocation> {
    await this.findOneWarehouse(dto.warehouseId, organizationId);
    const bin = this.binLocationRepository.create({ ...dto, organizationId });
    return this.binLocationRepository.save(bin);
  }

  async updateBinLocation(
    id: string,
    dto: UpdateBinLocationDto,
    organizationId: string,
  ): Promise<BinLocation> {
    const bin = await this.findOneBinLocation(id, organizationId);
    if (dto.warehouseId) await this.findOneWarehouse(dto.warehouseId, organizationId);
    return this.binLocationRepository.save(
      this.binLocationRepository.merge(bin, dto),
    );
  }

  async removeBinLocation(id: string, organizationId: string): Promise<void> {
    await this.findOneBinLocation(id, organizationId);
    await this.binLocationRepository.manager.transaction(async (manager) => {
      await assertNotInUse(manager, 'bin_locations', id, 'supply_chain.bin_location_in_use');
      await manager.delete(BinLocation, { id, organizationId });
    });
  }

  // ── Landed-cost schemes ──────────────────────────────────────────────────────

  findLandedCosts(organizationId: string): Promise<LandedCost[]> {
    return this.landedCostRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOneLandedCost(id: string, organizationId: string): Promise<LandedCost> {
    const landedCost = await this.landedCostRepository.findOne({
      where: { id, organizationId },
    });
    if (!landedCost) {
      throw new NotFoundError('wms.landed_cost_not_found', { id });
    }
    return landedCost;
  }

  createLandedCost(dto: CreateLandedCostDto, organizationId: string): Promise<LandedCost> {
    const landedCost = this.landedCostRepository.create({ ...dto, organizationId });
    return this.landedCostRepository.save(landedCost);
  }

  async updateLandedCost(
    id: string,
    dto: UpdateLandedCostDto,
    organizationId: string,
  ): Promise<LandedCost> {
    const landedCost = await this.findOneLandedCost(id, organizationId);
    return this.landedCostRepository.save(
      this.landedCostRepository.merge(landedCost, dto),
    );
  }

  async removeLandedCost(id: string, organizationId: string): Promise<void> {
    await this.findOneLandedCost(id, organizationId);
    await this.landedCostRepository.delete({ id, organizationId });
  }
}

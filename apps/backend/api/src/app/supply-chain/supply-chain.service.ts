import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Warehouse } from './entities/warehouse.entity';
import { BinLocation } from './entities/bin-location.entity';
import { LandedCost } from './entities/landed-cost.entity';
import { CreateWarehouseDto } from './dto/create-warehouse.dto';
import { UpdateWarehouseDto } from './dto/update-warehouse.dto';
import { CreateBinLocationDto } from './dto/create-bin-location.dto';
import { UpdateBinLocationDto } from './dto/update-bin-location.dto';
import { CreateLandedCostDto } from './dto/create-landed-cost.dto';
import { UpdateLandedCostDto } from './dto/update-landed-cost.dto';
import { NotFoundError } from '../i18n/localized.exception';

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

  findAllWarehouses(organizationId: string): Promise<Warehouse[]> {
    return this.warehouseRepository.find({
      where: { organizationId },
      order: { name: 'ASC' },
    });
  }

  async findOneWarehouse(id: string, organizationId: string): Promise<Warehouse> {
    const warehouse = await this.warehouseRepository.findOne({
      where: { id, organizationId },
    });
    if (!warehouse) {
      throw new NotFoundError('WMS.WAREHOUSE_NOT_FOUND', { id });
    }
    return warehouse;
  }

  createWarehouse(dto: CreateWarehouseDto, organizationId: string): Promise<Warehouse> {
    const warehouse = this.warehouseRepository.create({ ...dto, organizationId });
    return this.warehouseRepository.save(warehouse);
  }

  async updateWarehouse(
    id: string,
    dto: UpdateWarehouseDto,
    organizationId: string,
  ): Promise<Warehouse> {
    const warehouse = await this.findOneWarehouse(id, organizationId);
    return this.warehouseRepository.save(
      this.warehouseRepository.merge(warehouse, dto),
    );
  }

  async removeWarehouse(id: string, organizationId: string): Promise<void> {
    await this.findOneWarehouse(id, organizationId);
    await this.warehouseRepository.delete({ id, organizationId });
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
      throw new NotFoundError('WMS.BIN_LOCATION_NOT_FOUND', { id });
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
    await this.binLocationRepository.delete({ id, organizationId });
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
      throw new NotFoundError('WMS.LANDED_COST_NOT_FOUND', { id });
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

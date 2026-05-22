
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ProductionOrder } from './entities/production-order.entity';
import { BillOfMaterial } from './entities/bill-of-material.entity';
import { WorkCenter } from './entities/work-center.entity';

@Injectable()
export class ManufacturingService {
  constructor(
    @InjectRepository(ProductionOrder)
    private productionOrderRepository: Repository<ProductionOrder>,
    @InjectRepository(BillOfMaterial)
    private bomRepository: Repository<BillOfMaterial>,
    @InjectRepository(WorkCenter)
    private workCenterRepository: Repository<WorkCenter>
  ) {}

  findAllOrders() {
    return this.productionOrderRepository.find();
  }

  createOrder(data: any) {
    return this.productionOrderRepository.save(data);
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Case } from './entities/case.entity';

@Injectable()
export class CasesService {
  constructor(
    @InjectRepository(Case)
    private readonly caseRepository: Repository<Case>,
  ) {}

  /** The tenant's cases, or one customer's when `customerId` is given (the portal's view). */
  findAll(organizationId: string, options: { customerId?: string } = {}): Promise<Case[]> {
    return this.caseRepository.find({
      where: { organizationId, ...(options.customerId ? { customer: { id: options.customerId } } : {}) },
      order: { createdAt: 'DESC' },
    });
  }
}
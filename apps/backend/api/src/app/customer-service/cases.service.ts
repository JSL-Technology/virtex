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

  findAll(organizationId: string): Promise<Case[]> {
    return this.caseRepository.find({ where: { organizationId } });
  }
}
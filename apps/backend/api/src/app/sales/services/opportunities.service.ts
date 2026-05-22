
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Opportunity } from '../entities/opportunity.entity';

@Injectable()
export class OpportunitiesService {
  constructor(
    @InjectRepository(Opportunity)
    private readonly opportunityRepository: Repository<Opportunity>,
  ) {}

  findAll(organizationId: string): Promise<Opportunity[]> {
    return this.opportunityRepository.find({ where: { organizationId }, relations: ['customer'] });
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Lead } from '../entities/lead.entity';
import { CreateLeadDto } from '../dto/create-lead.dto';
import { Opportunity } from '../entities/opportunity.entity';
import { Customer, CustomerStatus } from '../customers/entities/customer.entity';

@Injectable()
export class LeadsService {
  constructor(
    @InjectRepository(Lead) private readonly leadRepository: Repository<Lead>,
    @InjectRepository(Opportunity) private readonly opportunityRepository: Repository<Opportunity>,
    @InjectRepository(Customer) private readonly customerRepository: Repository<Customer>,
  ) {}

  create(createDto: CreateLeadDto, organizationId: string, ownerId: string): Promise<Lead> {
    const lead = this.leadRepository.create({ ...createDto, organizationId, ownerId });
    return this.leadRepository.save(lead);
  }

  findAll(organizationId: string): Promise<Lead[]> {
    return this.leadRepository.find({ where: { organizationId } });
  }
  
  async convertLeadToOpportunity(leadId: string, organizationId: string): Promise<Opportunity> {
    const lead = await this.leadRepository.findOneBy({ id: leadId, organizationId });
    if (!lead) {
      throw new NotFoundException('Lead no encontrado.');
    }


    let customer = await this.customerRepository.findOneBy({ email: lead.email, organizationId });
    if (!customer) {
      customer = this.customerRepository.create({
        organizationId,
        email: lead.email,
        companyName: lead.companyName,
        phone: lead.phone,
        status: CustomerStatus.ACTIVE,
      });
      await this.customerRepository.save(customer);
    }


    const opportunity = this.opportunityRepository.create({
      organizationId,
      name: `Oportunidad desde Lead: ${lead.topic}`,
      customerId: customer.id,
      ownerId: lead.ownerId,
      amount: 0,
      stage: 'QUALIFICATION',
    });
    

    lead.status = CustomerStatus.INACTIVE;
    await this.leadRepository.save(lead);

    return this.opportunityRepository.save(opportunity);
  }
}
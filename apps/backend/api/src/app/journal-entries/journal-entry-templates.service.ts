
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { JournalEntryTemplate } from './entities/journal-entry-template.entity';
import { CreateJournalEntryTemplateDto, UpdateJournalEntryTemplateDto, CreateJournalEntryFromTemplateDto } from './dto/recurring-and-templates.dto';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntry } from './entities/journal-entry.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';

@Injectable()
export class JournalEntryTemplatesService {
  constructor(
    @InjectRepository(JournalEntryTemplate)
    private readonly templateRepository: Repository<JournalEntryTemplate>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  create(createDto: CreateJournalEntryTemplateDto, organizationId: string): Promise<JournalEntryTemplate> {
    const template = this.templateRepository.create({ ...createDto, organizationId });
    return this.templateRepository.save(template);
  }

  findAll(organizationId: string): Promise<JournalEntryTemplate[]> {
    return this.templateRepository.find({ where: { organizationId } });
  }

  async findOne(id: string, organizationId: string): Promise<JournalEntryTemplate> {
    const template = await this.templateRepository.findOne({ where: { id, organizationId } });
    if (!template) {
      throw new NotFoundException(`Plantilla de asiento con ID "${id}" no encontrada.`);
    }
    return template;
  }

  async update(id: string, updateDto: UpdateJournalEntryTemplateDto, organizationId: string): Promise<JournalEntryTemplate> {
    const template = await this.findOne(id, organizationId);
    const updatedTemplate = this.templateRepository.merge(template, updateDto);
    return this.templateRepository.save(updatedTemplate);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.templateRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundException(`Plantilla de asiento con ID "${id}" no encontrada.`);
    }
  }

  async createEntryFromTemplate(templateId: string, createEntryDto: CreateJournalEntryFromTemplateDto, organizationId: string): Promise<JournalEntry> {
    const template = await this.findOne(templateId, organizationId);
    
    if (createEntryDto.amount <= 0) {
      throw new BadRequestException('El monto debe ser un número positivo.');
    }
    
    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
    }

    const lines = template.lines.map(line => {
      const debit = line.type === 'DEBIT' ? createEntryDto.amount : 0;
      const credit = line.type === 'CREDIT' ? createEntryDto.amount : 0;
      return {
        accountId: line.accountId,
        debit: debit,
        credit: credit,
        description: line.description,
        valuations: [{
          ledgerId: defaultLedger.id,
          debit: debit,
          credit: credit
        }]
      };
    });

    const entryDto: CreateJournalEntryDto = {
      date: createEntryDto.date,
      description: createEntryDto.description,
      journalId: createEntryDto.journalId,
      lines: lines,
    };

    return this.journalEntriesService.create(entryDto, organizationId);
  }
}
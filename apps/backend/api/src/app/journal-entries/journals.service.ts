
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { CreateJournalDto } from './dto/journal.dto';

@Injectable()
export class JournalsService {
  constructor(
    @InjectRepository(Journal)
    private journalRepository: Repository<Journal>,
  ) {}

  create(dto: CreateJournalDto, organizationId: string): Promise<Journal> {
    const journal = this.journalRepository.create({ ...dto, organizationId });
    return this.journalRepository.save(journal);
  }

  findAll(organizationId: string): Promise<Journal[]> {
    return this.journalRepository.find({ where: { organizationId } });
  }
}
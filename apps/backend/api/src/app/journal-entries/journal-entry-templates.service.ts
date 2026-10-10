import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, EntityManager } from 'typeorm';
import { JournalEntryTemplate, JournalEntryTemplateLine } from './entities/journal-entry-template.entity';
import { CreateJournalEntryTemplateDto, UpdateJournalEntryTemplateDto, CreateJournalEntryFromTemplateDto } from './dto/recurring-and-templates.dto';
import { JournalEntriesService } from './journal-entries.service';
import { JournalEntry } from './entities/journal-entry.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import { CreateJournalEntryDto } from './dto/create-journal-entry.dto';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { toCents } from '../common/money';
import { assertJournal, assertStoredLines } from './stored-lines';

/**
 * Journal entry templates: the shape of an entry used again and again — the accounts, which side
 * each is on and what share of the amount it takes — so that booking it is a date and an amount.
 *
 * Every line used to take the WHOLE amount on its side, so only a template with as many debit as
 * credit lines balanced: «rent 1 000 split between two cost centres» posted 1 000 to each and
 * failed. Each side now splits the amount by its lines' percentages (equally when none are
 * given), the last line taking the cent left by rounding, so the entry balances by construction.
 */
@Injectable()
export class JournalEntryTemplatesService {
  constructor(
    @InjectRepository(JournalEntryTemplate)
    private readonly templateRepository: Repository<JournalEntryTemplate>,
    private readonly journalEntriesService: JournalEntriesService,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateJournalEntryTemplateDto, organizationId: string): Promise<JournalEntryTemplate> {
    const lines = await this.validate(this.dataSource.manager, organizationId, dto.lines);
    const template = this.templateRepository.create({
      organizationId,
      name: dto.name.trim(),
      description: dto.description.trim(),
      lines,
    });
    return this.templateRepository.save(template);
  }

  findAll(organizationId: string): Promise<JournalEntryTemplate[]> {
    return this.templateRepository.find({ where: { organizationId }, order: { name: 'ASC' } });
  }

  async findOne(id: string, organizationId: string): Promise<JournalEntryTemplate> {
    const template = await this.templateRepository.findOne({ where: { id, organizationId } });
    if (!template) {
      throw new NotFoundError('journal_entries.journal_entry_template_id_not_found', { id });
    }
    return template;
  }

  async update(id: string, dto: UpdateJournalEntryTemplateDto, organizationId: string): Promise<JournalEntryTemplate> {
    const template = await this.findOne(id, organizationId);
    if (dto.name !== undefined) template.name = dto.name.trim();
    if (dto.description !== undefined) template.description = dto.description.trim();
    if (dto.lines) template.lines = await this.validate(this.dataSource.manager, organizationId, dto.lines);
    return this.templateRepository.save(template);
  }

  async remove(id: string, organizationId: string): Promise<void> {
    const result = await this.templateRepository.delete({ id, organizationId });
    if (result.affected === 0) {
      throw new NotFoundError('journal_entries.journal_entry_template_id_not_found', { id });
    }
  }

  async createEntryFromTemplate(
    templateId: string,
    dto: CreateJournalEntryFromTemplateDto,
    organizationId: string,
    actorUserId: string,
  ): Promise<JournalEntry> {
    const template = await this.findOne(templateId, organizationId);
    if (!(dto.amount > 0)) throw new BadRequestError('journal_entries.amount_must_positive_number');
    await assertJournal(this.dataSource.manager, organizationId, dto.journalId);

    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
      throw new BadRequestError('journal_entries.no_default_ledger_has_configured_organization');
    }

    const amounts = allocate(template.lines, dto.amount);
    const lines = template.lines.map((line, index) => {
      const debit = line.type === 'DEBIT' ? amounts[index] : 0;
      const credit = line.type === 'CREDIT' ? amounts[index] : 0;
      return {
        accountId: line.accountId,
        debit,
        credit,
        description: line.description || undefined,
        ...(line.dimensions ? { dimensions: line.dimensions } : {}),
        valuations: [{ ledgerId: defaultLedger.id, debit, credit }],
      };
    });

    const entryDto: CreateJournalEntryDto = {
      date: dto.date,
      description: dto.description,
      journalId: dto.journalId,
      lines,
    };
    return this.journalEntriesService.create(entryDto, organizationId, { actorUserId });
  }

  /**
   * A template both sides of which can be filled: at least one line on each, percentages on all
   * or none of a side's lines and adding to 100, and accounts and tags this company can post to.
   */
  private async validate(
    manager: EntityManager,
    organizationId: string,
    lines: readonly JournalEntryTemplateLine[],
  ): Promise<JournalEntryTemplateLine[]> {
    for (const side of ['DEBIT', 'CREDIT'] as const) {
      const ofSide = lines.filter((line) => line.type === side);
      if (ofSide.length === 0) throw new BadRequestError('journal_entries.template_needs_both_sides');
      const withShare = ofSide.filter((line) => line.percentage !== undefined && line.percentage !== null);
      if (withShare.length > 0 && withShare.length !== ofSide.length) {
        throw new BadRequestError('journal_entries.template_percentages_all_or_none', { side });
      }
      if (withShare.length > 0) {
        const total = withShare.reduce((sum, line) => sum + Math.round(Number(line.percentage) * 10_000), 0);
        if (total !== 1_000_000) {
          throw new BadRequestError('journal_entries.template_percentages_must_total_100', {
            side,
            total: total / 10_000,
          });
        }
      }
    }
    const checked = await assertStoredLines(
      manager,
      organizationId,
      lines.map((line) => ({
        accountId: line.accountId,
        description: line.description?.trim() || undefined,
        type: line.type,
        ...(line.percentage !== undefined && line.percentage !== null ? { percentage: Number(line.percentage) } : {}),
        dimensions: line.dimensions ?? null,
      })),
    );
    return checked.map(({ dimensions, ...line }) => ({ ...line, ...(dimensions ? { dimensions } : {}) }));
  }
}

/**
 * The amount each line takes: on each side, by its percentage — or equally — in cents, the last
 * line of the side taking whatever rounding left, so each side adds up to the amount exactly.
 */
export function allocate(lines: readonly JournalEntryTemplateLine[], amount: number): number[] {
  const totalCents = toCents(amount);
  const result = new Array<number>(lines.length).fill(0);
  for (const side of ['DEBIT', 'CREDIT'] as const) {
    const indexes = lines.map((line, index) => (line.type === side ? index : -1)).filter((index) => index >= 0);
    let allocated = 0;
    indexes.forEach((index, position) => {
      const isLast = position === indexes.length - 1;
      const share = lines[index].percentage;
      const cents = isLast
        ? totalCents - allocated
        : share !== undefined && share !== null
          ? Math.round((totalCents * Number(share)) / 100)
          : Math.floor(totalCents / indexes.length);
      allocated += cents;
      result[index] = cents / 100;
    });
  }
  return result;
}

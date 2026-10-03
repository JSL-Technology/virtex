import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { CreateJournalDto, UpdateJournalDto } from './dto/journal.dto';
import { BadRequestError, ConflictError, NotFoundError } from '../i18n/localized.exception';
import { assertNotInUse } from '../common/database/dependents';

/**
 * The journals the product's own services look up by code (see `TenantBookkeepingProvisioner`).
 *
 * Renaming or deleting one would not fail where it happened: it would fail later, in an invoice,
 * a payroll or a period close that can no longer find where to post. Their names can change; their
 * codes and their existence cannot.
 */
export const SYSTEM_JOURNAL_CODES: ReadonlySet<string> = new Set([
  'VENTAS', 'COMPRAS', 'COBROS', 'PAGOS', 'BANCOS', 'CAJA', 'NOMINA', 'GENERAL', 'DEPREC', 'CIERRE', 'CONCIL', 'ASC',
]);

/** A journal as the screens read it: whether it is the product's own, and whether it was used. */
export interface JournalView extends Journal {
  isSystem: boolean;
  entryCount: number;
}

@Injectable()
export class JournalsService {
  constructor(
    @InjectRepository(Journal)
    private readonly journalRepository: Repository<Journal>,
    private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateJournalDto, organizationId: string): Promise<Journal> {
    const code = normaliseCode(dto.code);
    await this.assertCodeFree(organizationId, code);
    const journal = this.journalRepository.create({ ...dto, code, name: dto.name.trim(), organizationId });
    return this.journalRepository.save(journal);
  }

  async findAll(organizationId: string): Promise<JournalView[]> {
    const journals = await this.journalRepository.find({ where: { organizationId }, order: { code: 'ASC' } });
    const counts = await this.entryCounts(organizationId);
    return journals.map((journal) => this.view(journal, counts.get(journal.id) ?? 0));
  }

  async findOne(id: string, organizationId: string): Promise<JournalView> {
    const journal = await this.journalRepository.findOne({ where: { id, organizationId } });
    if (!journal) throw new NotFoundError('journal_entries.journal_not_found', { id });
    const counts = await this.entryCounts(organizationId, id);
    return this.view(journal, counts.get(id) ?? 0);
  }

  /**
   * Edit a journal (QA A-13: the edit screen asked `GET /journals/:id` and got 404 — there was no
   * such route, nor any way to change a journal).
   *
   * The name always; the code and the type only while nothing was posted to it: the code prefixes
   * every entry number it issued (`GENERAL-2026-000001`) and the type decides which documents may
   * use it, so changing either afterwards rewrites the meaning of history.
   */
  async update(id: string, dto: UpdateJournalDto, organizationId: string): Promise<JournalView> {
    const journal = await this.findOne(id, organizationId);
    const code = dto.code !== undefined ? normaliseCode(dto.code) : journal.code;

    if (code !== journal.code) {
      if (journal.isSystem) throw new BadRequestError('journal_entries.journal_system_code_fixed', { code: journal.code });
      if (journal.entryCount > 0) throw new BadRequestError('journal_entries.journal_code_fixed_once_used', { count: journal.entryCount });
      await this.assertCodeFree(organizationId, code, id);
    }
    if (dto.type !== undefined && dto.type !== journal.type && journal.entryCount > 0) {
      throw new BadRequestError('journal_entries.journal_type_fixed_once_used', { count: journal.entryCount });
    }

    await this.journalRepository.update(
      { id, organizationId },
      {
        code,
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.type !== undefined ? { type: dto.type } : {}),
      },
    );
    return this.findOne(id, organizationId);
  }

  /** Delete a journal nothing was posted to; a journal the product posts to is never deleted. */
  async remove(id: string, organizationId: string): Promise<void> {
    const journal = await this.findOne(id, organizationId);
    if (journal.isSystem) throw new BadRequestError('journal_entries.system_journal_cannot_be_deleted', { code: journal.code });
    await this.dataSource.transaction(async (manager) => {
      await assertNotInUse(manager, 'journals', id, 'journal_entries.journal_in_use');
      await manager.delete(Journal, { id, organizationId });
    });
  }

  private view(journal: Journal, entryCount: number): JournalView {
    return { ...journal, isSystem: SYSTEM_JOURNAL_CODES.has(journal.code), entryCount };
  }

  private async entryCounts(organizationId: string, journalId?: string): Promise<Map<string, number>> {
    const rows: Array<{ journal_id: string; count: number }> = await this.dataSource.query(
      `SELECT journal_id, COUNT(*)::int AS count
         FROM journal_entries
        WHERE organization_id = $1 ${journalId ? 'AND journal_id = $2' : ''}
        GROUP BY journal_id`,
      journalId ? [organizationId, journalId] : [organizationId],
    );
    return new Map(rows.map((row) => [row.journal_id, Number(row.count)]));
  }

  private async assertCodeFree(organizationId: string, code: string, exceptId?: string): Promise<void> {
    const existing = await this.journalRepository.findOne({ where: { organizationId, code } });
    if (existing && existing.id !== exceptId) throw new ConflictError('journal_entries.journal_code_taken', { code });
  }
}

function normaliseCode(code: string): string {
  return code.trim().toUpperCase();
}

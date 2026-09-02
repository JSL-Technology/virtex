import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Journal } from './entities/journal.entity';

/**
 * Allocates the next consecutive number in a journal's series.
 *
 * The allocation is a single statement so it is atomic under any interleaving, and it runs on the
 * caller's `EntityManager` so it shares the fate of the entry it numbers: commit and the number is
 * spent, roll back and it is returned. That is what makes the series gap-free, which is the whole
 * reason the counter is a table row rather than a Postgres sequence.
 */
@Injectable()
export class JournalEntryNumberingService {
  /**
   * @returns a number like `GEN-2026-000042` — journal code, fiscal year, six-digit ordinal.
   *   The ordinal keeps growing past six digits rather than wrapping, so a busy journal produces a
   *   longer number rather than a duplicate one.
   */
  async allocate(
    manager: EntityManager,
    organizationId: string,
    journal: Journal,
    entryDate: Date,
  ): Promise<string> {
    const year = entryDate.getUTCFullYear();

    const [row] = await manager.query<{ last_number: number }[]>(
      `INSERT INTO "journal_entry_sequences"
         ("organization_id", "journal_id", "year", "last_number")
       VALUES ($1, $2, $3, 1)
       ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
         SET "last_number" = "journal_entry_sequences"."last_number" + 1
       RETURNING "last_number"`,
      [organizationId, journal.id, year],
    );

    const ordinal = String(row.last_number).padStart(6, '0');
    return `${journal.code}-${year}-${ordinal}`;
  }
}

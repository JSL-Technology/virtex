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
    return this.allocateForScope(
      manager,
      organizationId,
      journal.id,
      journal.code,
      entryDate.getUTCFullYear(),
    );
  }

  /**
   * The same guarantee for any other document that needs a consecutive series.
   *
   * `journal_entry_sequences` is keyed by an opaque scope id rather than a foreign key to
   * `journals`, so a customer receipt — which a customer keeps and quotes back, and which was
   * previously identified only by eight characters of a UUID — can share the mechanism instead of
   * reimplementing the same `INSERT … ON CONFLICT … RETURNING` beside it.
   *
   * @param scopeId what the series belongs to: a journal, or one of the reserved ids below.
   * @param prefix the human-facing prefix, e.g. `GENERAL` or `REC`.
   */
  async allocateForScope(
    manager: EntityManager,
    organizationId: string,
    scopeId: string,
    prefix: string,
    year: number,
  ): Promise<string> {
    const [row] = await manager.query<{ last_number: number }[]>(
      `INSERT INTO "journal_entry_sequences"
         ("organization_id", "journal_id", "year", "last_number")
       VALUES ($1, $2, $3, 1)
       ON CONFLICT ("organization_id", "journal_id", "year") DO UPDATE
         SET "last_number" = "journal_entry_sequences"."last_number" + 1
       RETURNING "last_number"`,
      [organizationId, scopeId, year],
    );

    return `${prefix}-${year}-${String(row.last_number).padStart(6, '0')}`;
  }
}

/**
 * Reserved scope ids for series that do not belong to a journal.
 *
 * Fixed UUIDs rather than magic strings so they cannot collide with a real journal id, and so the
 * column keeps its uuid type.
 */
export const SEQUENCE_SCOPE = {
  /** Customer receipts: `REC-2026-000042`. */
  CUSTOMER_RECEIPT: '00000000-0000-4000-8000-000000000001',
} as const;

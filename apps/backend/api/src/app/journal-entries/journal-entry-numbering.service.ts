import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Journal } from './entities/journal.entity';
import { toIsoDate } from '../common/dates';

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
      await this.seriesYear(manager, organizationId, entryDate),
    );
  }

  /**
   * The year the series is keyed by: the tenant's **fiscal** year, not the calendar year.
   *
   * `entryDate.getUTCFullYear()` was the whole rule. For a tenant whose year runs July to June —
   * ordinary in the United States and permitted across the region — the series restarted in the
   * middle of the year, so the journal of one fiscal year contained two partial series and neither
   * of them covered it. A consecutive series exists to let an inspector walk a book end to end
   * without gaps; one that resets halfway cannot be walked.
   *
   * Named by the year the fiscal year **ends** in, which is how a non-calendar year is normally
   * referred to and which leaves a calendar-year tenant — the overwhelming majority — with exactly
   * the numbers it had before. A tenant that has defined no fiscal years falls back to the
   * calendar year rather than refusing to post: numbering is not the place to discover that
   * setup is incomplete.
   *
   * *Verify with accounting/legal*: confirm that no target regime requires the series to be keyed
   * to the calendar year regardless of the taxpayer's own fiscal year.
   */
  private async seriesYear(
    manager: EntityManager,
    organizationId: string,
    entryDate: Date,
  ): Promise<number> {
    const isoDate = toIsoDate(entryDate);
    const [row] = await manager.query<{ end_date: string | Date }[]>(
      `SELECT "end_date" FROM "fiscal_years"
        WHERE "organization_id" = $1 AND "start_date" <= $2 AND "end_date" >= $2
        ORDER BY "start_date" DESC
        LIMIT 1`,
      [organizationId, isoDate],
    );

    // A `date` column reaches the entity layer as a string and a raw query as a `Date`, because
    // the two go through different type mappings. `toIsoDate` takes either and validates what it
    // is given — which is the whole reason it exists, and the reason the audit adjustment used to
    // throw on the same shape of value.
    return row ? Number(toIsoDate(row.end_date).slice(0, 4)) : entryDate.getUTCFullYear();
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

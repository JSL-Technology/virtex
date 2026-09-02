import { Entity, Column, PrimaryColumn } from 'typeorm';

/**
 * The consecutive counter behind every journal entry's number.
 *
 * ## Why a table and not a Postgres sequence
 *
 * A `SEQUENCE` is explicitly non-transactional: a rolled-back transaction keeps the number it
 * consumed, so the book gets holes. The libro diario in the Dominican Republic, Mexico's
 * `NumUnIdenPol`, and the equivalent requirement in Colombia, Peru and Ecuador all ask for a
 * consecutive series *without* gaps, and an auditor reads a hole as a deleted entry.
 *
 * One row per (tenant, journal, year), incremented with `UPDATE … RETURNING` inside the same
 * transaction that writes the entry. The row lock that implies is the point: two concurrent
 * postings to the same journal are serialised for the microseconds it takes to allocate, and a
 * posting that rolls back returns its number to the series rather than burning it.
 *
 * The year is part of the key because every one of these regimes restarts the series each fiscal
 * year, and because it keeps the contended row small and short-lived.
 */
@Entity({ name: 'journal_entry_sequences' })
export class JournalEntrySequence {
  @PrimaryColumn({ name: 'organization_id', type: 'uuid' })
  organizationId: string;

  @PrimaryColumn({ name: 'journal_id', type: 'uuid' })
  journalId: string;

  @PrimaryColumn({ name: 'year', type: 'int' })
  year: number;

  /** The highest number handed out so far. The next entry gets `lastNumber + 1`. */
  @Column({ name: 'last_number', type: 'int', default: 0 })
  lastNumber: number;
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The DEBIT_NOTE document series type (audit 2026-11-07, FAC-INV-05). On its own: PostgreSQL does
 * not let a value be used in the transaction that added it, and migrations run one transaction
 * each — `SalesDebitNotesAndCancellation1789600000001` uses it.
 */
export class DebitNoteSequenceType1789600000000 implements MigrationInterface {
  name = 'DebitNoteSequenceType1789600000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TYPE "public"."document_sequences_type_enum" ADD VALUE IF NOT EXISTS 'DEBIT_NOTE'`);
  }

  public async down(): Promise<void> {
    // An enum value cannot be dropped in PostgreSQL; unused, it is harmless.
  }
}

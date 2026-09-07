import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The audit trail learns to record reading, not only writing.
 *
 * `ActionType` had eight values, all of them changes: create, update, delete and the session
 * events. There was no way to express that somebody *looked* at something, so an accounting
 * product shipped with no audit of access to financial data — who opened the payroll journal, who
 * pulled the customer list, who exported the general ledger of a subsidiary they do not work on.
 * For a tenant subject to an external audit, or to SOX, that is not a gap in a feature; it is a
 * control that does not exist.
 *
 * `EXPORT` is separate from `READ` deliberately. Reading a report is looking at it inside the
 * product, where every access control still applies; exporting it produces a copy that outlives
 * all of them.
 *
 * PostgreSQL 12 and later allow `ALTER TYPE … ADD VALUE` inside a transaction as long as the new
 * value is not used in the same transaction, which is why this migration only adds them.
 */
export class AuditAccessActions1789000600000 implements MigrationInterface {
  name = 'AuditAccessActions1789000600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_actiontype_enum" ADD VALUE IF NOT EXISTS 'READ'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."audit_logs_actiontype_enum" ADD VALUE IF NOT EXISTS 'EXPORT'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot remove a value from an enum type, and rebuilding the type would mean
    // rewriting every audit row — deleting evidence to undo a schema change. The values stay.
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * New enum values the payroll hardening needs, isolated in their own migration.
 *
 * PostgreSQL refuses to use an enum value inside the transaction that added it, and this project runs
 * one transaction per migration (`migrationsTransactionMode: 'each'`). So the value is added here and
 * consumed by {@link PayrollModuleHardening1789003200000} in the next transaction — the same split
 * the invoicing enum migrations already use.
 *
 * - `HOURLY` on the concept calculation enum: overtime and night-premium concepts.
 * - `BONUS_EMPLOYEE_LEVY_RATE` on the statutory-reference key enum: the 0.5 % employee INFOTEP levy
 *   on the regalía, versioned rather than hardcoded.
 */
export class PayrollEnumValues1789003100000 implements MigrationInterface {
  name = 'PayrollEnumValues1789003100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TYPE "public"."payroll_concepts_calculation_enum" ADD VALUE IF NOT EXISTS 'HOURLY'`,
    );
    await q.query(
      `ALTER TYPE "public"."payroll_statutory_references_key_enum" ADD VALUE IF NOT EXISTS 'BONUS_EMPLOYEE_LEVY_RATE'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL cannot drop a value from an enum type; the values are harmless if unused, so the
    // down migration is intentionally a no-op rather than a destructive type rebuild.
  }
}

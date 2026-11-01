import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What a bank is beyond its name and BIC: its registered name, its taxpayer number and its kind.
 *
 * The catalogue held the name people use («Banco Popular») and nothing that identifies the legal
 * entity behind it, which is what a withholding certificate, a tax form or a bank-confirmation
 * letter for the auditors names. These come from the regulator's list when the bank is imported
 * from it, and can be typed in for any other.
 */
export class BankReferenceData1789260000000 implements MigrationInterface {
  name = 'BankReferenceData1789260000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "legal_name" varchar(200)`);
    await q.query(`ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "tax_id" varchar(20)`);
    await q.query(`ALTER TABLE "banks" ADD COLUMN IF NOT EXISTS "kind" varchar(32)`);
    await q.query(`
      DO $$ BEGIN
        ALTER TABLE "banks" ADD CONSTRAINT "CHK_banks_kind"
          CHECK ("kind" IS NULL OR "kind" IN ('multiple_bank','savings_credit_bank','savings_loan_association','credit_corporation','other'));
      EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "banks" DROP CONSTRAINT IF EXISTS "CHK_banks_kind"`);
    await q.query(`ALTER TABLE "banks" DROP COLUMN IF EXISTS "kind"`);
    await q.query(`ALTER TABLE "banks" DROP COLUMN IF EXISTS "tax_id"`);
    await q.query(`ALTER TABLE "banks" DROP COLUMN IF EXISTS "legal_name"`);
  }
}

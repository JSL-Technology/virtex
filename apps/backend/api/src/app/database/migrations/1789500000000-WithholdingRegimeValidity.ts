import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A tenant's own withholding regimes get a period (audit 2026-11-07, CMP-05; SP-03), like the
 * built-in ones in `withholding-regimes.ts`. Existing rows stay open (null bounds), which is what
 * they meant until now; a decree that changes a rate is recorded by ending the row and adding one.
 */
export class WithholdingRegimeValidity1789500000000 implements MigrationInterface {
  name = 'WithholdingRegimeValidity1789500000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "tenant_withholding_regimes"
        ADD COLUMN "effective_from" date,
        ADD COLUMN "effective_to" date,
        ADD CONSTRAINT "CHK_tenant_withholding_regimes_period"
          CHECK ("effective_to" IS NULL OR "effective_from" IS NULL OR "effective_to" >= "effective_from")`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "tenant_withholding_regimes"
        DROP CONSTRAINT "CHK_tenant_withholding_regimes_period",
        DROP COLUMN "effective_from",
        DROP COLUMN "effective_to"`);
  }
}

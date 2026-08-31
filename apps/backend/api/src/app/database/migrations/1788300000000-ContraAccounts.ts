import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Let an account carry a balance opposite to its type, and say that it does.
 *
 * `ChartOfAccountsService.create` enforced `nature === normalNatureFor(type)` unconditionally.
 * That rule forbids contra accounts — accumulated depreciation (an asset with a credit balance),
 * an allowance for doubtful accounts (likewise), and sales returns (revenue with a debit balance).
 * All three are in the IFRS opening chart every tenant is provisioned with, so provisioning threw
 * on the second account it reached, in every market.
 *
 * The defect survived because the only script that claimed to verify provisioning replaced the
 * real chart-of-accounts service with a stub that wrote rows directly, skipping the validation
 * entirely. It now boots the real application, which is how this surfaced.
 *
 * The flag is stored rather than inferred from the mismatch because financial statements need it:
 * a contra account nets against its siblings rather than adding to them, and "the nature does not
 * match the type" is not something a report should have to interpret.
 */
export class ContraAccounts1788300000000 implements MigrationInterface {
  name = 'ContraAccounts1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "accounts"
        ADD COLUMN IF NOT EXISTS "is_contra_account" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      COMMENT ON COLUMN "accounts"."is_contra_account" IS
        'Cuenta de naturaleza contraria a su tipo (depreciación acumulada, provisiones, devoluciones).'
    `);

    // Backfill: any account that already carries the opposite balance IS a contra account, and
    // was only storable because it predates the validation. Marking it keeps the invariant true
    // for existing tenants instead of leaving rows the new rule would reject.
    await queryRunner.query(`
      UPDATE "accounts"
         SET "is_contra_account" = true
       WHERE ("type" IN ('ASSET', 'EXPENSE') AND "nature" = 'CREDIT')
          OR ("type" IN ('LIABILITY', 'EQUITY', 'REVENUE') AND "nature" = 'DEBIT')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "is_contra_account"`);
  }
}

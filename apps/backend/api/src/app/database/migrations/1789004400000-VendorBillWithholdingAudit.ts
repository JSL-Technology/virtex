import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A vendor bill records which withholding rule produced its figures.
 *
 * The sales side has carried `withholding_regime_codes` and `withholding_override_reason` since
 * withholding stopped being a number the client could state freely. The purchase side kept only
 * the resulting amounts, because it resolved nothing: `tax_withheld` and `income_tax_withheld` were
 * written verbatim from the request. A 606 that reported a withholding therefore could not say on
 * what authority it had been taken.
 *
 * Existing bills get an empty code array and a null reason, which is the honest reading of them:
 * nothing recorded a rule, so no rule is claimed.
 */
export class VendorBillWithholdingAudit1789004400000 implements MigrationInterface {
  name = 'VendorBillWithholdingAudit1789004400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ADD "withholding_regime_codes" text array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" ADD "withholding_override_reason" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" DROP COLUMN "withholding_override_reason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "vendor_bills" DROP COLUMN "withholding_regime_codes"`,
    );
  }
}

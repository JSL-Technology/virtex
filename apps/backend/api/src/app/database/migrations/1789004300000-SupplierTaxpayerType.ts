import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Suppliers gain the fiscal classification customers already had.
 *
 * In the Dominican Republic what is withheld on a purchase follows from who the supplier is: buy a
 * service from a persona física and the buyer withholds 100 % of the ITBIS and 10 % of the fee;
 * buy the same service from a company and nothing is withheld. The supplier record carried no such
 * field, so the withholding on a vendor bill arrived as a free number on the request with nothing
 * on the server able to check it — the exact defect that was fixed on the sales side by recording
 * `taxpayer_type` on the customer.
 *
 * Nullable and left null: the classification is assigned by the tax authority and confirmed by the
 * tenant. Guessing it from the shape of an RNC or the words in a company name is how a product
 * invents a filing.
 */
export class SupplierTaxpayerType1789004300000 implements MigrationInterface {
  name = 'SupplierTaxpayerType1789004300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "suppliers" ADD "taxpayer_type" character varying(24)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "suppliers" DROP COLUMN "taxpayer_type"`);
  }
}

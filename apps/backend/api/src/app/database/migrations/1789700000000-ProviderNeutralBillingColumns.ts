import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The organization's billing relationship stops naming one payment provider, and becomes findable.
 *
 * 1. `stripe_customer_id` and `stripe_subscription_id` hold whatever the configured gateway issues —
 *    Stripe's ids, the simulated provider's, the next adapter's. The entity already called them
 *    `externalCustomerId` and `externalSubscriptionId`; the columns now say the same thing, so the
 *    name a reader sees in SQL is the name they see in code.
 *
 * 2. Every webhook finds the organizations a subscription bills by that column, and nothing indexed
 *    it: each event scanned the whole tenant directory. Partial, because a tenant with no payment
 *    relationship has nothing to look up.
 *
 * 3. `saas_plans.stripe_product_id` goes. Nothing ever wrote it or read it — a plan is bought by its
 *    PRICE, which is what the catalogue verifies at boot and what a subscription is matched by — and
 *    it was empty in every database. A column nobody maintains is one somebody will trust.
 *
 * The renames keep every value; no row is rewritten.
 */
export class ProviderNeutralBillingColumns1789700000000 implements MigrationInterface {
  name = 'ProviderNeutralBillingColumns1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "stripe_customer_id" TO "external_customer_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "stripe_subscription_id" TO "external_subscription_id"`);
    await queryRunner.query(
      `CREATE INDEX "IDX_organizations_external_subscription_id" ON "organizations" ("external_subscription_id") WHERE "external_subscription_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_organizations_external_customer_id" ON "organizations" ("external_customer_id") WHERE "external_customer_id" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "saas_plans" DROP COLUMN "stripe_product_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "saas_plans" ADD "stripe_product_id" character varying`);
    await queryRunner.query(`DROP INDEX "IDX_organizations_external_customer_id"`);
    await queryRunner.query(`DROP INDEX "IDX_organizations_external_subscription_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "external_subscription_id" TO "stripe_subscription_id"`);
    await queryRunner.query(`ALTER TABLE "organizations" RENAME COLUMN "external_customer_id" TO "stripe_customer_id"`);
  }
}

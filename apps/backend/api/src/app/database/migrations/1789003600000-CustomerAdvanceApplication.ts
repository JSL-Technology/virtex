import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a customer advance be spent.
 *
 * Receipts could already hold money a customer paid ahead (`unapplied_amount`), but nothing could
 * ever consume it: the liability stayed on the balance sheet for ever and the customer had to be
 * asked to pay a second time for an invoice their own money was already sitting against.
 *
 * Two columns, because an advance is retired at what the customer actually paid. `advance_applied_amount`
 * is the draw in the receipt's currency; `advance_applied_base_amount` is what that draw was worth in
 * the books' currency, taken at the weighted average of the receipts still holding money. Keeping
 * both is what makes that average computable without lot tracking, and what lets the gap against the
 * day's rate be recognised as a realised exchange difference rather than quietly misstating the
 * liability.
 */
export class CustomerAdvanceApplication1789003600000 implements MigrationInterface {
  name = 'CustomerAdvanceApplication1789003600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        ADD COLUMN IF NOT EXISTS "advance_applied_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "advance_applied_base_amount" numeric(18,2) NOT NULL DEFAULT 0
    `);

    // A draw can never exceed what was held, and neither figure can be negative: the invariant the
    // service enforces is worth stating where the data lives too, so no future writer can break it.
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        DROP CONSTRAINT IF EXISTS "CHK_customer_payment_advance_non_negative"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        ADD CONSTRAINT "CHK_customer_payment_advance_non_negative"
        CHECK ("advance_applied_amount" >= 0 AND "advance_applied_base_amount" >= 0)
    `);

    // The receipt screen asks one question constantly — "what does this customer have on account?" —
    // and answers it by summing every posted receipt for that customer and currency.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_customer_payment_advance_lookup"
        ON "customer_payments" ("organization_id", "customer_id", "currency_code", "status")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customer_payment_advance_lookup"`);
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        DROP CONSTRAINT IF EXISTS "CHK_customer_payment_advance_non_negative"
    `);
    await queryRunner.query(`
      ALTER TABLE "customer_payments"
        DROP COLUMN IF EXISTS "advance_applied_base_amount",
        DROP COLUMN IF EXISTS "advance_applied_amount"
    `);
  }
}

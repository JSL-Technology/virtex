import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment terms become a number of days, so a due date can be computed from them.
 *
 * `customers.payment_terms` has existed for as long as the customer record has, as free text, and
 * nothing ever read it — a string cannot be added to a date. Every invoice therefore opened with
 * its due date equal to its issue date, which asserts "due on receipt" about a customer the tenant
 * may have given thirty days, and the ageing report called it overdue the next morning.
 *
 * ## What happens to the text already there
 *
 * A value that is plainly a number of days is read as one: `30`, `Neto 30`, `30 días` all yield
 * 30. Anything else is left null and the organization's default applies, because guessing at
 * `2/10 neto 30` — which is a discount term this product does not model — would put a date on a
 * document that nobody agreed to. The text stays: it is what gets printed on the invoice.
 */
export class PaymentTermDays1789004500000 implements MigrationInterface {
  name = 'PaymentTermDays1789004500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" ADD "payment_term_days" integer`);
    await queryRunner.query(
      `ALTER TABLE "organization_settings" ADD "default_payment_term_days" integer NOT NULL DEFAULT 0`,
    );

    // The first run of digits in the string, when the whole string is a plausible term: a bare
    // number, or a number with a word around it. `substring` returns null when nothing matches.
    await queryRunner.query(`
      UPDATE "customers"
      SET "payment_term_days" = CAST(substring("paymentTerms" FROM '([0-9]{1,4})') AS integer)
      WHERE "paymentTerms" IS NOT NULL
        AND "paymentTerms" ~ '^[^0-9]*[0-9]{1,4}[^0-9]*$'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "organization_settings" DROP COLUMN "default_payment_term_days"`,
    );
    await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN "payment_term_days"`);
  }
}

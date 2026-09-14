import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A customer may be recorded without an email address.
 *
 * The product held two rules for the same idea. Creating a SUPPLIER needed a name; email and
 * phone were optional. Creating a CUSTOMER refused without both — `@IsNotEmpty()` on each, and
 * `email` NOT NULL in the table. Two screens for two sides of the same ledger, disagreeing about
 * what a business contact is.
 *
 * The customer's rule is the wrong one. A colmado buying on account has a phone and no email; a
 * new account is often opened from a signed order that carries neither. Odoo, NetSuite and
 * SAP Business One all treat a customer's email as optional, and so does this product's own
 * supplier form. Requiring it does not produce email addresses — it produces
 * `ventas@example.com` typed to get past the field, which is worse than an empty column because
 * an invoice then gets sent to it.
 *
 * `phone` needed no schema change: the column was already nullable and only the DTO insisted.
 *
 * The unique index becomes PARTIAL for the same reason the tax-id index next to it already is
 * (see `TenantScopedCustomerUniqueness`): without `WHERE "email" IS NOT NULL`, the second
 * customer recorded without an email would collide with the first. Postgres does not treat NULLs
 * as equal in a unique index, so the partial clause is belt-and-braces about intent rather than
 * strictly required — it also documents, in the schema, that absence is expected here.
 */
export class CustomerContactOptional1789004900000 implements MigrationInterface {
  name = 'CustomerContactOptional1789004900000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "email" DROP NOT NULL`);

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_customers_org_email"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_org_email"
        ON "customers" ("organization_id", "email")
        WHERE "email" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    /**
     * Going back needs somewhere to put the customers recorded without an email.
     *
     * Refusing is the honest answer: inventing an address to satisfy NOT NULL would put a made-up
     * email on a real customer's record, and the next invoice run would send to it.
     */
    const withoutEmail: { count: string }[] = await queryRunner.query(
      `SELECT COUNT(*)::text AS count FROM "customers" WHERE "email" IS NULL`,
    );
    if (Number(withoutEmail[0]?.count ?? 0) > 0) {
      throw new Error(
        `Cannot revert: ${withoutEmail[0].count} customer(s) have no email address. ` +
          'Give them one, or delete them, before making the column required again.',
      );
    }

    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_customers_org_email"`);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_org_email"
        ON "customers" ("organization_id", "email")
    `);
    await queryRunner.query(`ALTER TABLE "customers" ALTER COLUMN "email" SET NOT NULL`);
  }
}

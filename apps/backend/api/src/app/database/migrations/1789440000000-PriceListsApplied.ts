import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Price lists that actually price something (audit 2026-11-07, FAC-PL-01).
 *
 * Lists could be created with prices and a validity window, but no customer could be given one
 * and no sales document read them. This adds what the pricing needs:
 *
 *  - `customers.price_list_id`: the list a customer buys at (same-tenant guard installed);
 *  - `price_lists.is_default`: the list for everyone else, at most one per currency;
 *  - `price_list_items.min_quantity`: quantity breaks, one price per (product, minimum quantity);
 *  - on invoice and quote lines, which list priced the line and at what price, so a price typed
 *    over the list is visible as such (`list_price` ≠ unit price) instead of indistinguishable.
 *  - `price_list_items.price` widens to six decimals, like every unit price on a document.
 */
export class PriceListsApplied1789440000000 implements MigrationInterface {
  name = 'PriceListsApplied1789440000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "price_lists" ADD COLUMN "is_default" boolean NOT NULL DEFAULT false`);
    await q.query(`CREATE UNIQUE INDEX "UQ_price_lists_default_currency" ON "price_lists" ("organization_id", "currency") WHERE "is_default"`);
    await q.query(`CREATE INDEX "IDX_price_lists_org_status" ON "price_lists" ("organization_id", "status")`);

    await q.query(`ALTER TABLE "price_list_items" ADD COLUMN "min_quantity" numeric(14,4) NOT NULL DEFAULT 1`);
    await q.query(`ALTER TABLE "price_list_items" ADD CONSTRAINT "CHK_price_list_items_min_quantity" CHECK ("min_quantity" > 0)`);
    await q.query(`ALTER TABLE "price_list_items" ADD CONSTRAINT "CHK_price_list_items_price" CHECK ("price" >= 0)`);
    await q.query(`ALTER TABLE "price_list_items" ALTER COLUMN "price" TYPE numeric(18,6)`);
    // A list saved twice with the same product used to be possible through the API's update path.
    await q.query(`
      DELETE FROM "price_list_items" a
       USING "price_list_items" b
       WHERE a."price_list_id" = b."price_list_id" AND a."product_id" = b."product_id"
         AND a."min_quantity" = b."min_quantity" AND a."id" > b."id"
    `);
    await q.query(`CREATE UNIQUE INDEX "UQ_price_list_items_product_break" ON "price_list_items" ("price_list_id", "product_id", "min_quantity")`);

    await q.query(`ALTER TABLE "customers" ADD COLUMN "price_list_id" uuid`);
    await q.query(`
      ALTER TABLE "customers" ADD CONSTRAINT "FK_customers_price_list"
        FOREIGN KEY ("price_list_id") REFERENCES "price_lists" ("id") ON DELETE SET NULL
    `);
    await q.query(`CREATE INDEX "IDX_customers_price_list" ON "customers" ("price_list_id") WHERE "price_list_id" IS NOT NULL`);

    // No foreign key on the document lines: a fiscal document outlives the master data it names,
    // as it does for the product (the line keeps its own description and price).
    for (const table of ['invoice_line_item', 'quote_lines']) {
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "price_list_id" uuid`);
      await q.query(`ALTER TABLE "${table}" ADD COLUMN "list_price" numeric(18,6)`);
    }

    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['invoice_line_item', 'quote_lines']) {
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "list_price"`);
      await q.query(`ALTER TABLE "${table}" DROP COLUMN "price_list_id"`);
    }
    await q.query(`ALTER TABLE "customers" DROP CONSTRAINT "FK_customers_price_list"`);
    await q.query(`ALTER TABLE "customers" DROP COLUMN "price_list_id"`);
    await q.query(`DROP INDEX "UQ_price_list_items_product_break"`);
    await q.query(`ALTER TABLE "price_list_items" ALTER COLUMN "price" TYPE numeric(12,2)`);
    await q.query(`ALTER TABLE "price_list_items" DROP CONSTRAINT "CHK_price_list_items_price"`);
    await q.query(`ALTER TABLE "price_list_items" DROP CONSTRAINT "CHK_price_list_items_min_quantity"`);
    await q.query(`ALTER TABLE "price_list_items" DROP COLUMN "min_quantity"`);
    await q.query(`DROP INDEX "IDX_price_lists_org_status"`);
    await q.query(`DROP INDEX "UQ_price_lists_default_currency"`);
    await q.query(`ALTER TABLE "price_lists" DROP COLUMN "is_default"`);
  }
}

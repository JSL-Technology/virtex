import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A fixed-amount tax is charged as an amount, per unit (audit 2026-11-07, FAC-TX-01; pattern SP-04).
 *
 * `taxes.type = 'Fijo'` existed and was read as a percentage: «Fijo 50» admitted a 50 % ITBIS on any
 * line. The first fix stopped that; this one gives the type its meaning. A product names the fixed
 * tax it carries — a specific excise per bottle, per litre, per pack — and the invoice charges
 * quantity × amount as excise, inside the consumption-tax base, as an ad-valorem excise already is.
 *
 *  - `products.excise_tax_id`: the fixed tax of the tenant's catalogue the item carries. RESTRICT,
 *    so a tax in use cannot be deleted from under the products that charge it.
 *  - `invoice_line_item.excise_unit_amount`: the amount per unit the line charged, in the
 *    document's currency. A document records what was charged, not the catalogue as it is today.
 */
export class FixedPerUnitTax1789570000000 implements MigrationInterface {
  name = 'FixedPerUnitTax1789570000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "products"
        ADD COLUMN "excise_tax_id" uuid,
        ADD CONSTRAINT "FK_products_excise_tax" FOREIGN KEY ("excise_tax_id") REFERENCES "taxes"("id") ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX "IDX_products_excise_tax" ON "products" ("excise_tax_id") WHERE "excise_tax_id" IS NOT NULL`);
    await q.query(`
      ALTER TABLE "invoice_line_item"
        ADD COLUMN "excise_unit_amount" numeric(18,6) NOT NULL DEFAULT 0,
        ADD CONSTRAINT "CHK_invoice_line_item_excise_unit_amount" CHECK ("excise_unit_amount" >= 0)`);
    // The new foreign key gets the same-tenant guard every tenant reference carries.
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "invoice_line_item" DROP CONSTRAINT "CHK_invoice_line_item_excise_unit_amount", DROP COLUMN "excise_unit_amount"`);
    await q.query(`DROP INDEX "IDX_products_excise_tax"`);
    await q.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_products_excise_tax", DROP COLUMN "excise_tax_id"`);
  }
}

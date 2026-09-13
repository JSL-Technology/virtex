import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tenant's product categories become a table.
 *
 * `products.category` was free text fed by a `<select>` with three options written into an Angular
 * template — `Electrónica`, `Accesorios`, `Monitores` — so every tenant of the product, in every
 * market, filed what they sell under a demo catalogue from a computer shop. Renaming a category
 * was impossible, two spellings were two categories, and nothing could aggregate on it.
 *
 * ## What happens to the data already there
 *
 * Nothing is discarded. Every distinct non-empty `category` string is promoted to a real category
 * of the organization that used it, and each product is pointed at the row made from its own
 * string. The text column is dropped only after the values have been copied, so the down migration
 * can put them back exactly.
 */
export class ProductCategories1789004200000 implements MigrationInterface {
  name = 'ProductCategories1789004200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "product_categories" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid,
        "name" character varying(100) NOT NULL,
        "code" character varying(32),
        "description" text,
        "parent_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "sort_order" integer NOT NULL DEFAULT 0,
        CONSTRAINT "PK_product_categories" PRIMARY KEY ("id")
      )
    `);

    // Unique per tenant, not globally: two tenants may both have a "Servicios", and neither should
    // learn of the other's existence by being refused the name.
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_product_categories_org_name"
        ON "product_categories" ("organization_id", "name")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_product_categories_org_parent"
        ON "product_categories" ("organization_id", "parent_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "product_categories"
        ADD CONSTRAINT "FK_product_categories_parent"
        FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);

    // ── Promote the strings already stored ────────────────────────────────────
    await queryRunner.query(`
      INSERT INTO "product_categories" ("organization_id", "name")
      SELECT DISTINCT p."organization_id", btrim(p."category")
      FROM "products" p
      WHERE p."category" IS NOT NULL
        AND btrim(p."category") <> ''
        AND p."organization_id" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "products" ADD "category_id" uuid
    `);
    await queryRunner.query(`
      UPDATE "products" p
      SET "category_id" = c."id"
      FROM "product_categories" c
      WHERE c."organization_id" = p."organization_id"
        AND c."name" = btrim(p."category")
    `);
    await queryRunner.query(`
      ALTER TABLE "products"
        ADD CONSTRAINT "FK_products_category"
        FOREIGN KEY ("category_id") REFERENCES "product_categories"("id")
        ON DELETE RESTRICT ON UPDATE NO ACTION
    `);
    await queryRunner.query(`CREATE INDEX "IDX_products_category_id" ON "products" ("category_id")`);

    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "category"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "products" ADD "category" character varying(100)`);
    await queryRunner.query(`
      UPDATE "products" p
      SET "category" = c."name"
      FROM "product_categories" c
      WHERE c."id" = p."category_id"
    `);
    await queryRunner.query(`DROP INDEX "IDX_products_category_id"`);
    await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "FK_products_category"`);
    await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "category_id"`);

    await queryRunner.query(
      `ALTER TABLE "product_categories" DROP CONSTRAINT "FK_product_categories_parent"`,
    );
    await queryRunner.query(`DROP INDEX "IDX_product_categories_org_parent"`);
    await queryRunner.query(`DROP INDEX "IDX_product_categories_org_name"`);
    await queryRunner.query(`DROP TABLE "product_categories"`);
  }
}

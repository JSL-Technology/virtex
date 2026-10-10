import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One analytic model (audit H-21): dimensions and their values.
 *
 * The product had three. Journal lines, the account rules, the budget control and the analytical
 * view all tag a line by dimension NAME (`{"Centro de Costo": "VENTAS"}`); beside them a
 * `cost_centers` register (code, name, cost or profit centre) that nothing posted against or read,
 * and two tables from the baseline schema, `cost_center` and `project`, with an entity each and no
 * owner. A cost centre IS a value of a dimension — Odoo's analytic accounts under a plan, NetSuite's
 * department segment — so the register becomes the values of the «Centro de Costo» and «Centro de
 * Beneficio» dimensions, and the orphans go.
 *
 * Values gain the label the register had (`name`) and an active flag, so a value lines already
 * carry is retired instead of deleted; dimensions gain a description and the same flag.
 */
export class AnalyticDimensions1789009700000 implements MigrationInterface {
  name = 'AnalyticDimensions1789009700000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "dimensions" ADD "description" text`);
    await q.query(`ALTER TABLE "dimensions" ADD "is_active" boolean NOT NULL DEFAULT true`);
    await q.query(`ALTER TABLE "dimension_values" ADD "name" varchar(200)`);
    await q.query(`ALTER TABLE "dimension_values" ADD "is_active" boolean NOT NULL DEFAULT true`);

    // The register's rows, as values of the dimension their type names. The code is the value —
    // what a line carries — and the name its label.
    for (const [type, dimension] of [
      ['COST_CENTER', 'Centro de Costo'],
      ['PROFIT_CENTER', 'Centro de Beneficio'],
    ]) {
      await q.query(
        `INSERT INTO "dimensions" ("organization_id", "name")
         SELECT DISTINCT "organization_id", $1 FROM "cost_centers" WHERE "type" = $2
         ON CONFLICT ("organization_id", "name") DO NOTHING`,
        [dimension, type],
      );
      await q.query(
        `INSERT INTO "dimension_values" ("dimension_id", "value", "name")
         SELECT d."id", c."code", c."name"
           FROM "cost_centers" c
           JOIN "dimensions" d ON d."organization_id" = c."organization_id" AND d."name" = $1
          WHERE c."type" = $2
         ON CONFLICT ("dimension_id", "value") DO NOTHING`,
        [dimension, type],
      );
    }
    // Every value is its own ancestor in the closure table the tree is read through.
    await q.query(`
      INSERT INTO "dimension_values_closure" ("id_ancestor", "id_descendant")
      SELECT v."id", v."id" FROM "dimension_values" v
       WHERE NOT EXISTS (
         SELECT 1 FROM "dimension_values_closure" c WHERE c."id_ancestor" = v."id" AND c."id_descendant" = v."id"
       )
    `);

    await q.query(`DROP TABLE "cost_centers"`);
    await q.query(`DROP TYPE IF EXISTS "public"."cost_centers_type_enum"`);
    await q.query(`DROP TABLE IF EXISTS "cost_center"`);
    await q.query(`DROP TABLE IF EXISTS "project"`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE "project" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, CONSTRAINT "PK_4d68b1358bb5b766d3e78f32f57" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TABLE "cost_center" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying NOT NULL, CONSTRAINT "PK_814d737123e3a42d0a37e97b393" PRIMARY KEY ("id"))`);
    await q.query(`CREATE TYPE "public"."cost_centers_type_enum" AS ENUM('COST_CENTER', 'PROFIT_CENTER')`);
    await q.query(`
      CREATE TABLE "cost_centers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "type" "public"."cost_centers_type_enum" NOT NULL,
        CONSTRAINT "PK_e70f55c677c255c1f81f0ed1ccb" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cost_centers_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`CREATE UNIQUE INDEX "IDX_cost_centers_org_code" ON "cost_centers" ("organization_id", "code")`);
    await q.query(`CREATE INDEX "IDX_ff21adcddb700b492f32cc29c1" ON "cost_centers" ("organization_id")`);
    await q.query(`ALTER TABLE "cost_centers" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "cost_centers" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "cost_centers"
        USING ("organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid)
        WITH CHECK ("organization_id" = (NULLIF(current_setting('app.current_organization', true), ''))::uuid)
    `);
    // The register is rebuilt from the values; the dimensions themselves stay, because lines may
    // carry them.
    for (const [type, dimension] of [
      ['COST_CENTER', 'Centro de Costo'],
      ['PROFIT_CENTER', 'Centro de Beneficio'],
    ]) {
      await q.query(
        `INSERT INTO "cost_centers" ("organization_id", "code", "name", "type")
         SELECT d."organization_id", v."value", COALESCE(v."name", v."value"), $2::"public"."cost_centers_type_enum"
           FROM "dimension_values" v JOIN "dimensions" d ON d."id" = v."dimension_id"
          WHERE d."name" = $1
         ON CONFLICT DO NOTHING`,
        [dimension, type],
      );
    }
    await q.query(`ALTER TABLE "dimension_values" DROP COLUMN "is_active"`);
    await q.query(`ALTER TABLE "dimension_values" DROP COLUMN "name"`);
    await q.query(`ALTER TABLE "dimensions" DROP COLUMN "is_active"`);
    await q.query(`ALTER TABLE "dimensions" DROP COLUMN "description"`);
  }
}

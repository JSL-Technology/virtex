import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two tables stored every foreign key twice, and the copy carrying the constraint was always null.
 *
 * An id property declared as `@Column({ type: 'uuid' }) parentAccountId` next to a
 * `@JoinColumn({ name: 'parent_account_id' })` does not name one column two ways — it creates two.
 * The application writes and queries the camelCase one; the foreign key, and therefore every join
 * TypeORM builds for `relations: [...]`, uses the snake_case one, which nothing ever populates.
 *
 * The consequences are not cosmetic:
 *
 * - **`consolidation_maps` could be written and not read.** Loading `parentAccount` joins on a null
 *   column, so every row came back without one. The consolidation treated every mapped subsidiary
 *   account as unmapped, which is why the map appeared to have no effect at all.
 * - **No referential integrity, on either table.** The constraint guarded a column that was always
 *   null, so a map could point at a deleted account and a proposed audit adjustment at a deleted
 *   journal. `ON DELETE CASCADE` never fired for the same reason.
 *
 * The camelCase columns hold the real values, so they are copied across before being dropped. On
 * `consolidation_maps` the primary key is on the camelCase columns too and is rebuilt on the
 * survivors.
 *
 * Three tables in the inventory module — `stock_items`, `stock_movements` and `locations` — carry
 * the same defect. They are deliberately left alone here: they are outside the finance and
 * accounting work this migration belongs to, and correcting them needs the inventory module's own
 * tests to prove nothing depended on the split.
 */
export class CollapseDuplicatedIdColumns1788900200000 implements MigrationInterface {
  name = 'CollapseDuplicatedIdColumns1788900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── consolidation_maps ───────────────────────────────────────────────────
    await queryRunner.query(`
      UPDATE "consolidation_maps" SET
        "parent_organization_id" = COALESCE("parent_organization_id", "parentOrganizationId"),
        "subsidiary_organization_id" = COALESCE("subsidiary_organization_id", "subsidiaryOrganizationId"),
        "subsidiary_account_id" = COALESCE("subsidiary_account_id", "subsidiaryAccountId"),
        "parent_account_id" = COALESCE("parent_account_id", "parentAccountId")
    `);

    // A row whose ids point at something that no longer exists cannot be made to satisfy the
    // foreign key. There is no correct value to repair it with, and a map naming a deleted account
    // is not a map — so it is removed rather than failing the deploy.
    await queryRunner.query(`
      DELETE FROM "consolidation_maps" cm
      WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = cm."parent_organization_id")
         OR NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = cm."subsidiary_organization_id")
         OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = cm."subsidiary_account_id")
         OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = cm."parent_account_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        DROP CONSTRAINT IF EXISTS "PK_934ae9ac44dc82be66ef1e75099"
    `);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        DROP COLUMN IF EXISTS "parentOrganizationId",
        DROP COLUMN IF EXISTS "subsidiaryOrganizationId",
        DROP COLUMN IF EXISTS "subsidiaryAccountId",
        DROP COLUMN IF EXISTS "parentAccountId"
    `);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        ALTER COLUMN "parent_organization_id" SET NOT NULL,
        ALTER COLUMN "subsidiary_organization_id" SET NOT NULL,
        ALTER COLUMN "subsidiary_account_id" SET NOT NULL,
        ALTER COLUMN "parent_account_id" SET NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        ADD CONSTRAINT "PK_consolidation_maps"
          PRIMARY KEY ("parent_organization_id", "subsidiary_organization_id", "subsidiary_account_id")
    `);
    // Consolidation loads the whole map for one parent and one subsidiary at a time.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_consolidation_maps_parent_subsidiary"
      ON "consolidation_maps" ("parent_organization_id", "subsidiary_organization_id")
    `);

    // ── proposed_audit_adjustments ───────────────────────────────────────────
    await queryRunner.query(`
      UPDATE "proposed_audit_adjustments"
      SET "journal_id" = COALESCE("journal_id", "journalId")
    `);
    await queryRunner.query(`
      DELETE FROM "proposed_audit_adjustments" p
      WHERE NOT EXISTS (SELECT 1 FROM "journals" j WHERE j."id" = p."journal_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "proposed_audit_adjustments" DROP COLUMN IF EXISTS "journalId"
    `);
    await queryRunner.query(`
      ALTER TABLE "proposed_audit_adjustments" ALTER COLUMN "journal_id" SET NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "proposed_audit_adjustments"
        ADD COLUMN IF NOT EXISTS "journalId" uuid
    `);
    await queryRunner.query(
      `UPDATE "proposed_audit_adjustments" SET "journalId" = "journal_id"`,
    );
    await queryRunner.query(`
      ALTER TABLE "proposed_audit_adjustments"
        ALTER COLUMN "journalId" SET NOT NULL,
        ALTER COLUMN "journal_id" DROP NOT NULL
    `);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_consolidation_maps_parent_subsidiary"`);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps" DROP CONSTRAINT IF EXISTS "PK_consolidation_maps"
    `);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        ADD COLUMN IF NOT EXISTS "parentOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "subsidiaryOrganizationId" uuid,
        ADD COLUMN IF NOT EXISTS "subsidiaryAccountId" uuid,
        ADD COLUMN IF NOT EXISTS "parentAccountId" uuid
    `);
    await queryRunner.query(`
      UPDATE "consolidation_maps" SET
        "parentOrganizationId" = "parent_organization_id",
        "subsidiaryOrganizationId" = "subsidiary_organization_id",
        "subsidiaryAccountId" = "subsidiary_account_id",
        "parentAccountId" = "parent_account_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "consolidation_maps"
        ALTER COLUMN "parentOrganizationId" SET NOT NULL,
        ALTER COLUMN "subsidiaryOrganizationId" SET NOT NULL,
        ALTER COLUMN "subsidiaryAccountId" SET NOT NULL,
        ALTER COLUMN "parentAccountId" SET NOT NULL,
        ALTER COLUMN "parent_organization_id" DROP NOT NULL,
        ALTER COLUMN "subsidiary_organization_id" DROP NOT NULL,
        ALTER COLUMN "subsidiary_account_id" DROP NOT NULL,
        ALTER COLUMN "parent_account_id" DROP NOT NULL,
        ADD CONSTRAINT "PK_934ae9ac44dc82be66ef1e75099"
          PRIMARY KEY ("parentOrganizationId", "subsidiaryOrganizationId", "subsidiaryAccountId")
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * One table for «X is a subsidiary of Y».
 *
 * The relationship was stored twice. `organization_subsidiaries` is what «Estructura empresarial»
 * writes when a subsidiary is created and what consolidation reads. `organization_group_members`
 * was added later for intercompany authorisation and nothing in the product ever wrote to it, so a
 * subsidiary created through the interface could never receive an intercompany transaction.
 *
 * Any row an operator did put into the second table is carried over before it is dropped: an
 * active membership becomes a subsidiary link (when the pair is not linked already), and an
 * inactive one becomes a link whose control ended today — the closest faithful reading of
 * «no longer in the group» now that the end of control is a date of its own.
 */
export class SingleCorporateGroupRelation1789009100000 implements MigrationInterface {
  name = 'SingleCorporateGroupRelation1789009100000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_subsidiaries" ADD COLUMN IF NOT EXISTS "control_ended_on" date`);

    const legacy = await q.query(`SELECT to_regclass('public.organization_group_members') AS name`);
    if (legacy[0]?.name) {
      await q.query(`
        INSERT INTO "organization_subsidiaries"
               ("parent_organization_id", "subsidiary_organization_id", "ownership", "control_ended_on")
        SELECT m."parent_organization_id",
               m."member_organization_id",
               round(m."ownership_percentage", 2),
               CASE WHEN m."is_active" THEN NULL ELSE CURRENT_DATE END
          FROM "organization_group_members" m
        ON CONFLICT ("parent_organization_id", "subsidiary_organization_id") DO NOTHING
      `);
      await q.query(`DROP TABLE "organization_group_members"`);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "organization_group_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "parent_organization_id" uuid NOT NULL,
        "member_organization_id" uuid NOT NULL,
        "ownership_percentage" numeric(7,4) NOT NULL DEFAULT 100,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_group_members" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organization_group_members" UNIQUE ("parent_organization_id", "member_organization_id"),
        CONSTRAINT "CK_organization_group_members_ownership"
          CHECK ("ownership_percentage" > 0 AND "ownership_percentage" <= 100),
        CONSTRAINT "CK_organization_group_members_distinct"
          CHECK ("parent_organization_id" <> "member_organization_id"),
        CONSTRAINT "FK_organization_group_members_parent"
          FOREIGN KEY ("parent_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_group_members_member"
          FOREIGN KEY ("member_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organization_group_members_member"
      ON "organization_group_members" ("member_organization_id")
    `);
    await q.query(`
      INSERT INTO "organization_group_members"
             ("parent_organization_id", "member_organization_id", "ownership_percentage", "is_active")
      SELECT "parent_organization_id", "subsidiary_organization_id", GREATEST("ownership", 0.0001),
             "control_ended_on" IS NULL OR "control_ended_on" > CURRENT_DATE
        FROM "organization_subsidiaries"
      ON CONFLICT DO NOTHING
    `);
    await q.query(`ALTER TABLE "organization_subsidiaries" DROP COLUMN IF EXISTS "control_ended_on"`);
  }
}

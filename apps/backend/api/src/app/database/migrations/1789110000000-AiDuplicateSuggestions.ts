import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Probable duplicates among customers, suppliers and products, and what a person decided about
 * each pair: the same record entered twice, or two different ones that only look alike. A decision
 * is kept across scans, so a pair once dismissed is never proposed again. Nothing is merged here.
 */
export class AiDuplicateSuggestions1789110000000 implements MigrationInterface {
  name = 'AiDuplicateSuggestions1789110000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ai_duplicate_suggestions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "entity_type" varchar(16) NOT NULL,
        "record_a_id" uuid NOT NULL,
        "record_b_id" uuid NOT NULL,
        "label_a" varchar(300) NOT NULL DEFAULT '',
        "label_b" varchar(300) NOT NULL DEFAULT '',
        "score" numeric(6,4) NOT NULL,
        "reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "status" varchar(16) NOT NULL DEFAULT 'OPEN',
        "decided_by_user_id" uuid NULL,
        "decided_at" timestamptz NULL,
        "detected_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ai_duplicate_suggestions" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ai_duplicate_suggestions_pair" UNIQUE ("organization_id", "entity_type", "record_a_id", "record_b_id"),
        CONSTRAINT "CHK_ai_duplicate_suggestions_type" CHECK ("entity_type" IN ('CUSTOMER', 'SUPPLIER', 'PRODUCT')),
        CONSTRAINT "CHK_ai_duplicate_suggestions_status" CHECK ("status" IN ('OPEN', 'SAME', 'NOT_DUPLICATE', 'STALE')),
        CONSTRAINT "CHK_ai_duplicate_suggestions_order" CHECK ("record_a_id" < "record_b_id"),
        CONSTRAINT "FK_ai_duplicate_suggestions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_ai_duplicate_suggestions_org_status"
        ON "ai_duplicate_suggestions" ("organization_id", "status", "entity_type")
    `);
    await q.query(`ALTER TABLE "ai_duplicate_suggestions" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "ai_duplicate_suggestions" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "ai_duplicate_suggestions"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "ai_duplicate_suggestions"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "ai_duplicate_suggestions" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "ai_duplicate_suggestions"`);
  }
}

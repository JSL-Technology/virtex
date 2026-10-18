import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collections: what was done to get an invoice paid — a reminder sent, a call made, a payment
 * promised, a note — by whom and when. A reminder can also be a DRAFT, written (by a person or by
 * the assistant) and waiting for someone to review and send it.
 *
 * The worklist reads these to rank who to chase next: a promise that was not kept moves a customer
 * up, a promise still in date moves them down, and a reminder sent yesterday means not today.
 */
export class Collections1789100000000 implements MigrationInterface {
  name = 'Collections1789100000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "collection_activities" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "invoice_id" uuid NULL,
        "kind" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'DONE',
        "occurred_at" timestamptz NOT NULL DEFAULT now(),
        "user_id" uuid NULL,
        "channel" varchar(16) NULL,
        "outcome" varchar(32) NULL,
        "promised_date" date NULL,
        "promised_amount" numeric(18,2) NULL,
        "recipient" varchar(320) NULL,
        "subject" varchar(300) NULL,
        "message" text NULL,
        "tone" varchar(16) NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_collection_activities" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_collection_activities_kind" CHECK ("kind" IN ('REMINDER', 'CALL', 'PROMISE', 'NOTE')),
        CONSTRAINT "CHK_collection_activities_status" CHECK ("status" IN ('DRAFT', 'DONE', 'CANCELLED')),
        CONSTRAINT "CHK_collection_activities_draft_reminder" CHECK ("status" <> 'DRAFT' OR "kind" = 'REMINDER'),
        CONSTRAINT "CHK_collection_activities_promise" CHECK ("kind" <> 'PROMISE' OR "promised_date" IS NOT NULL),
        CONSTRAINT "CHK_collection_activities_promised_amount" CHECK ("promised_amount" IS NULL OR "promised_amount" > 0),
        CONSTRAINT "FK_collection_activities_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_collection_activities_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_collection_activities_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_collection_activities_org_invoice"
        ON "collection_activities" ("organization_id", "invoice_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_collection_activities_org_customer_occurred"
        ON "collection_activities" ("organization_id", "customer_id", "occurred_at")
    `);

    await q.query(`ALTER TABLE "collection_activities" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "collection_activities" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "collection_activities"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "collection_activities"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "collection_activities" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "collection_activities"`);
  }
}

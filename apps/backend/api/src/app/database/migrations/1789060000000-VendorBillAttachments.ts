import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The supplier's own document behind a vendor bill: the photo or PDF it was entered from.
 *
 * The DGII can ask for the comprobante behind any line of the 606, so the file is evidence and is
 * kept with the bill. An attachment is uploaded first and claimed by the bill when it is saved
 * (`vendor_bill_id` NULL until then) — the same staging the product photos use — so the form can
 * read a bill from a photo before the bill exists. `sha256` finds the same file uploaded twice.
 */
export class VendorBillAttachments1789060000000 implements MigrationInterface {
  name = 'VendorBillAttachments1789060000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

    await q.query(`
      CREATE TABLE IF NOT EXISTS "vendor_bill_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "vendor_bill_id" uuid NULL,
        "file_name" varchar(255) NOT NULL,
        "mime_type" varchar(100) NOT NULL,
        "file_size" integer NOT NULL,
        "storage_key" varchar(500) NOT NULL,
        "sha256" char(64) NOT NULL,
        "uploaded_by_user_id" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vendor_bill_attachments" PRIMARY KEY ("id"),
        CONSTRAINT "FK_vendor_bill_attachments_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_vendor_bill_attachments_bill" FOREIGN KEY ("vendor_bill_id")
          REFERENCES "vendor_bills"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_bill_attachments_org_bill"
        ON "vendor_bill_attachments" ("organization_id", "vendor_bill_id")
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_vendor_bill_attachments_org_sha256"
        ON "vendor_bill_attachments" ("organization_id", "sha256")
    `);

    await q.query(`ALTER TABLE "vendor_bill_attachments" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "vendor_bill_attachments" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "vendor_bill_attachments"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "vendor_bill_attachments"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "vendor_bill_attachments" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "vendor_bill_attachments"`);
  }
}

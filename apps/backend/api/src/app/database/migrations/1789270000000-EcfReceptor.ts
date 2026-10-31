import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The receiving side of the e-CF cycle.
 *
 * Every electronic issuer must also RECEIVE: suppliers send their e-CF to the buyer's reception
 * service, the buyer answers with a signed acknowledgement (ARECF) and, within three business days,
 * a commercial approval (ACECF). And the tenant's own customers send their ACECF back to the tenant.
 * The product could issue and answer by hand, but exposed no reception service, so a tenant could
 * not be registered in the DGII's directory as a receiver — a certification requirement.
 *
 * - `ecf_received_documents`: what suppliers sent, with the acknowledgement returned to them, and
 *   what the tenant later decided about each one.
 * - `ecf_submissions.commercial_*`: the verdict a customer returned on a document this tenant issued.
 */
export class EcfReceptor1789270000000 implements MigrationInterface {
  name = 'EcfReceptor1789270000000';

  public async up(q: QueryRunner): Promise<void> {
    const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;
    await q.query(`
      CREATE TABLE IF NOT EXISTS "ecf_received_documents" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "issuer_rnc" varchar(16) NOT NULL,
        "issuer_name" varchar(255) NULL,
        "ncf" varchar(19) NOT NULL,
        "ecf_type" varchar(3) NOT NULL,
        "issue_date" date NULL,
        "total" numeric(18,2) NOT NULL DEFAULT 0,
        "itbis" numeric(18,2) NOT NULL DEFAULT 0,
        "currency_code" char(3) NOT NULL DEFAULT 'DOP',
        "xml" text NOT NULL,
        "signature_valid" boolean NOT NULL DEFAULT false,
        "ack_xml" text NULL,
        "status" varchar(16) NOT NULL DEFAULT 'RECEIVED',
        "commercial_message_id" uuid NULL,
        "rejection_reason" text NULL,
        "vendor_bill_id" uuid NULL,
        "received_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ecf_received_documents" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_ecf_received_documents_org_issuer_ncf" UNIQUE ("organization_id", "issuer_rnc", "ncf"),
        CONSTRAINT "CHK_ecf_received_documents_status" CHECK ("status" IN ('RECEIVED', 'APPROVED', 'REJECTED')),
        CONSTRAINT "FK_ecf_received_documents_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_ecf_received_documents_org_status" ON "ecf_received_documents" ("organization_id", "status", "received_at")`,
    );
    await q.query(`ALTER TABLE "ecf_received_documents" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "ecf_received_documents" FORCE ROW LEVEL SECURITY`);
    await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "ecf_received_documents"`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "ecf_received_documents"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);

    await q.query(`ALTER TABLE "ecf_submissions" ADD COLUMN IF NOT EXISTS "commercial_status" varchar(16) NULL`);
    await q.query(`ALTER TABLE "ecf_submissions" ADD COLUMN IF NOT EXISTS "commercial_reason" text NULL`);
    await q.query(`ALTER TABLE "ecf_submissions" ADD COLUMN IF NOT EXISTS "commercial_at" timestamptz NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ecf_submissions" DROP COLUMN IF EXISTS "commercial_at"`);
    await q.query(`ALTER TABLE "ecf_submissions" DROP COLUMN IF EXISTS "commercial_reason"`);
    await q.query(`ALTER TABLE "ecf_submissions" DROP COLUMN IF EXISTS "commercial_status"`);
    await q.query(`DROP TABLE IF EXISTS "ecf_received_documents"`);
  }
}

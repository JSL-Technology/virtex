import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Where each month's fiscal report stands: generated (with its record count and file hash) and
 * filed (with the authority's acknowledgement and the hash of what was filed). See
 * `FiscalReportFiling`.
 */
const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

export class FiscalReportFilings1789009500000 implements MigrationInterface {
  name = 'FiscalReportFilings1789009500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "fiscal_report_filings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "kind" varchar(8) NOT NULL,
        "year" int NOT NULL,
        "month" int NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'GENERATED',
        "record_count" int NOT NULL DEFAULT 0,
        "last_hash" varchar(64) NOT NULL,
        "last_generated_at" timestamptz NOT NULL,
        "last_generated_by_user_id" uuid,
        "submitted_hash" varchar(64),
        "submitted_record_count" int,
        "submitted_at" timestamptz,
        "submitted_by_user_id" uuid,
        "submission_reference" varchar(80),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_report_filings" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_fiscal_report_filings_month" CHECK ("month" BETWEEN 1 AND 12),
        CONSTRAINT "CHK_fiscal_report_filings_status" CHECK ("status" IN ('GENERATED', 'SUBMITTED')),
        CONSTRAINT "FK_fiscal_report_filings_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_fiscal_report_filings_org_kind_period"
        ON "fiscal_report_filings" ("organization_id", "kind", "year", "month")
    `);
    await q.query(`ALTER TABLE "fiscal_report_filings" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fiscal_report_filings" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "fiscal_report_filings"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS "fiscal_report_filings"`);
  }
}

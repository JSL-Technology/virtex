import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/**
 * Electronic invoicing outside the Dominican Republic, connected end to end (audit 2026-11-07,
 * FAC-EINV-01 and FAC-EINV-04).
 *
 * 1. `fiscal_regime_settings` gains the tenant's own transmission configuration: the authority's
 *    (or the PAC's) endpoint, an optional status endpoint, the SOAP action, and the credential —
 *    encrypted with the application's single at-rest cipher, never returned by the API. It was a
 *    process-wide environment variable, so every tenant of a market shared one credential.
 * 2. `fiscal_submissions`: one row per electronic document, committed with the invoice (an
 *    outbox). The worker builds, seals and transmits after the commit; the reconciler retries and
 *    asks for verdicts. Same-tenant guard on the invoice reference; one row per invoice.
 */
export class FiscalRegimeSubmissions1789450000000 implements MigrationInterface {
  name = 'FiscalRegimeSubmissions1789450000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "fiscal_regime_settings"
        ADD COLUMN "transmission_endpoint" varchar(512),
        ADD COLUMN "status_endpoint" varchar(512),
        ADD COLUMN "soap_action" varchar(256),
        ADD COLUMN "credential_scheme" varchar(16),
        ADD COLUMN "credential_ciphertext" text,
        ADD COLUMN "credential_updated_at" timestamptz,
        ADD CONSTRAINT "CHK_fiscal_regime_settings_credential_scheme"
          CHECK ("credential_scheme" IS NULL OR "credential_scheme" IN ('BEARER', 'BASIC')),
        ADD CONSTRAINT "CHK_fiscal_regime_settings_endpoint_https"
          CHECK ("transmission_endpoint" IS NULL OR "transmission_endpoint" LIKE 'https://%'),
        ADD CONSTRAINT "CHK_fiscal_regime_settings_status_endpoint_https"
          CHECK ("status_endpoint" IS NULL OR "status_endpoint" LIKE 'https://%')
    `);

    await q.query(`
      CREATE TYPE "fiscal_submissions_status_enum" AS ENUM
        ('PENDING', 'NOT_CONFIGURED', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR')
    `);
    await q.query(`
      CREATE TABLE "fiscal_submissions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "invoice_id" uuid NOT NULL,
        "country_code" varchar(2) NOT NULL,
        "regime" varchar(32) NOT NULL,
        "fiscal_number" varchar(64),
        "status" "fiscal_submissions_status_enum" NOT NULL DEFAULT 'PENDING',
        "document_key" varchar(128),
        "tracking_id" varchar(128),
        "authorization" text,
        "payload" text,
        "messages" jsonb NOT NULL DEFAULT '[]',
        "response" jsonb,
        "attempts" integer NOT NULL DEFAULT 0,
        "next_attempt_at" timestamptz,
        "last_error" text,
        "sent_at" timestamptz,
        "responded_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_fiscal_submissions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_fiscal_submissions_organization" FOREIGN KEY ("organization_id")
          REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_fiscal_submissions_invoice" FOREIGN KEY ("invoice_id")
          REFERENCES "invoices"("id") ON DELETE RESTRICT,
        CONSTRAINT "CHK_fiscal_submissions_attempts" CHECK ("attempts" >= 0)
      )
    `);
    await q.query(`CREATE UNIQUE INDEX "UQ_fiscal_submissions_invoice" ON "fiscal_submissions" ("invoice_id")`);
    await q.query(`CREATE INDEX "IDX_fiscal_submissions_due" ON "fiscal_submissions" ("organization_id", "status", "next_attempt_at")`);

    // Tenant isolation, as every tenant table: row-level security on the organization column.
    await q.query(`ALTER TABLE "fiscal_submissions" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "fiscal_submissions" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "fiscal_submissions"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})
    `);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "fiscal_submissions" TO virtex_app;
        END IF;
      END
      $$;
    `);
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "fiscal_submissions"`);
    await q.query(`DROP TYPE "fiscal_submissions_status_enum"`);
    await q.query(`
      ALTER TABLE "fiscal_regime_settings"
        DROP CONSTRAINT "CHK_fiscal_regime_settings_status_endpoint_https",
        DROP CONSTRAINT "CHK_fiscal_regime_settings_endpoint_https",
        DROP CONSTRAINT "CHK_fiscal_regime_settings_credential_scheme",
        DROP COLUMN "credential_updated_at",
        DROP COLUMN "credential_ciphertext",
        DROP COLUMN "credential_scheme",
        DROP COLUMN "soap_action",
        DROP COLUMN "status_endpoint",
        DROP COLUMN "transmission_endpoint"
    `);
  }
}

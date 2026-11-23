import { MigrationInterface, QueryRunner } from 'typeorm';

const TENANT = `(NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

/**
 * The basics a supplier record lacked (audit 2026-11-07, CMP-17): payment terms, currency, default
 * expense account, an active/blocked status, and bank accounts — without which no electronic
 * payment can be prepared. Account numbers are encrypted at rest (`encryptedColumnTransformer`);
 * only the last four digits are stored in clear, for display.
 */
export class SupplierCommercialTerms1789540000000 implements MigrationInterface {
  name = 'SupplierCommercialTerms1789540000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "suppliers"
        ADD COLUMN "payment_term_days" integer,
        ADD COLUMN "currency_code" character varying(3),
        ADD COLUMN "default_expense_account_id" uuid,
        ADD COLUMN "status" character varying(10) NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN "blocked_reason" text,
        ADD CONSTRAINT "CHK_suppliers_payment_term_days" CHECK ("payment_term_days" IS NULL OR ("payment_term_days" >= 0 AND "payment_term_days" <= 365)),
        ADD CONSTRAINT "CHK_suppliers_status" CHECK ("status" IN ('ACTIVE', 'BLOCKED')),
        ADD CONSTRAINT "FK_suppliers_default_expense_account" FOREIGN KEY ("default_expense_account_id")
          REFERENCES "accounts"("id") ON DELETE SET NULL`);

    await q.query(`
      CREATE TABLE "supplier_bank_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "supplier_id" uuid NOT NULL,
        "bank_name" character varying(120) NOT NULL,
        "account_holder" character varying(160),
        "account_type" character varying(10) NOT NULL DEFAULT 'CHECKING',
        "account_number" text NOT NULL,
        "account_last4" character varying(4) NOT NULL,
        "currency_code" character varying(3),
        "swift" character varying(11),
        "iban" character varying(34),
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_supplier_bank_accounts" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_supplier_bank_accounts_type" CHECK ("account_type" IN ('CHECKING', 'SAVINGS')),
        CONSTRAINT "FK_supplier_bank_accounts_organization" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_supplier_bank_accounts_supplier" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE CASCADE
      )`);
    await q.query(`CREATE INDEX "IDX_supplier_bank_accounts_supplier" ON "supplier_bank_accounts" ("organization_id", "supplier_id")`);
    await q.query(
      `CREATE UNIQUE INDEX "UQ_supplier_bank_accounts_default" ON "supplier_bank_accounts" ("supplier_id") WHERE "is_default"`,
    );
    await q.query(`ALTER TABLE "supplier_bank_accounts" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "supplier_bank_accounts" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "supplier_bank_accounts"
        USING ("organization_id" = ${TENANT}) WITH CHECK ("organization_id" = ${TENANT})`);
    await q.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "supplier_bank_accounts" TO virtex_app;
        END IF;
      END
      $$`);
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "supplier_bank_accounts"`);
    await q.query(`
      ALTER TABLE "suppliers"
        DROP CONSTRAINT "FK_suppliers_default_expense_account",
        DROP CONSTRAINT "CHK_suppliers_status",
        DROP CONSTRAINT "CHK_suppliers_payment_term_days",
        DROP COLUMN "payment_term_days", DROP COLUMN "currency_code", DROP COLUMN "default_expense_account_id",
        DROP COLUMN "status", DROP COLUMN "blocked_reason"`);
  }
}

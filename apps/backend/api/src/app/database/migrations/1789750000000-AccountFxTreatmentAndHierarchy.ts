import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The chart of accounts states its foreign-currency treatment and keeps one hierarchy (FIN-AC-03,
 * FIN-COA-04, FIN-COA-05).
 *
 * 1. **`accounts.fx_treatment`** — `REVALUED` (a monetary item, restated at the closing rate) or
 *    `HISTORICAL` (IAS 21.23). It replaces `is_multi_currency`, which said whether an account held
 *    several currencies; the revaluation then guessed which accounts were monetary from their
 *    roles, the bank accounts posting to them, and that flag. Existing accounts get the treatment
 *    the revaluation applied to them, with one correction: customer advances become `HISTORICAL`,
 *    because an advance settled by delivering goods or services is non-monetary (IFRIC 22).
 *    Liabilities with no role (accruals, income tax, long-term debt) become `REVALUED`.
 *
 * 2. **`accounts_closure` is dropped.** TypeORM fills a closure table only when the parent relation
 *    is set on save; every writer set `parent_id`, so the table held each account as its own only
 *    ancestor and the subtree endpoint answered with the account itself (FIN-COA-04). The hierarchy
 *    is `parent_id`, read with recursive queries, and now indexed — it was not. The dimension values'
 *    closure table goes too: maintained, and read by nothing.
 *
 * 3. **`accounts_hierarchy_rules`** — a parent is a summary account of its child's type. The
 *    service refuses the mismatch with its own message; this trigger is what holds for every other
 *    writer (an import, a provisioning, a script), since a revenue account under assets or a
 *    sub-account under an account with postings makes every hierarchical total wrong (FIN-COA-05).
 *
 * 4. **`organization_settings.default_unrealized_forex_gain_loss_account_id`** — where the
 *    period-end revaluation posts, apart from the realised differences. Empty for existing
 *    companies, which keep posting both to their exchange-difference account.
 */
const MONETARY_ROLES = [
  'CASH',
  'BANK',
  'ACCOUNTS_RECEIVABLE',
  'DOUBTFUL_ALLOWANCE',
  'TAX_RECEIVABLE',
  'WITHHOLDING_RECEIVABLE',
  'ACCOUNTS_PAYABLE',
  'GOODS_RECEIVED_NOT_INVOICED',
  'TAX_PAYABLE',
  'EXCISE_TAX_PAYABLE',
  'WITHHOLDING_PAYABLE',
  'SERVICE_CHARGE_PAYABLE',
  'PAYROLL_NET_PAYABLE',
  'PENSION_CONTRIBUTIONS_PAYABLE',
  'HEALTH_CONTRIBUTIONS_PAYABLE',
  'OTHER_PAYROLL_CONTRIBUTIONS_PAYABLE',
  'PAYROLL_TAX_WITHHOLDING_PAYABLE',
];

export class AccountFxTreatmentAndHierarchy1789750000000 implements MigrationInterface {
  name = 'AccountFxTreatmentAndHierarchy1789750000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── 1. Foreign-currency treatment ───────────────────────────────────────────────────────
    await q.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "fx_treatment" varchar(10) NOT NULL DEFAULT 'HISTORICAL'`);
    await q.query(
      `
      UPDATE "accounts" a
         SET "fx_treatment" = 'REVALUED'
       WHERE a."type"::text IN ('ASSET', 'LIABILITY')
         AND (a."system_role" IS DISTINCT FROM 'CUSTOMER_ADVANCES')
         AND (
               a."is_multi_currency"
            OR a."system_role" = ANY ($1::text[])
            OR (a."type"::text = 'LIABILITY' AND a."system_role" IS NULL)
            OR EXISTS (SELECT 1 FROM "bank_accounts" b WHERE b."gl_account_id" = a."id")
            OR EXISTS (
                 SELECT 1 FROM "organization_settings" s
                  WHERE s."organization_id" = a."organization_id"
                    AND a."id" IN (s."default_accounts_receivable_id", s."default_accounts_payable_id",
                                   s."default_cash_id", s."default_bank_id",
                                   s."default_intercompany_receivable_id", s."default_intercompany_payable_id")
               )
         )
      `,
      [MONETARY_ROLES],
    );
    await q.query(`ALTER TABLE "accounts" ADD CONSTRAINT "CHK_accounts_fx_treatment" CHECK ("fx_treatment" IN ('REVALUED', 'HISTORICAL'))`);
    await q.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "CHK_accounts_revalued_balance_sheet" CHECK ("fx_treatment" = 'HISTORICAL' OR "type" IN ('ASSET', 'LIABILITY'))`,
    );
    await q.query(`UPDATE "accounts" SET "currency" = upper("currency") WHERE "currency" IS NOT NULL`);
    await q.query(`ALTER TABLE "accounts" ADD CONSTRAINT "CHK_accounts_currency_code" CHECK ("currency" IS NULL OR "currency" ~ '^[A-Z]{3}$')`);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "is_multi_currency"`);

    // ── 2. One hierarchy ────────────────────────────────────────────────────────────────────
    await q.query(`DROP TABLE IF EXISTS "accounts_closure"`);
    // The dimension values' closure table: maintained, and read by nothing.
    await q.query(`DROP TABLE IF EXISTS "dimension_values_closure"`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_accounts_parent" ON "accounts" ("parent_id") WHERE "parent_id" IS NOT NULL`);

    // ── 3. Hierarchy rules for every writer ─────────────────────────────────────────────────
    await q.query(`
      CREATE OR REPLACE FUNCTION accounts_hierarchy_rules() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        parent_type text;
        parent_postable boolean;
      BEGIN
        IF NEW."parent_id" IS NOT NULL THEN
          SELECT p."type"::text, p."isPostable" INTO parent_type, parent_postable
            FROM "accounts" p WHERE p."id" = NEW."parent_id";
          IF parent_type IS NOT NULL AND parent_type <> NEW."type"::text THEN
            RAISE EXCEPTION 'Account % (%) cannot sit under an account of type %', NEW."code", NEW."type", parent_type
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_child_type_matches_parent';
          END IF;
          IF parent_postable THEN
            RAISE EXCEPTION 'Account % cannot sit under an account that takes postings', NEW."code"
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_parent_is_summary';
          END IF;
        END IF;
        IF NEW."isPostable" AND EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_id" = NEW."id") THEN
          RAISE EXCEPTION 'Account % has sub-accounts and cannot take postings', NEW."code"
            USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_parent_is_summary';
        END IF;
        IF TG_OP = 'UPDATE' AND NEW."type" IS DISTINCT FROM OLD."type"
           AND EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_id" = NEW."id" AND c."type" <> NEW."type") THEN
          RAISE EXCEPTION 'Account % has sub-accounts of type %', NEW."code", OLD."type"
            USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_child_type_matches_parent';
        END IF;
        RETURN NEW;
      END
      $$;
    `);
    await q.query(`DROP TRIGGER IF EXISTS "accounts_hierarchy_rules" ON "accounts"`);
    await q.query(`
      CREATE TRIGGER "accounts_hierarchy_rules"
        BEFORE INSERT OR UPDATE OF "parent_id", "type", "isPostable" ON "accounts"
        FOR EACH ROW EXECUTE FUNCTION accounts_hierarchy_rules()
    `);

    // ── 4. Unrealised exchange differences ──────────────────────────────────────────────────
    await q.query(
      `ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_unrealized_forex_gain_loss_account_id" uuid`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "default_unrealized_forex_gain_loss_account_id"`);

    await q.query(`DROP TRIGGER IF EXISTS "accounts_hierarchy_rules" ON "accounts"`);
    await q.query(`DROP FUNCTION IF EXISTS accounts_hierarchy_rules()`);

    await q.query(`DROP INDEX IF EXISTS "IDX_accounts_parent"`);
    await q.query(`
      CREATE TABLE "dimension_values_closure" (
        "id_ancestor" uuid NOT NULL,
        "id_descendant" uuid NOT NULL,
        CONSTRAINT "PK_ea10a51910fabcc038f80b2ebfc" PRIMARY KEY ("id_ancestor", "id_descendant")
      )
    `);
    await q.query(`CREATE INDEX "IDX_294d0f7f24a296b338c07ccf81" ON "dimension_values_closure" ("id_ancestor")`);
    await q.query(`CREATE INDEX "IDX_847b35a08279e463993c3f94d5" ON "dimension_values_closure" ("id_descendant")`);
    await q.query(
      `ALTER TABLE "dimension_values_closure" ADD CONSTRAINT "FK_294d0f7f24a296b338c07ccf819" FOREIGN KEY ("id_ancestor") REFERENCES "dimension_values"("id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "dimension_values_closure" ADD CONSTRAINT "FK_847b35a08279e463993c3f94d50" FOREIGN KEY ("id_descendant") REFERENCES "dimension_values"("id") ON DELETE CASCADE`,
    );
    await q.query(`
      INSERT INTO "dimension_values_closure" ("id_ancestor", "id_descendant")
      WITH RECURSIVE chain AS (
        SELECT v."id" AS ancestor, v."id" AS descendant FROM "dimension_values" v
        UNION
        SELECT c.ancestor, child."id" FROM chain c JOIN "dimension_values" child ON child."parent_id" = c.descendant
      )
      SELECT ancestor, descendant FROM chain
    `);
    await q.query(`ALTER TABLE "dimension_values_closure" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "dimension_values_closure" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "dimension_values_closure"
        USING (EXISTS (SELECT 1 FROM "dimension_values" p0 WHERE p0."id" = "dimension_values_closure"."id_descendant"
                        AND EXISTS (SELECT 1 FROM "dimensions" p1 WHERE p1."id" = p0."dimension_id"
                                     AND p1."organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid)))
        WITH CHECK (EXISTS (SELECT 1 FROM "dimension_values" p0 WHERE p0."id" = "dimension_values_closure"."id_descendant"
                        AND EXISTS (SELECT 1 FROM "dimensions" p1 WHERE p1."id" = p0."dimension_id"
                                     AND p1."organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid)))
    `);
    // The closure table as it was declared, filled correctly this time: every (ancestor, descendant)
    // pair the parent links describe, each account its own ancestor too.
    await q.query(`
      CREATE TABLE "accounts_closure" (
        "id_ancestor" uuid NOT NULL,
        "id_descendant" uuid NOT NULL,
        CONSTRAINT "PK_020fb711a2153cb344ddcdde4b5" PRIMARY KEY ("id_ancestor", "id_descendant")
      )
    `);
    await q.query(`CREATE INDEX "IDX_e9fbbef2610c47848c590df777" ON "accounts_closure" ("id_ancestor")`);
    await q.query(`CREATE INDEX "IDX_8985ce01c4f638537657b753a8" ON "accounts_closure" ("id_descendant")`);
    await q.query(
      `ALTER TABLE "accounts_closure" ADD CONSTRAINT "FK_e9fbbef2610c47848c590df7773" FOREIGN KEY ("id_ancestor") REFERENCES "accounts"("id") ON DELETE CASCADE`,
    );
    await q.query(
      `ALTER TABLE "accounts_closure" ADD CONSTRAINT "FK_8985ce01c4f638537657b753a8c" FOREIGN KEY ("id_descendant") REFERENCES "accounts"("id") ON DELETE CASCADE`,
    );
    await q.query(`
      INSERT INTO "accounts_closure" ("id_ancestor", "id_descendant")
      WITH RECURSIVE chain AS (
        SELECT a."id" AS ancestor, a."id" AS descendant FROM "accounts" a
        UNION
        SELECT c.ancestor, child."id" FROM chain c JOIN "accounts" child ON child."parent_id" = c.descendant
      )
      SELECT ancestor, descendant FROM chain
    `);
    await q.query(`ALTER TABLE "accounts_closure" ENABLE ROW LEVEL SECURITY`);
    await q.query(`ALTER TABLE "accounts_closure" FORCE ROW LEVEL SECURITY`);
    await q.query(`
      CREATE POLICY tenant_isolation ON "accounts_closure"
        USING (EXISTS (SELECT 1 FROM "accounts" p0 WHERE p0."id" = "accounts_closure"."id_descendant"
                        AND p0."organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid))
        WITH CHECK (EXISTS (SELECT 1 FROM "accounts" p0 WHERE p0."id" = "accounts_closure"."id_descendant"
                        AND p0."organization_id" = NULLIF(current_setting('app.current_organization', true), '')::uuid))
    `);

    await q.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "is_multi_currency" boolean NOT NULL DEFAULT false`);
    // What the flag used to carry: revalued accounts the old inference did not already reach.
    await q.query(
      `
      UPDATE "accounts" a SET "is_multi_currency" = true
       WHERE a."fx_treatment" = 'REVALUED'
         AND a."system_role" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "bank_accounts" b WHERE b."gl_account_id" = a."id")
      `,
    );
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_currency_code"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_revalued_balance_sheet"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_fx_treatment"`);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "fx_treatment"`);
  }
}

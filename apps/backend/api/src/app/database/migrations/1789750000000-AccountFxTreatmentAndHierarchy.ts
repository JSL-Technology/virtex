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
 *    Liabilities with no role (accruals, income tax, long-term debt) become `REVALUED`. Only
 *    accounts that take postings: a summary account carries no balance of its own, so it has no
 *    treatment and no currency (`CHK_accounts_summary_has_no_currency`). The ledger account of each
 *    bank account takes the bank's currency, as a new one does, where its lines allow it.
 *
 * 2. **`accounts_closure` is dropped.** TypeORM fills a closure table only when the parent relation
 *    is set on save; every writer set `parent_id`, so the table held each account as its own only
 *    ancestor and the subtree endpoint answered with the account itself (FIN-COA-04). The hierarchy
 *    is `parent_id`, read with recursive queries, and now indexed — it was not. The dimension values'
 *    closure table goes too: maintained, and read by nothing.
 *
 * 3. **`accounts_hierarchy_rules`** — a parent is a summary account of its child's type, and the
 *    tree has no loops. The service refuses each case with its own message; this trigger is what
 *    holds for every other writer (an import, a provisioning, a script), since a revenue account
 *    under assets or a sub-account under an account with postings makes every hierarchical total
 *    wrong (FIN-COA-05), and a loop makes every walk up the tree endless. It checks what a statement
 *    changes, under a lock on the parent row, and serialises re-parenting per company: two moves
 *    that each look fine alone cannot together close a loop. The rows already there are checked
 *    first, and the migration stops if one breaks a rule.
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
         AND a."isPostable"
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
    // The column said «the currency if the account is a single-foreign-currency account»; it is the
    // currency every line on the account is in, the books' own included.
    await q.query(
      `COMMENT ON COLUMN "accounts"."currency" IS 'Moneda ISO 4217 de la cuenta: todo movimiento en ella va en esta moneda. Nula: cualquier moneda.'`,
    );
    // A summary account takes no lines: a currency on one described nothing.
    await q.query(`UPDATE "accounts" SET "currency" = NULL WHERE NOT "isPostable" AND "currency" IS NOT NULL`);
    await q.query(
      `ALTER TABLE "accounts" ADD CONSTRAINT "CHK_accounts_summary_has_no_currency" CHECK ("isPostable" OR ("fx_treatment" = 'HISTORICAL' AND "currency" IS NULL))`,
    );
    // A bank account's ledger account takes the bank's currency, as a new one does
    // (`TreasuryService.claimLedgerAccount`) — where its lines allow it: one whose bank accounts are
    // in several currencies, or with a line in another currency, is left for its company to sort out.
    await q.query(`
      UPDATE "accounts" a
         SET "currency" = b.currency
        FROM (
          SELECT "gl_account_id", min(upper("currency_code")) AS currency
            FROM "bank_accounts"
           GROUP BY "gl_account_id"
          HAVING count(DISTINCT upper("currency_code")) = 1
        ) b
       WHERE a."id" = b."gl_account_id"
         AND a."currency" IS NULL
         AND a."isPostable"
         AND NOT EXISTS (
               SELECT 1 FROM "journal_entry_lines" l
                WHERE l."account_id" = a."id"
                  AND upper(coalesce(l."currency_code",
                        (SELECT s."base_currency" FROM "organization_settings" s WHERE s."organization_id" = a."organization_id"))) <> b.currency
             )
    `);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "is_multi_currency"`);

    // ── 2. One hierarchy ────────────────────────────────────────────────────────────────────
    await q.query(`DROP TABLE IF EXISTS "accounts_closure"`);
    // The dimension values' closure table: maintained, and read by nothing.
    await q.query(`DROP TABLE IF EXISTS "dimension_values_closure"`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_accounts_parent" ON "accounts" ("parent_id") WHERE "parent_id" IS NOT NULL`);

    // ── 3. Hierarchy rules for every writer ─────────────────────────────────────────────────
    // The trigger checks what a statement changes, so a row that already breaks a rule would stay
    // broken unseen. The rows are checked here first, and the migration stops on one, naming it.
    await q.query(`
      DO $check$
      DECLARE
        offenders text;
      BEGIN
        SELECT string_agg(format('%s (%s)', c."code", c."organization_id"), ', ')
          INTO offenders
          FROM (
            SELECT c."code", c."organization_id"
              FROM "accounts" c
              JOIN "accounts" p ON p."id" = c."parent_id"
             WHERE p."type" <> c."type" OR p."isPostable" OR p."organization_id" <> c."organization_id"
             ORDER BY c."organization_id", c."code"
             LIMIT 20
          ) c;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION 'Accounts whose parent is not a summary account of their type and company: %', offenders;
        END IF;

        WITH RECURSIVE walk ("id", "parent_id") AS (
          SELECT a."id", a."parent_id" FROM "accounts" a WHERE a."parent_id" IS NOT NULL
          UNION ALL
          SELECT p."id", p."parent_id" FROM walk w JOIN "accounts" p ON p."id" = w."parent_id"
        ) CYCLE "id" SET looped USING path
        SELECT string_agg(DISTINCT a."code" || ' (' || a."organization_id" || ')', ', ')
          INTO offenders
          FROM walk w JOIN "accounts" a ON a."id" = w."id"
         WHERE w.looped;
        IF offenders IS NOT NULL THEN
          RAISE EXCEPTION 'Accounts in a loop of parents: %', offenders;
        END IF;
      END
      $check$;
    `);
    await q.query(`
      CREATE OR REPLACE FUNCTION accounts_hierarchy_rules() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        parent_type text;
        parent_postable boolean;
        parent_changed boolean := TG_OP = 'INSERT' OR NEW."parent_id" IS DISTINCT FROM OLD."parent_id";
        type_changed boolean := TG_OP = 'UPDATE' AND NEW."type" IS DISTINCT FROM OLD."type";
        became_postable boolean := NEW."isPostable" AND (TG_OP = 'INSERT' OR NOT OLD."isPostable");
      BEGIN
        IF NEW."parent_id" IS NOT NULL AND (parent_changed OR type_changed) THEN
          IF NEW."parent_id" = NEW."id" THEN
            RAISE EXCEPTION 'Account % cannot be its own parent', NEW."code"
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_hierarchy_acyclic';
          END IF;
          -- FOR SHARE: the parent cannot start taking postings, or change type, until this
          -- statement's transaction ends — two writers cannot each pass the check alone.
          SELECT p."type"::text, p."isPostable" INTO parent_type, parent_postable
            FROM "accounts" p WHERE p."id" = NEW."parent_id"
             FOR SHARE;
          IF parent_type IS NOT NULL AND parent_type <> NEW."type"::text THEN
            RAISE EXCEPTION 'Account % (%) cannot sit under an account of type %', NEW."code", NEW."type", parent_type
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_child_type_matches_parent';
          END IF;
          IF parent_postable THEN
            RAISE EXCEPTION 'Account % cannot sit under an account that takes postings', NEW."code"
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_parent_is_summary';
          END IF;
        END IF;
        IF TG_OP = 'UPDATE' AND NEW."parent_id" IS NOT NULL AND parent_changed THEN
          -- One move at a time per company: two moves that each leave the tree sound can close a
          -- loop together, and each would check the tree without the other.
          PERFORM pg_advisory_xact_lock(hashtextextended('accounts_hierarchy:' || NEW."organization_id"::text, 0));
          IF EXISTS (
            WITH RECURSIVE ancestors ("id", "parent_id") AS (
              SELECT p."id", p."parent_id" FROM "accounts" p WHERE p."id" = NEW."parent_id"
              UNION
              SELECT a."id", a."parent_id" FROM "accounts" a JOIN ancestors x ON a."id" = x."parent_id"
            )
            SELECT 1 FROM ancestors WHERE "id" = NEW."id"
          ) THEN
            RAISE EXCEPTION 'Account % cannot sit under one of its own sub-accounts', NEW."code"
              USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_hierarchy_acyclic';
          END IF;
        END IF;
        IF became_postable AND EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_id" = NEW."id") THEN
          RAISE EXCEPTION 'Account % has sub-accounts and cannot take postings', NEW."code"
            USING ERRCODE = '23514', CONSTRAINT = 'CHK_accounts_parent_is_summary';
        END IF;
        IF type_changed AND EXISTS (SELECT 1 FROM "accounts" c WHERE c."parent_id" = NEW."id" AND c."type" <> NEW."type") THEN
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
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_summary_has_no_currency"`);
    await q.query(
      `COMMENT ON COLUMN "accounts"."currency" IS 'Código de moneda ISO 4217 si la cuenta es de moneda única extranjera.'`,
    );
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_currency_code"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_revalued_balance_sheet"`);
    await q.query(`ALTER TABLE "accounts" DROP CONSTRAINT IF EXISTS "CHK_accounts_fx_treatment"`);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "fx_treatment"`);
  }
}

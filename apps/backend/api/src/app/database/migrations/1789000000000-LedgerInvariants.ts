import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The accounting invariants stop being a convention and become a property of the database.
 *
 * ## Why they cannot live only in TypeScript
 *
 * Double entry, the exclusivity of debit and credit, non-negativity and the immutability of a
 * posted record were enforced in exactly one place: `JournalEntriesService`. Everything else —
 * a data-migration script, a future job, a support engineer with `psql`, a second service written
 * next year, an ORM call that bypasses the service — could write a ledger that does not balance,
 * and nothing would refuse it. `BalanceSheetReport.isBalanced` would eventually report that the
 * books were wrong, without being able to say which entry did it or when.
 *
 * The rule the checks below encode is the one thing accounting has that software usually does not:
 * an invariant that is true of every state of the data, not merely of every path through the code.
 * It belongs where every path has to go through it.
 *
 * ## What is added
 *
 * 1. **Sign and exclusivity**, as `CHECK` constraints on the line and on the valuation. A line
 *    carries a debit or a credit, never both, never negative, never nothing.
 * 2. **Double entry**, as a `CONSTRAINT TRIGGER … DEFERRABLE INITIALLY DEFERRED` evaluated at
 *    COMMIT and applied **per (entry, ledger)**. Deferred because an entry is written line by line
 *    and is legitimately unbalanced in the middle of the transaction that creates it; per ledger
 *    because a multi-GAAP entry has to balance in every book it touches, and an incomplete set of
 *    mapping rules produces an entry that balances in the primary ledger and not in the secondary.
 *    It is enforced over `journal_entry_line_valuations`, which is the table every balance in the
 *    product is a `SUM` over — the application's own checks summed `journal_entry_lines.debit`,
 *    a column no report reads.
 * 3. **Immutability of the posted record.** A posted entry may change status to Modified or Void,
 *    be marked reversed, and point at its successor. Its date, its amounts, its journal, its
 *    number and its tenant may not change, and it may not be deleted. Its lines may not be edited
 *    or deleted at all, beyond the reconciliation flags, which are not accounting data.
 * 4. **The columns those invariants and the audit trail need**: the entry's idempotency key with
 *    its unique index, the provenance of the exchange rate it was posted at, the document
 *    discount and taxable base per invoice line, the document's excise, and the two
 *    exchange-rate controls on the tenant's settings.
 *
 * ## Deleting a tenant still works
 *
 * The delete guards ask whether the owning row still exists. `DELETE FROM organizations` removes
 * the parent first and the cascade then reaches the ledger with the organization already gone, so
 * the guard permits it; every other delete finds the organization present and is refused. No
 * escape hatch, no session flag to remember to set, and `tenant-deletion.spec.ts` proves the
 * cascade still completes.
 *
 * ## Existing data
 *
 * The constraints are added `NOT VALID` and then validated, so the statement takes a weaker lock
 * and, more importantly, so a deployment against books that already contain a violation fails
 * loudly at `VALIDATE` with the offending rows still present to be corrected — rather than either
 * silently accepting them or blocking on a full table rewrite.
 */
export class LedgerInvariants1789000000000 implements MigrationInterface {
  name = 'LedgerInvariants1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Columns ───────────────────────────────────────────────────────────────

    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD COLUMN IF NOT EXISTS "idempotency_key" character varying(200),
        ADD COLUMN IF NOT EXISTS "exchange_rate_type" character varying(24),
        ADD COLUMN IF NOT EXISTS "exchange_rate_source" character varying(64),
        ADD COLUMN IF NOT EXISTS "exchange_rate_method" character varying(16),
        ADD COLUMN IF NOT EXISTS "exchange_rate_quoted_on" date
    `);

    // The lookup in `JournalEntriesService` is the fast path; this index is what actually holds
    // under concurrency, because two workers replaying the same job can both read "not posted yet"
    // before either commits.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_journal_entries_org_idempotency_key"
      ON "journal_entries" ("organization_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "invoice_line_item"
        ADD COLUMN IF NOT EXISTS "document_discount_amount" numeric(18,2) NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "taxable_base" numeric(18,2) NOT NULL DEFAULT 0
    `);
    // Backfill: before the document discount reduced the taxable base, the base WAS the line
    // subtotal. Writing that makes the stored figure true of the documents already issued rather
    // than leaving a zero that reads as "nothing was taxable".
    await queryRunner.query(`
      UPDATE "invoice_line_item"
      SET "taxable_base" = "line_subtotal"
      WHERE "taxable_base" = 0 AND "line_subtotal" <> 0
    `);

    await queryRunner.query(`
      ALTER TABLE "invoices"
        ADD COLUMN IF NOT EXISTS "excise" numeric(18,2) NOT NULL DEFAULT 0
    `);
    // The excise was computed per line and never totalled onto the document.
    await queryRunner.query(`
      UPDATE "invoices" i
      SET "excise" = COALESCE(sub.total, 0)
      FROM (
        SELECT "invoiceId" AS invoice_id, SUM("excise_amount") AS total
        FROM "invoice_line_item"
        GROUP BY "invoiceId"
      ) AS sub
      WHERE sub."invoice_id" = i."id" AND i."excise" = 0
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_excise_tax_payable_id" uuid,
        ADD COLUMN IF NOT EXISTS "fx_rate_tolerance" numeric(9,6) NOT NULL DEFAULT 0.02,
        ADD COLUMN IF NOT EXISTS "fx_rate_max_age_days" integer NOT NULL DEFAULT 10
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        DROP CONSTRAINT IF EXISTS "FK_organization_settings_excise_tax_payable"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        ADD CONSTRAINT "FK_organization_settings_excise_tax_payable"
        FOREIGN KEY ("default_excise_tax_payable_id") REFERENCES "accounts"("id") ON DELETE SET NULL
    `);

    // ── Sign and exclusivity ──────────────────────────────────────────────────
    //
    // A line carries a debit or a credit. Storing a negative debit to mean a credit makes every
    // report that sums a column silently wrong, and it is the representation an import or a
    // hand-written UPDATE reaches for first.
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_lines_sign"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD CONSTRAINT "CHK_journal_entry_lines_sign" CHECK (
          "debit" >= 0
          AND "credit" >= 0
          AND NOT ("debit" > 0 AND "credit" > 0)
          AND ("debit" > 0 OR "credit" > 0)
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        VALIDATE CONSTRAINT "CHK_journal_entry_lines_sign"
    `);

    // A valuation may be zero on both sides — a mapping rule with a zero multiplier expresses "this
    // account does not exist in that book" — but never negative and never two-sided.
    await queryRunner.query(`
      ALTER TABLE "journal_entry_line_valuations"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_line_valuations_sign"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_line_valuations"
        ADD CONSTRAINT "CHK_journal_entry_line_valuations_sign" CHECK (
          "debit" >= 0 AND "credit" >= 0 AND NOT ("debit" > 0 AND "credit" > 0)
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_line_valuations"
        VALIDATE CONSTRAINT "CHK_journal_entry_line_valuations_sign"
    `);

    // The foreign-currency amounts follow the same rule as the ledger amounts they mirror.
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_lines_foreign_sign"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        ADD CONSTRAINT "CHK_journal_entry_lines_foreign_sign" CHECK (
          COALESCE("foreign_currency_debit", 0) >= 0
          AND COALESCE("foreign_currency_credit", 0) >= 0
          AND NOT (
            COALESCE("foreign_currency_debit", 0) > 0
            AND COALESCE("foreign_currency_credit", 0) > 0
          )
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        VALIDATE CONSTRAINT "CHK_journal_entry_lines_foreign_sign"
    `);

    // A rate is a positive number or it is absent. Zero converts every amount to nothing.
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entries_exchange_rate_positive"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        ADD CONSTRAINT "CHK_journal_entries_exchange_rate_positive" CHECK (
          "exchange_rate" IS NULL OR "exchange_rate" > 0
        ) NOT VALID
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        VALIDATE CONSTRAINT "CHK_journal_entries_exchange_rate_positive"
    `);

    // ── Double entry ──────────────────────────────────────────────────────────

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_assert_entry_balances"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_entry_id uuid;
        v_offender record;
      BEGIN
        -- The row that changed identifies its entry through its line. On DELETE the line may
        -- already be gone (a cascade), in which case there is nothing left to balance.
        SELECT l."journal_entry_id" INTO v_entry_id
        FROM "journal_entry_lines" l
        WHERE l."id" = COALESCE(NEW."journal_entry_line_id", OLD."journal_entry_line_id");

        IF v_entry_id IS NULL THEN
          RETURN NULL;
        END IF;

        -- The entry itself may have been deleted by a cascade from the organization; a book that
        -- no longer exists cannot fail to balance.
        IF NOT EXISTS (SELECT 1 FROM "journal_entries" WHERE "id" = v_entry_id) THEN
          RETURN NULL;
        END IF;

        SELECT v."ledger_id",
               SUM(v."debit")  AS debits,
               SUM(v."credit") AS credits
        INTO v_offender
        FROM "journal_entry_line_valuations" v
        JOIN "journal_entry_lines" l ON l."id" = v."journal_entry_line_id"
        WHERE l."journal_entry_id" = v_entry_id
        GROUP BY v."ledger_id"
        HAVING SUM(v."debit") <> SUM(v."credit")
        LIMIT 1;

        IF FOUND THEN
          RAISE EXCEPTION
            'El asiento % no balancea en el libro %: débitos %, créditos %.',
            v_entry_id, v_offender."ledger_id", v_offender.debits, v_offender.credits
            USING ERRCODE = 'check_violation',
                  HINT = 'La partida doble se verifica sobre journal_entry_line_valuations, que es la tabla de la que se derivan todos los saldos.';
        END IF;

        RETURN NULL;
      END;
      $$;
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entry_valuations_balance"
      ON "journal_entry_line_valuations"
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "trg_journal_entry_valuations_balance"
      AFTER INSERT OR UPDATE OR DELETE ON "journal_entry_line_valuations"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "virtex_assert_entry_balances"()
    `);

    // A line with no valuation contributes to no balance at all: it is in the book, it is in the
    // trial balance's line count, and it is in nobody's total. Deferred for the same reason — the
    // line is inserted before its valuations are.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_assert_line_has_valuation"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM "journal_entry_lines" WHERE "id" = NEW."id") THEN
          RETURN NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM "journal_entry_line_valuations" WHERE "journal_entry_line_id" = NEW."id"
        ) THEN
          RAISE EXCEPTION
            'La línea % no tiene valoración en ningún libro y por tanto no participa en ningún saldo.',
            NEW."id"
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NULL;
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entry_lines_have_valuation"
      ON "journal_entry_lines"
    `);
    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER "trg_journal_entry_lines_have_valuation"
      AFTER INSERT ON "journal_entry_lines"
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION "virtex_assert_line_has_valuation"()
    `);

    // ── Immutability of the posted record ─────────────────────────────────────

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_entry_update"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."status" NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN NEW;
        END IF;

        -- What a correction is allowed to do to a record that is already in the book: mark it
        -- superseded, mark it reversed, and point at what replaced it. Everything else is a new
        -- entry, which is what "corrections are made by reversal and adjustment" means.
        IF NEW."status" IS DISTINCT FROM OLD."status"
           AND NOT (OLD."status" = 'Posted' AND NEW."status" IN ('Modified', 'Void')) THEN
          RAISE EXCEPTION 'Un asiento contabilizado no puede cambiar de estado % a %.',
            OLD."status", NEW."status"
            USING ERRCODE = 'check_violation';
        END IF;

        IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
           OR NEW."ledger_id"       IS DISTINCT FROM OLD."ledger_id"
           OR NEW."journal_id"      IS DISTINCT FROM OLD."journal_id"
           OR NEW."date"            IS DISTINCT FROM OLD."date"
           OR NEW."entry_number"    IS DISTINCT FROM OLD."entry_number"
           OR NEW."currency_code"   IS DISTINCT FROM OLD."currency_code"
           OR NEW."exchange_rate"   IS DISTINCT FROM OLD."exchange_rate"
           OR NEW."entryType"       IS DISTINCT FROM OLD."entryType"
           OR NEW."posted_by_user_id" IS DISTINCT FROM OLD."posted_by_user_id"
           OR NEW."posted_at"       IS DISTINCT FROM OLD."posted_at"
           OR NEW."description"     IS DISTINCT FROM OLD."description" THEN
          RAISE EXCEPTION
            'No se puede modificar un asiento contabilizado (%). Corrija mediante reversión y un asiento nuevo.',
            COALESCE(OLD."entry_number", OLD."id"::text)
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entries_immutable" ON "journal_entries"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_journal_entries_immutable"
      BEFORE UPDATE ON "journal_entries"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_entry_update"()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_entry_delete"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."status" NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN OLD;
        END IF;
        -- Deleting the tenant is allowed: PostgreSQL removes the organization first and the
        -- cascade reaches here with it already gone. Any other delete finds it present.
        IF NOT EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
          RETURN OLD;
        END IF;
        RAISE EXCEPTION
          'No se puede eliminar un asiento contabilizado (%). Anúlelo con una reversión.',
          COALESCE(OLD."entry_number", OLD."id"::text)
          USING ERRCODE = 'check_violation';
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entries_no_delete" ON "journal_entries"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_journal_entries_no_delete"
      BEFORE DELETE ON "journal_entries"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_entry_delete"()
    `);

    // Lines of a posted entry: the reconciliation flags are bookkeeping about the line, not the
    // line's accounting content, so they may move. Nothing else may.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_line_update"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_status text;
      BEGIN
        SELECT "status" INTO v_status
        FROM "journal_entries" WHERE "id" = OLD."journal_entry_id";

        IF v_status IS NULL OR v_status NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN NEW;
        END IF;

        IF NEW."journal_entry_id" IS DISTINCT FROM OLD."journal_entry_id"
           OR NEW."account_id"    IS DISTINCT FROM OLD."account_id"
           OR NEW."debit"         IS DISTINCT FROM OLD."debit"
           OR NEW."credit"        IS DISTINCT FROM OLD."credit"
           OR NEW."currency_code" IS DISTINCT FROM OLD."currency_code"
           OR NEW."exchange_rate" IS DISTINCT FROM OLD."exchange_rate"
           OR NEW."foreign_currency_debit"  IS DISTINCT FROM OLD."foreign_currency_debit"
           OR NEW."foreign_currency_credit" IS DISTINCT FROM OLD."foreign_currency_credit"
           OR NEW."dimensions"    IS DISTINCT FROM OLD."dimensions" THEN
          RAISE EXCEPTION
            'No se puede modificar la línea % de un asiento contabilizado.', OLD."id"
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entry_lines_immutable" ON "journal_entry_lines"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_journal_entry_lines_immutable"
      BEFORE UPDATE ON "journal_entry_lines"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_line_update"()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_line_delete"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_status text;
      BEGIN
        -- During a cascade the entry is deleted first, so an absent parent means the delete is
        -- the tail of a permitted operation.
        SELECT "status" INTO v_status
        FROM "journal_entries" WHERE "id" = OLD."journal_entry_id";

        IF v_status IS NULL OR v_status NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN OLD;
        END IF;

        RAISE EXCEPTION
          'No se puede eliminar la línea % de un asiento contabilizado.', OLD."id"
          USING ERRCODE = 'check_violation';
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entry_lines_no_delete" ON "journal_entry_lines"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_journal_entry_lines_no_delete"
      BEFORE DELETE ON "journal_entry_lines"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_line_delete"()
    `);

    // Valuations of a posted entry are the balances themselves. They never change.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_valuation"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_status text;
        v_line uuid;
      BEGIN
        v_line := COALESCE(NEW."journal_entry_line_id", OLD."journal_entry_line_id");
        SELECT e."status" INTO v_status
        FROM "journal_entry_lines" l
        JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
        WHERE l."id" = v_line;

        IF v_status IS NULL OR v_status NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN COALESCE(NEW, OLD);
        END IF;

        RAISE EXCEPTION
          'No se puede alterar la valoración de la línea % en el libro % de un asiento contabilizado.',
          v_line, COALESCE(NEW."ledger_id", OLD."ledger_id")
          USING ERRCODE = 'check_violation';
      END;
      $$;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "trg_journal_entry_valuations_immutable"
      ON "journal_entry_line_valuations"
    `);
    await queryRunner.query(`
      CREATE TRIGGER "trg_journal_entry_valuations_immutable"
      BEFORE UPDATE OR DELETE ON "journal_entry_line_valuations"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_valuation"()
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [trigger, table] of [
      ['trg_journal_entry_valuations_immutable', 'journal_entry_line_valuations'],
      ['trg_journal_entry_valuations_balance', 'journal_entry_line_valuations'],
      ['trg_journal_entry_lines_no_delete', 'journal_entry_lines'],
      ['trg_journal_entry_lines_immutable', 'journal_entry_lines'],
      ['trg_journal_entry_lines_have_valuation', 'journal_entry_lines'],
      ['trg_journal_entries_no_delete', 'journal_entries'],
      ['trg_journal_entries_immutable', 'journal_entries'],
    ]) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "${trigger}" ON "${table}"`);
    }

    for (const fn of [
      'virtex_guard_posted_valuation',
      'virtex_guard_posted_line_delete',
      'virtex_guard_posted_line_update',
      'virtex_guard_posted_entry_delete',
      'virtex_guard_posted_entry_update',
      'virtex_assert_line_has_valuation',
      'virtex_assert_entry_balances',
    ]) {
      await queryRunner.query(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }

    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entries_exchange_rate_positive"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_lines"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_lines_foreign_sign",
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_lines_sign"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entry_line_valuations"
        DROP CONSTRAINT IF EXISTS "CHK_journal_entry_line_valuations_sign"
    `);

    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        DROP CONSTRAINT IF EXISTS "FK_organization_settings_excise_tax_payable"
    `);
    await queryRunner.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "fx_rate_max_age_days",
        DROP COLUMN IF EXISTS "fx_rate_tolerance",
        DROP COLUMN IF EXISTS "default_excise_tax_payable_id"
    `);
    await queryRunner.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "excise"`);
    await queryRunner.query(`
      ALTER TABLE "invoice_line_item"
        DROP COLUMN IF EXISTS "taxable_base",
        DROP COLUMN IF EXISTS "document_discount_amount"
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_journal_entries_org_idempotency_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "journal_entries"
        DROP COLUMN IF EXISTS "exchange_rate_quoted_on",
        DROP COLUMN IF EXISTS "exchange_rate_method",
        DROP COLUMN IF EXISTS "exchange_rate_source",
        DROP COLUMN IF EXISTS "exchange_rate_type",
        DROP COLUMN IF EXISTS "idempotency_key"
    `);
  }
}

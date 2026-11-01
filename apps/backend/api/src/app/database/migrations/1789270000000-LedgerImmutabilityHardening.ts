import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes the three ways a posted entry could still be altered in the database (audit 2026-10-31,
 * GL-03), each reproduced with plain SQL against the LedgerInvariants triggers:
 *
 *  1. **Lines could be ADDED to a posted entry.** The guards covered UPDATE and DELETE of lines,
 *     not INSERT, so a balanced pair inserted later changed the entry's content (and passed the
 *     deferred balance check). Once a posted entry has committed lines, a later transaction can no
 *     longer add any. The posting transaction itself (including its savepoints) still writes them.
 *  2. **Posted → Void needed no reversal.** No application path voids an entry — voiding IS
 *     reversing — so the transition is removed. Posted → Modified now requires the forward link
 *     to the replacement, which is the only way the application performs it.
 *  3. **Bookkeeping columns were free.** `idempotency_key`, `system_reason`, `reverses_entry_id`
 *     and `modified_from_entry_id` are part of what the entry IS (where it came from, what it
 *     reverses) and can no longer change once posted; `is_reversed` can only go from false to
 *     true; `modified_to_entry_id` can only be set once.
 *
 * The guard function keeps everything LedgerInvariants already enforced.
 */
export class LedgerImmutabilityHardening1789270000000 implements MigrationInterface {
  name = 'LedgerImmutabilityHardening1789270000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_entry_update"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."status" NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN NEW;
        END IF;

        IF NEW."status" IS DISTINCT FROM OLD."status" THEN
          IF NOT (OLD."status" = 'Posted' AND NEW."status" = 'Modified' AND NEW."modified_to_entry_id" IS NOT NULL) THEN
            RAISE EXCEPTION 'Un asiento contabilizado no puede cambiar de estado % a %. Se corrige con una reversión.',
              OLD."status", NEW."status"
              USING ERRCODE = 'check_violation';
          END IF;
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
           OR NEW."description"     IS DISTINCT FROM OLD."description"
           OR NEW."idempotency_key" IS DISTINCT FROM OLD."idempotency_key"
           OR NEW."system_reason"   IS DISTINCT FROM OLD."system_reason"
           OR NEW."reverses_entry_id" IS DISTINCT FROM OLD."reverses_entry_id"
           OR NEW."modified_from_entry_id" IS DISTINCT FROM OLD."modified_from_entry_id"
           OR NEW."affects_opening_balance" IS DISTINCT FROM OLD."affects_opening_balance" THEN
          RAISE EXCEPTION
            'No se puede modificar un asiento contabilizado (%). Corrija mediante reversión y un asiento nuevo.',
            COALESCE(OLD."entry_number", OLD."id"::text)
            USING ERRCODE = 'check_violation';
        END IF;

        IF OLD."is_reversed" AND NOT NEW."is_reversed" THEN
          RAISE EXCEPTION 'La reversión del asiento % no puede deshacerse.', COALESCE(OLD."entry_number", OLD."id"::text)
            USING ERRCODE = 'check_violation';
        END IF;

        IF OLD."modified_to_entry_id" IS NOT NULL
           AND NEW."modified_to_entry_id" IS DISTINCT FROM OLD."modified_to_entry_id" THEN
          RAISE EXCEPTION 'El asiento % ya fue reemplazado; el enlace no cambia.', COALESCE(OLD."entry_number", OLD."id"::text)
            USING ERRCODE = 'check_violation';
        END IF;

        RETURN NEW;
      END;
      $$;
    `);

    // Whether a row version was written by the CURRENT transaction (or one of its savepoints).
    // Under read committed the only uncommitted versions a session can see are its own, so a
    // visible version whose writer is still "in progress" is ours. xmin is 32-bit: the 64-bit id is
    // rebuilt as the one with the same low bits nearest to this transaction's own id.
    await q.query(`
      CREATE OR REPLACE FUNCTION "virtex_written_by_current_transaction"(p_xmin xid) RETURNS boolean
      LANGUAGE plpgsql STABLE AS $$
      DECLARE
        -- The current transaction's own 64-bit id (assigned: this runs inside a write).
        v_ref  bigint := pg_current_xact_id()::text::bigint;
        v_full bigint;
      BEGIN
        IF p_xmin::text::bigint < 3 THEN
          RETURN false; -- bootstrap / frozen: written long ago, never by us
        END IF;
        -- xids are circular 32-bit values: take the 64-bit id of the same low bits nearest to ours.
        v_full := (v_ref / 4294967296) * 4294967296 + p_xmin::text::bigint;
        IF v_full > v_ref + 2147483648 THEN
          v_full := v_full - 4294967296;
        ELSIF v_full < v_ref - 2147483648 THEN
          v_full := v_full + 4294967296;
        END IF;
        IF v_full < 3 THEN
          RETURN false;
        END IF;
        RETURN pg_xact_status(v_full::text::xid8) = 'in progress';
      END;
      $$;
    `);

    // A posted entry's content is the set of lines it was posted with. Adding a line from a later
    // transaction to an entry that already has committed lines is changing a posted entry, and is
    // refused. The posting transaction itself, and an entry that has no committed lines yet, are
    // not affected.
    await q.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_line_insert"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        v_status text;
        v_entry_xmin xid;
      BEGIN
        SELECT "status", xmin INTO v_status, v_entry_xmin
        FROM "journal_entries" WHERE "id" = NEW."journal_entry_id";
        IF v_status IS NULL OR v_status NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN NEW;
        END IF;
        IF "virtex_written_by_current_transaction"(v_entry_xmin) THEN
          RETURN NEW;
        END IF;
        IF EXISTS (
          SELECT 1 FROM "journal_entry_lines" l
          WHERE l."journal_entry_id" = NEW."journal_entry_id"
            AND NOT "virtex_written_by_current_transaction"(l.xmin)
        ) THEN
          RAISE EXCEPTION
            'No se pueden añadir líneas a un asiento ya contabilizado. Registre un asiento nuevo.'
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $$;
    `);
    await q.query(`DROP TRIGGER IF EXISTS "trg_journal_entry_lines_no_insert_posted" ON "journal_entry_lines"`);
    await q.query(`
      CREATE TRIGGER "trg_journal_entry_lines_no_insert_posted"
      BEFORE INSERT ON "journal_entry_lines"
      FOR EACH ROW EXECUTE FUNCTION "virtex_guard_posted_line_insert"()
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TRIGGER IF EXISTS "trg_journal_entry_lines_no_insert_posted" ON "journal_entry_lines"`);
    await q.query(`DROP FUNCTION IF EXISTS "virtex_guard_posted_line_insert"()`);
    await q.query(`DROP FUNCTION IF EXISTS "virtex_written_by_current_transaction"(xid)`);
    // Restore the LedgerInvariants version of the entry guard.
    await q.query(`
      CREATE OR REPLACE FUNCTION "virtex_guard_posted_entry_update"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD."status" NOT IN ('Posted', 'Modified', 'Void') THEN
          RETURN NEW;
        END IF;
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
  }
}

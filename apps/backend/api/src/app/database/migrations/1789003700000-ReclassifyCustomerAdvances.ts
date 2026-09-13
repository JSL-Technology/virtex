import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Moves customer advances already on the books out of the receivables control account.
 *
 * Until the previous migration there was no account to hold them in, so every collection received
 * against no invoice was credited to accounts receivable as a contra. The effect on a real set of
 * books is not cosmetic: the control account goes below zero the moment a customer pays ahead — a
 * negative asset on the balance sheet where there is an obligation — and the receivables ageing
 * report, which ties the subledger to that account, reports a difference of exactly the amount held
 * in advance and cannot be reconciled by anyone.
 *
 * ## Why a new entry and not an edit
 *
 * The first version of this migration rewrote `account_id` on the offending lines. The database
 * refused it, and it was right to: `virtex_guard_posted_entry_update` enforces the rule the whole
 * ledger is built on — *a posted record is not edited; it is corrected by a further entry*. So this
 * posts a reclassification, dated today, in the tenant's collections journal: debit receivables,
 * credit customer advances, for the net amount still misfiled. The correction is legible in the
 * book, which is the entire point of the rule.
 *
 * Deliberately narrow: only credits written by the collections journal, described as an advance and
 * still sitting on the tenant's own receivable account, are counted — net of any reversal that
 * already took them back off. A manual entry that happens to share the description is not touched,
 * and a tenant that never recorded an advance gets no entry at all.
 */
export class ReclassifyCustomerAdvances1789003700000 implements MigrationInterface {
  name = 'ReclassifyCustomerAdvances1789003700000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$
      DECLARE
        org RECORD;
        v_entry_id uuid;
        v_number integer;
        v_entry_number varchar(40);
        v_line_id uuid;
        v_year integer := EXTRACT(YEAR FROM CURRENT_DATE)::int;
        v_touched boolean := false;
      BEGIN
        FOR org IN
          SELECT e."organization_id"          AS organization_id,
                 e."journal_id"               AS journal_id,
                 e."ledger_id"                AS ledger_id,
                 l."account_id"               AS receivable_account_id,
                 adv."id"                     AS advance_account_id,
                 j."code"                     AS journal_code,
                 SUM(l."credit" - l."debit")  AS net
            FROM "journal_entry_lines" l
            JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
            JOIN "journals" j        ON j."id" = e."journal_id"
            JOIN "accounts" a        ON a."id" = l."account_id"
            JOIN "accounts" adv      ON adv."organization_id" = e."organization_id"
                                    AND adv."system_role" = 'CUSTOMER_ADVANCES'
           WHERE j."code" = 'COBROS'
             AND l."description" = 'Anticipo de cliente'
             AND a."system_role" = 'ACCOUNTS_RECEIVABLE'
             AND e."status" IN ('Posted', 'Modified')
           GROUP BY e."organization_id", e."journal_id", e."ledger_id",
                    l."account_id", adv."id", j."code"
          HAVING SUM(l."credit" - l."debit") > 0
        LOOP
          INSERT INTO "journal_entry_sequences"
            ("organization_id", "journal_id", "year", "last_number")
          VALUES (org.organization_id, org.journal_id, v_year, 1)
          ON CONFLICT ("organization_id", "journal_id", "year")
          DO UPDATE SET "last_number" = "journal_entry_sequences"."last_number" + 1
          RETURNING "last_number" INTO v_number;

          v_entry_number := org.journal_code || '-' || v_year || '-' || LPAD(v_number::text, 6, '0');

          INSERT INTO "journal_entries"
            ("organization_id", "ledger_id", "journal_id", "date", "description",
             "status", "entryType", "entry_number", "posted_at")
          VALUES (
            org.organization_id, org.ledger_id, org.journal_id, CURRENT_DATE,
            'Reclasificación de anticipos de clientes a cuenta de pasivo',
            'Posted', 'SYSTEM_GENERATED', v_entry_number, now()
          )
          RETURNING "id" INTO v_entry_id;

          INSERT INTO "journal_entry_lines"
            ("journal_entry_id", "account_id", "debit", "credit", "description")
          VALUES (v_entry_id, org.receivable_account_id, org.net, 0,
                  'Anticipos retirados de la cuenta de control por cobrar')
          RETURNING "id" INTO v_line_id;
          INSERT INTO "journal_entry_line_valuations"
            ("journal_entry_line_id", "ledger_id", "debit", "credit")
          VALUES (v_line_id, org.ledger_id, org.net, 0);

          INSERT INTO "journal_entry_lines"
            ("journal_entry_id", "account_id", "debit", "credit", "description")
          VALUES (v_entry_id, org.advance_account_id, 0, org.net,
                  'Anticipos de clientes reconocidos como pasivo')
          RETURNING "id" INTO v_line_id;
          INSERT INTO "journal_entry_line_valuations"
            ("journal_entry_line_id", "ledger_id", "debit", "credit")
          VALUES (v_line_id, org.ledger_id, 0, org.net);

          v_touched := true;
        END LOOP;

        IF v_touched THEN
          -- Every balance read downstream is derived from these lines, and one of them is
          -- materialised.
          REFRESH MATERIALIZED VIEW "analytical_report_data";
        END IF;
      END $$;
    `);
  }

  /**
   * Intentionally not reversible.
   *
   * Undoing it would mean deliberately re-filing a liability as a negative asset, and the entry it
   * posts is a posted entry like any other: it is reversed through the application, with a reason,
   * not silently deleted by a downgrade.
   */
  public async down(): Promise<void> {
    // no-op
  }
}

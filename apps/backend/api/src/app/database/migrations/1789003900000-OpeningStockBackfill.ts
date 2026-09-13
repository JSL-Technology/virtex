import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puts the stock tenants already hold onto the balance sheet.
 *
 * A product could be created holding 50 units at 400 each with **no entry in the books at all**:
 * 20,000 of real asset in the warehouse, nothing on the balance sheet. The first invoice that sold
 * one of those units then credited the inventory account for its cost, so `Inventarios` went
 * *negative* — an asset reported below zero — and the balance sheet the tenant showed their bank was
 * wrong by the whole value of what they held.
 *
 * ## What it recognises, and what it deliberately does not
 *
 * Not `SUM(stock × cost)`: goods bought through a vendor bill are already in the inventory account,
 * and posting the catalogue's total again would double them. What is missing is the *difference*
 * between what the catalogue says is held and what the ledger says is held — which is exactly the
 * stock that was entered by hand and never recognised. One entry per tenant, dated today, debiting
 * inventory and crediting opening balance equity: goods carried in from before the books are not a
 * result this company earned.
 *
 * The other direction — the ledger holding more than the catalogue — is left alone. That is a
 * purchase whose goods were never catalogued, or a cost that has since changed, and writing it off
 * to equity would destroy information a stock count is meant to settle. It is reported by the
 * reconciliation, not silently absorbed.
 */
export class OpeningStockBackfill1789003900000 implements MigrationInterface {
  name = 'OpeningStockBackfill1789003900000';

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
          SELECT o."id"                AS organization_id,
                 j."id"                AS journal_id,
                 j."code"              AS journal_code,
                 led."id"              AS ledger_id,
                 inv."id"              AS inventory_account_id,
                 eq."id"               AS opening_account_id,
                 ROUND(catalogue.value - COALESCE(book.value, 0), 2) AS delta
            FROM "organizations" o
            JOIN "journals" j   ON j."organization_id" = o."id" AND j."code" = 'GENERAL'
            JOIN "ledgers" led  ON led."organization_id" = o."id" AND led."is_default" = true
            JOIN "accounts" inv ON inv."organization_id" = o."id" AND inv."system_role" = 'INVENTORY'
            JOIN "accounts" eq  ON eq."organization_id" = o."id"
                               AND eq."system_role" = 'OPENING_BALANCE_EQUITY'
            JOIN LATERAL (
              SELECT COALESCE(SUM(p."stock" * p."cost"), 0) AS value
                FROM "products" p
               WHERE p."organization_id" = o."id"
                 AND p."kind" = 'GOOD'
            ) catalogue ON true
            LEFT JOIN LATERAL (
              SELECT COALESCE(SUM(l."debit" - l."credit"), 0) AS value
                FROM "journal_entry_lines" l
                JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
               WHERE l."account_id" = inv."id"
                 AND e."status" IN ('Posted', 'Modified')
            ) book ON true
           WHERE ROUND(catalogue.value - COALESCE(book.value, 0), 2) > 0
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
             "status", "entryType", "affects_opening_balance", "entry_number", "posted_at")
          VALUES (
            org.organization_id, org.ledger_id, org.journal_id, CURRENT_DATE,
            'Reconocimiento de inventario inicial no contabilizado',
            'Posted', 'OPENING_BALANCE', true, v_entry_number, now()
          )
          RETURNING "id" INTO v_entry_id;

          INSERT INTO "journal_entry_lines"
            ("journal_entry_id", "account_id", "debit", "credit", "description")
          VALUES (v_entry_id, org.inventory_account_id, org.delta, 0,
                  'Existencias registradas en el catálogo sin asiento')
          RETURNING "id" INTO v_line_id;
          INSERT INTO "journal_entry_line_valuations"
            ("journal_entry_line_id", "ledger_id", "debit", "credit")
          VALUES (v_line_id, org.ledger_id, org.delta, 0);

          INSERT INTO "journal_entry_lines"
            ("journal_entry_id", "account_id", "debit", "credit", "description")
          VALUES (v_entry_id, org.opening_account_id, 0, org.delta,
                  'Contrapartida de saldos iniciales')
          RETURNING "id" INTO v_line_id;
          INSERT INTO "journal_entry_line_valuations"
            ("journal_entry_line_id", "ledger_id", "debit", "credit")
          VALUES (v_line_id, org.ledger_id, 0, org.delta);

          v_touched := true;
        END LOOP;

        IF v_touched THEN
          REFRESH MATERIALIZED VIEW "analytical_report_data";
        END IF;
      END $$;
    `);
  }

  /** Not reversible: the entry it posts is a posted entry, reversed through the application. */
  public async down(): Promise<void> {
    // no-op
  }
}

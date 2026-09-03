import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A tenant with accounting could not be deleted.
 *
 * `DELETE FROM organizations WHERE id = …` fails outright on any tenant that ever posted an entry:
 *
 *     update or delete on table "accounts" violates foreign key constraint
 *     "FK_4a4fcd732e7b109880444ebc9c1" on table "journal_entry_lines"
 *
 * The organization → accounts edge cascades, but accounts → journal_entry_lines was left at
 * `NO ACTION`, so Postgres removes the accounts and is then blocked by their own lines. The same
 * shape repeats across the finance schema: journals, ledgers, suppliers, vendor bills, taxes, and
 * the self-references between journal entries.
 *
 * The consequence is not academic. Offboarding a customer, honouring a deletion request under
 * Brazil's LGPD or a state privacy statute in the United States, or cleaning a trial tenant, all
 * end in a foreign-key error with the tenant's data still in place. On this database 103 test
 * tenants had accumulated for exactly that reason.
 *
 * ## What this changes, and what it does not
 *
 * References **within** a tenant become `ON DELETE CASCADE`: the child row has no meaning once its
 * parent is gone, and the only legitimate way a parent disappears is with the tenant — deleting an
 * account that carries movements is refused by the service, which is where that rule belongs.
 * References to a **user** become `ON DELETE SET NULL`: who uploaded an attachment or proposed an
 * adjustment is history, and losing the name must not take the record with it. The self-references
 * between journal entries become `SET NULL` for the same reason — deleting a reversed entry must
 * not delete the reversal that documents it.
 *
 * Tables outside finance — CRM (activities, cases, opportunities, quotes, leads), inventory
 * (stock_items, stock_movements, bin_locations, locations), projects and datasheets — carry the
 * identical defect against customers, products, warehouses, projects and roles. They are left
 * alone here deliberately: they are not this change's subject, and repointing another module's
 * constraints from a finance migration is how a schema stops being reviewable.
 */
export class TenantDeletionFinance1788700600000 implements MigrationInterface {
  name = 'TenantDeletionFinance1788700600000';

  /** `[constraint, table, column, referenced table, referenced column, action]` */
  private static readonly EDGES: [string, string, string, string, string, string][] = [
    // Within the tenant: the child cannot outlive its parent.
    ['FK_4a4fcd732e7b109880444ebc9c1', 'journal_entry_lines', 'account_id', 'accounts', 'id', 'CASCADE'],
    ['FK_ab9e9f1ceb877c6455bd62969ee', 'budget_lines', 'account_id', 'accounts', 'id', 'CASCADE'],
    ['FK_b55f441282402f098062402a17f', 'account_hierarchy_versions', 'accountId', 'accounts', 'id', 'CASCADE'],
    ['FK_2b4f095a070c9eb5f6174485962', 'journal_entries', 'journal_id', 'journals', 'id', 'CASCADE'],
    ['FK_b382dd4185200e8d424cd6aabff', 'proposed_audit_adjustments', 'journal_id', 'journals', 'id', 'CASCADE'],
    ['FK_867d421cb5d172210679eedd7f9', 'journal_entries', 'ledger_id', 'ledgers', 'id', 'CASCADE'],
    ['FK_6f4bf16a8536ae1bdf7f8ad6ed4', 'vendor_bills', 'vendor_id', 'suppliers', 'id', 'CASCADE'],
    ['FK_aad7be57add6ed97d51a3db11a5', 'vendor_bill_line', 'vendorBillId', 'vendor_bills', 'id', 'CASCADE'],
    ['FK_cb5c068565882be1c0582dd09d6', 'tax_rules', 'tax_id', 'taxes', 'id', 'CASCADE'],

    // History that must survive the loss of its subject.
    ['FK_7949bc8795e39bd522296be195d', 'journal_entries', 'reverses_entry_id', 'journal_entries', 'id', 'SET NULL'],
    ['FK_1eb73d78874109e4cb656ffe0a6', 'journal_entries', 'modified_to_entry_id', 'journal_entries', 'id', 'SET NULL'],
    ['FK_4b318306bb3dc240b0cb6dff9db', 'journal_entries', 'modified_from_entry_id', 'journal_entries', 'id', 'SET NULL'],
    ['FK_8ca73e455303f334339117caa5d', 'journal_entry_attachments', 'uploaded_by_user_id', 'users', 'id', 'SET NULL'],
    ['FK_8ef439a3d648851a069413095a9', 'account_history', 'changed_by_user_id', 'users', 'id', 'SET NULL'],
    ['FK_42ec7b300d1f966246d39101c97', 'proposed_audit_adjustments', 'proposer_id', 'users', 'id', 'SET NULL'],
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table, column, target, targetColumn, action] of
      TenantDeletionFinance1788700600000.EDGES) {
      // A `SET NULL` edge needs a nullable column; the ones listed above already are, but the
      // statement is idempotent and states the requirement rather than assuming it.
      if (action === 'SET NULL') {
        await queryRunner.query(`
          DO $$ BEGIN
            ALTER TABLE "${table}" ALTER COLUMN "${column}" DROP NOT NULL;
          EXCEPTION WHEN others THEN NULL; END $$;
        `);
      }
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}";
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
            FOREIGN KEY ("${column}") REFERENCES "${target}"("${targetColumn}")
            ON DELETE ${action};
        EXCEPTION WHEN undefined_table THEN NULL; END $$;
      `);
    }

    // ── account_history carried every relation twice ──────────────────────────
    //
    // `accountId` and `changedByUserId` held the values as NOT NULL camelCase columns; `account_id`
    // and `changed_by_user_id` were the nullable columns the foreign keys pointed at, and nothing
    // ever wrote to them. The constraints enforced nothing at all — a history row could name a
    // deleted account or a user who never existed.
    await queryRunner.query(`
      DO $$ BEGIN
        UPDATE "account_history"
        SET "account_id" = "accountId",
            "changed_by_user_id" = "changedByUserId"
        WHERE "account_id" IS NULL;
      EXCEPTION WHEN undefined_column THEN NULL; END $$;
    `);
    await queryRunner.query(`
      DELETE FROM "account_history" h
      WHERE h."account_id" IS NULL
         OR NOT EXISTS (SELECT 1 FROM "accounts" a WHERE a."id" = h."account_id")
    `);
    await queryRunner.query(`
      UPDATE "account_history" h SET "changed_by_user_id" = NULL
      WHERE "changed_by_user_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = h."changed_by_user_id")
    `);
    await queryRunner.query(`
      ALTER TABLE "account_history"
        DROP COLUMN IF EXISTS "accountId",
        DROP COLUMN IF EXISTS "changedByUserId",
        ALTER COLUMN "account_id" SET NOT NULL
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_53b71bce9f969633f6b2a8cef2"`);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_account_history_account"
      ON "account_history" ("account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table, column, target, targetColumn] of
      TenantDeletionFinance1788700600000.EDGES) {
      await queryRunner.query(`
        DO $$ BEGIN
          ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}";
          ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
            FOREIGN KEY ("${column}") REFERENCES "${target}"("${targetColumn}");
        EXCEPTION WHEN undefined_table THEN NULL; END $$;
      `);
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Annulling a supplier bill left the ledger holding the debt, and intercompany was a dead table.
 *
 * ## Voiding a bill kept nothing
 *
 * `vendor_bills` had no column naming the journal entry that put the bill in the books, so
 * `voidBill` could not reverse it even in principle: it marked the document VOID, zeroed the
 * balance and emitted an event with no listener. The payable and the expense stayed in the general
 * ledger permanently while the subledger reported the bill annulled — two sets of books, no report
 * that compared them. It also recorded no reason, no time and no author for the annulment, which
 * is the one accounting act that most needs all three.
 *
 * ## Intercompany was storable but not usable
 *
 * `intercompany_transactions` has existed since the baseline schema and holds
 * `from_organization_id`, `to_organization_id` and `source_journal_entry_id` as
 * `character varying` — no uuid type, no foreign key. A tenant could be deleted while transactions
 * referencing it remained, and a join between the column and `organizations.id` is a type error
 * PostgreSQL refuses outright. The module was never registered in `AppModule`, so nothing had
 * exercised any of it.
 *
 * Both columns become `uuid` with a real foreign key. The conversion is safe: the values written
 * were organization ids in uuid form all along, and the module could not be reached, so on any
 * deployed database the table is empty. Rows that are somehow not valid uuids are removed rather
 * than failing the migration — there is no correct value to convert them to, and the alternative
 * is a deploy that stops.
 */
export class PayableVoidAndIntercompany1788800000000 implements MigrationInterface {
  name = 'PayableVoidAndIntercompany1788800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── Voiding a supplier bill ──────────────────────────────────────────────
    await queryRunner.query(`
      ALTER TABLE "vendor_bills"
        ADD COLUMN IF NOT EXISTS "journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "reversal_journal_entry_id" uuid,
        ADD COLUMN IF NOT EXISTS "void_reason" text,
        ADD COLUMN IF NOT EXISTS "voided_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "voided_by_user_id" uuid
    `);

    // `SET NULL` rather than `CASCADE`: deleting a journal entry must never delete the commercial
    // document that produced it. Entries are not deletable through the product at all — they are
    // reversed — so this only fires when a tenant is removed wholesale.
    await queryRunner.query(`
      ALTER TABLE "vendor_bills"
        DROP CONSTRAINT IF EXISTS "FK_vendor_bills_journal_entry",
        ADD CONSTRAINT "FK_vendor_bills_journal_entry"
          FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "vendor_bills"
        DROP CONSTRAINT IF EXISTS "FK_vendor_bills_reversal_entry",
        ADD CONSTRAINT "FK_vendor_bills_reversal_entry"
          FOREIGN KEY ("reversal_journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL
    `);
    // `voided_by_user_id` deliberately carries no foreign key, matching
    // `journal_entries.posted_by_user_id`, `customer_payments.created_by_user_id` and every other
    // actor column in finance. Those columns should probably all reference `users` with
    // `ON DELETE SET NULL`, and retrofitting them is a worthwhile change — but it is a different
    // change, touching a dozen tables across four modules, and doing it from a payables migration
    // is how a schema stops being reviewable. One column constrained and eleven not is worse than
    // either, because it reads as a decision when it is an accident.

    // ── Intercompany ─────────────────────────────────────────────────────────
    await queryRunner.query(`
      DELETE FROM "intercompany_transactions"
      WHERE "from_organization_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         OR "to_organization_id"   !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);
    await queryRunner.query(`
      DELETE FROM "intercompany_transactions" t
      WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = t."from_organization_id"::uuid)
         OR NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = t."to_organization_id"::uuid)
    `);

    await queryRunner.query(`
      ALTER TABLE "intercompany_transactions"
        ALTER COLUMN "from_organization_id" TYPE uuid USING "from_organization_id"::uuid,
        ALTER COLUMN "to_organization_id"   TYPE uuid USING "to_organization_id"::uuid
    `);

    await queryRunner.query(`
      UPDATE "intercompany_transactions" t SET "source_journal_entry_id" = NULL
      WHERE "source_journal_entry_id" IS NOT NULL
        AND "source_journal_entry_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    `);
    await queryRunner.query(`
      ALTER TABLE "intercompany_transactions"
        ALTER COLUMN "source_journal_entry_id" DROP NOT NULL,
        ALTER COLUMN "source_journal_entry_id" TYPE uuid USING "source_journal_entry_id"::uuid,
        ALTER COLUMN "destination_journal_entry_id" TYPE uuid USING "destination_journal_entry_id"::uuid
    `);

    await queryRunner.query(`
      ALTER TABLE "intercompany_transactions"
        ADD COLUMN IF NOT EXISTS "currency_code" character varying(3),
        ADD COLUMN IF NOT EXISTS "exchange_rate" numeric(18,6),
        ADD COLUMN IF NOT EXISTS "destination_amount" numeric(18,2),
        ADD COLUMN IF NOT EXISTS "from_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "to_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "created_by_user_id" uuid,
        ADD COLUMN IF NOT EXISTS "failure_reason" text,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);
    await queryRunner.query(
      `UPDATE "intercompany_transactions" SET "currency_code" = COALESCE("currency_code", "currency")`,
    );

    for (const [name, column] of [
      ['FK_intercompany_from_org', 'from_organization_id'],
      ['FK_intercompany_to_org', 'to_organization_id'],
    ] as const) {
      await queryRunner.query(`
        ALTER TABLE "intercompany_transactions"
          DROP CONSTRAINT IF EXISTS "${name}",
          ADD CONSTRAINT "${name}"
            FOREIGN KEY ("${column}") REFERENCES "organizations"("id") ON DELETE CASCADE
      `);
    }

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_intercompany_from_org_status"
      ON "intercompany_transactions" ("from_organization_id", "status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_intercompany_to_org_status"
      ON "intercompany_transactions" ("to_organization_id", "status")
    `);

    // ── The group an intercompany transaction is allowed to cross ────────────
    //
    // `POST /intercompany/transactions` took `toOrganizationId` from the request body and validated
    // nothing about it, so any authenticated user could name any tenant's uuid and have an entry
    // posted into that tenant's books. Membership of a group is what makes the operation legitimate
    // and it has to be a stored fact, not an assertion in a request.
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_group_members" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "parent_organization_id" uuid NOT NULL,
        "member_organization_id" uuid NOT NULL,
        "ownership_percentage" numeric(7,4) NOT NULL DEFAULT 100,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_group_members" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_organization_group_members" UNIQUE ("parent_organization_id", "member_organization_id"),
        CONSTRAINT "CK_organization_group_members_ownership"
          CHECK ("ownership_percentage" > 0 AND "ownership_percentage" <= 100),
        CONSTRAINT "CK_organization_group_members_distinct"
          CHECK ("parent_organization_id" <> "member_organization_id"),
        CONSTRAINT "FK_organization_group_members_parent"
          FOREIGN KEY ("parent_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_organization_group_members_member"
          FOREIGN KEY ("member_organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_organization_group_members_member"
      ON "organization_group_members" ("member_organization_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_group_members"`);

    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_intercompany_to_org_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_intercompany_from_org_status"`);
    await queryRunner.query(`
      ALTER TABLE "intercompany_transactions"
        DROP CONSTRAINT IF EXISTS "FK_intercompany_to_org",
        DROP CONSTRAINT IF EXISTS "FK_intercompany_from_org",
        DROP COLUMN IF EXISTS "currency_code",
        DROP COLUMN IF EXISTS "exchange_rate",
        DROP COLUMN IF EXISTS "destination_amount",
        DROP COLUMN IF EXISTS "from_account_id",
        DROP COLUMN IF EXISTS "to_account_id",
        DROP COLUMN IF EXISTS "created_by_user_id",
        DROP COLUMN IF EXISTS "failure_reason",
        DROP COLUMN IF EXISTS "created_at"
    `);
    await queryRunner.query(`
      ALTER TABLE "intercompany_transactions"
        ALTER COLUMN "from_organization_id" TYPE character varying USING "from_organization_id"::text,
        ALTER COLUMN "to_organization_id"   TYPE character varying USING "to_organization_id"::text,
        ALTER COLUMN "source_journal_entry_id" TYPE character varying USING "source_journal_entry_id"::text,
        ALTER COLUMN "destination_journal_entry_id" TYPE character varying USING "destination_journal_entry_id"::text
    `);

    await queryRunner.query(`
      ALTER TABLE "vendor_bills"
        DROP CONSTRAINT IF EXISTS "FK_vendor_bills_reversal_entry",
        DROP CONSTRAINT IF EXISTS "FK_vendor_bills_journal_entry",
        DROP COLUMN IF EXISTS "voided_by_user_id",
        DROP COLUMN IF EXISTS "voided_at",
        DROP COLUMN IF EXISTS "void_reason",
        DROP COLUMN IF EXISTS "reversal_journal_entry_id",
        DROP COLUMN IF EXISTS "journal_entry_id"
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The previewed import batch moves out of process memory and into the database.
 *
 * ## The defect
 *
 * `JournalEntryImportService` held pending batches in `const importBatchCache = new Map<...>()` at
 * module scope. That is a single process's heap, and the product is sold as a hosted service:
 *
 * - With more than one instance behind a load balancer — which is every real deployment — the
 *   preview lands on one pod and the confirm on another, which has never heard of the batch and
 *   answers "expired or already processed". The import simply does not work.
 * - A restart or a deploy loses every batch a user is currently looking at.
 * - Nothing was evicted on confirm, and the expiry sweep only ran when someone previewed *another*
 *   file, so the parsed entries of every import ever performed stayed resident.
 *
 * The table gives the batch an owner, a tenant, an expiry the confirm path enforces, and a status
 * that is claimed inside the posting transaction — so two confirms racing on one batch cannot both
 * post it.
 */
export class JournalEntryImportBatches1788920100000 implements MigrationInterface {
  name = 'JournalEntryImportBatches1788920100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "journal_entry_import_batches" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "organization_id" uuid NOT NULL,
        "created_by_user_id" uuid NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'PENDING',
        "entries" jsonb NOT NULL,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_journal_entry_import_batches" PRIMARY KEY ("id")
      )
    `);

    // CASCADE: a batch is a disposable draft, and it must never be the reason a tenant cannot be
    // deleted. `TenantDeletionRemainder` exists because twelve other constraints were.
    await queryRunner.query(
      `ALTER TABLE "journal_entry_import_batches"
         DROP CONSTRAINT IF EXISTS "FK_journal_entry_import_batches_organization"`,
    );
    await queryRunner.query(
      `ALTER TABLE "journal_entry_import_batches"
         ADD CONSTRAINT "FK_journal_entry_import_batches_organization"
         FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_journal_entry_import_batches_org"
         ON "journal_entry_import_batches" ("organization_id")`,
    );
    // The sweeper deletes by expiry on every preview; without this it is a sequential scan.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_journal_entry_import_batches_expiry"
         ON "journal_entry_import_batches" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "journal_entry_import_batches"`);
  }
}

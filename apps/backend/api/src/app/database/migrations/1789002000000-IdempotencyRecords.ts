import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The table that makes a retry safe.
 *
 * Issuing an invoice posts a journal entry, consumes a fiscal sequence and moves stock; voiding one
 * reverses all three. None of that survives being run twice, and being run twice is ordinary: a
 * double click, a proxy retry, a connection dropped after the server committed but before the
 * response arrived. The client cannot distinguish those from a real failure, so it retries — and
 * without this table the ledger gets two entries for one sale.
 *
 * The unique index is the mechanism, not an optimisation. Two concurrent requests carrying the same
 * key race to insert; one wins and executes, the other is refused. Deciding it in application code
 * would leave the read-then-write window open, and that window is exactly where a double click
 * lands.
 *
 * `ON DELETE CASCADE` to `organizations`: these rows are a fact about one tenant's traffic.
 */
export class IdempotencyRecords1789002000000 implements MigrationInterface {
  name = 'IdempotencyRecords1789002000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "idempotency_records" (
        "id"              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "key"             character varying(255) NOT NULL,
        "endpoint"        character varying(255) NOT NULL,
        "request_hash"    char(64) NOT NULL,
        "status"          character varying(16) NOT NULL DEFAULT 'in_progress',
        "response_status" integer,
        "response_body"   jsonb,
        "created_at"      timestamptz NOT NULL DEFAULT now(),
        "completed_at"    timestamptz,
        CONSTRAINT "FK_idempotency_organization"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_idempotency_org_key"
        ON "idempotency_records" ("organization_id", "key")
    `);

    // Retention: a key is only useful while a client might still retry with it. The index supports
    // the sweep that removes old rows without scanning the table.
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_idempotency_created_at"
        ON "idempotency_records" ("created_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_idempotency_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_idempotency_org_key"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_records"`);
  }
}

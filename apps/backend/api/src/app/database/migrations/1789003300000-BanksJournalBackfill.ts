import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give every existing tenant the `BANCOS` journal.
 *
 * `TreasuryService` looks this journal up by code twice — the opening entry of a bank account and
 * a transfer between accounts — and `TenantBookkeepingProvisioner` never created it, so both paths
 * answered `The Banks journal (BANCOS) was not found` for every tenant in existence. New tenants
 * get it from the provisioner now; this is for the ones already created.
 *
 * Idempotent by the same `NOT EXISTS` shape the earlier journal backfill uses, so re-running it is
 * a no-op and a tenant that somehow already has the journal keeps the one it has.
 */
export class BanksJournalBackfill1789003300000 implements MigrationInterface {
  name = 'BanksJournalBackfill1789003300000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      INSERT INTO "journals" ("organization_id", "code", "name", "type")
      SELECT o."id", 'BANCOS', 'Diario de Bancos', 'BANK' FROM "organizations" o
      WHERE NOT EXISTS (
        SELECT 1 FROM "journals" j WHERE j."organization_id" = o."id" AND j."code" = 'BANCOS'
      )
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    // Only the rows this migration could have written: a journal with entries against it is left
    // alone, because deleting it would orphan them.
    await q.query(`
      DELETE FROM "journals" j
      WHERE j."code" = 'BANCOS'
        AND NOT EXISTS (
          SELECT 1 FROM "journal_entries" e WHERE e."journal_id" = j."id"
        )
    `);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give every existing tenant the DEPREC, CIERRE and CONCIL journals (QA C-06).
 *
 * Three services look these journals up by code — the monthly depreciation that every period
 * close runs, the year-end result transfer, and reconciliation rules that post an adjustment — and
 * `TenantBookkeepingProvisioner` never created them. The first one is on the critical path of
 * closing ANY period: `POST /accounting/close-period` answered 500
 * (`fixed_assets.depreciation_journal_deprec_not_found_create`) for every company the product had
 * created. New tenants get them from the provisioner now; this is for the ones already created.
 *
 * Named in each tenant's books language, like the provisioner does. Idempotent by `NOT EXISTS`, the
 * shape `BanksJournalBackfill` uses, so a tenant that already created one keeps its own.
 */
const JOURNALS: ReadonlyArray<{ code: string; type: string; names: Record<'es' | 'en' | 'pt', string> }> = [
  {
    code: 'DEPREC',
    type: 'GENERAL',
    names: { es: 'Diario de Depreciación', en: 'Depreciation Journal', pt: 'Diário de Depreciação' },
  },
  {
    code: 'CIERRE',
    type: 'GENERAL',
    names: { es: 'Diario de Cierre', en: 'Closing Journal', pt: 'Diário de Encerramento' },
  },
  {
    code: 'CONCIL',
    type: 'BANK',
    names: { es: 'Diario de Conciliación', en: 'Reconciliation Journal', pt: 'Diário de Conciliação' },
  },
];

export class SystemJournalsBackfill1789007800000 implements MigrationInterface {
  name = 'SystemJournalsBackfill1789007800000';

  public async up(q: QueryRunner): Promise<void> {
    for (const journal of JOURNALS) {
      await q.query(
        `
        INSERT INTO "journals" ("organization_id", "code", "name", "type")
        SELECT o."id", $1::varchar,
               CASE LEFT(COALESCE(o."books_language", 'es'), 2)
                 WHEN 'en' THEN $3::varchar
                 WHEN 'pt' THEN $4::varchar
                 ELSE $2::varchar
               END,
               $5::varchar
          FROM "organizations" o
         WHERE NOT EXISTS (
           SELECT 1 FROM "journals" j WHERE j."organization_id" = o."id" AND j."code" = $1::varchar
         )
        `,
        [journal.code, journal.names.es, journal.names.en, journal.names.pt, journal.type],
      );
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    // Only journals nothing was posted to: one with entries is left alone, deleting it would
    // orphan them.
    await q.query(
      `
      DELETE FROM "journals" j
       WHERE j."code" = ANY($1::varchar[])
         AND NOT EXISTS (SELECT 1 FROM "journal_entries" e WHERE e."journal_id" = j."id")
      `,
      [JOURNALS.map((journal) => journal.code)],
    );
  }
}

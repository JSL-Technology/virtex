import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Give every existing company the ACT-FIJOS and AJU-INF journals (FINB-10).
 *
 * Disposing of a fixed asset posts to ACT-FIJOS and the inflation adjustment to AJU-INF, and no
 * provisioning created either: `POST /fixed-assets/:id/dispose` answered
 * `fixed_assets.fixed_assets_journal_act_fijos_not` on every company the product had made. It is the
 * fifth time a service named a journal nobody provisioned (BANCOS, then DEPREC, CIERRE, CONCIL), so
 * the codes now live in one catalogue (`contracts/ledger-posting/system-journals.ts`) that the
 * provisioner reads and every lookup is typed by. New companies get these from the provisioner; this
 * is for the ones already created.
 *
 * Named in each company's books language, like the provisioner does, and idempotent by
 * `NOT EXISTS`, the shape `SystemJournalsBackfill` uses: a company that already created one keeps it.
 */
const JOURNALS: ReadonlyArray<{ code: string; type: string; names: Record<'es' | 'en' | 'pt', string> }> = [
  {
    code: 'ACT-FIJOS',
    type: 'GENERAL',
    names: { es: 'Diario de activos fijos', en: 'Fixed assets journal', pt: 'Diário de ativo imobilizado' },
  },
  {
    code: 'AJU-INF',
    type: 'GENERAL',
    names: { es: 'Diario de ajuste por inflación', en: 'Inflation adjustment journal', pt: 'Diário de correção monetária' },
  },
];

export class FixedAssetAndInflationJournals1789720000000 implements MigrationInterface {
  name = 'FixedAssetAndInflationJournals1789720000000';

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

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives back the 2 % exchange-rate tolerance the schema always promised (audit 2026-11-07, XF-09).
 *
 * `fx_rate_tolerance` is `numeric(9,6) NOT NULL DEFAULT 0.02`, but the entity's transformer turned
 * the unset value into an explicit 0, so every settings row was created at 0 and every stated rate
 * that was not identical to the stored quote was refused.
 *
 * Only rows that nobody chose to set to 0 are restored: a tenant that saved 0 on purpose, from the
 * exchange-rate settings section, has an UPDATE in the audit trail that wrote the field, and keeps it.
 */
export class RestoreFxRateTolerance1789430000000 implements MigrationInterface {
  name = 'RestoreFxRateTolerance1789430000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "organization_settings" s
         SET "fx_rate_tolerance" = 0.02
       WHERE s."fx_rate_tolerance" = 0
         AND NOT EXISTS (
               SELECT 1
                 FROM "audit_logs" a
                WHERE a."entity" = 'organization_settings'
                  AND a."entity_id" = s."id"::text
                  AND a."actionType"::text <> 'CREATE'
                  AND a."new_value" ? 'fxRateTolerance'
             )
    `);
  }

  public async down(): Promise<void> {
    // Not reversible on purpose: a 0 written by the defect is not a value anyone chose.
  }
}

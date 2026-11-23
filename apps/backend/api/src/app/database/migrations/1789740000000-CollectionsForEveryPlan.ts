import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Collections on every plan, reminders on a schedule, and reminders only to the customer (TES-13,
 * TES-21).
 *
 * 1. **The permissions are collections', not AI's.** `ai_collections:view` and `ai_collections:act`
 *    become `collections:view` and `collections:act` in every role that holds them — custom roles
 *    included, since the person who made one granted collections, whatever it was called — and in
 *    the permissions a written report requires (`ai_reports.required_permissions`), so a reader who
 *    could open one yesterday still can. The plan feature `ai_collections` keeps its name: it is the
 *    assistant writing the note, which is AI.
 *
 * 2. **The company's reminder schedule** on its settings row: whether reminders go out on their own
 *    (off until the company says so) and on which days from the due date. The CHECK bounds the days
 *    as `reminder-schedule.contract.ts` does.
 *
 * 3. **One reminder per step.** `collection_activities.schedule_step` records the step a scheduled
 *    reminder went out for; a unique index on (invoice, step) is what stops two runs both sending
 *    it.
 *
 * 4. **A customer can be left out of the schedule** (`customers.automatic_reminders`), and is
 *    reminded by hand.
 */
const RENAMES: ReadonlyArray<readonly [string, string]> = [
  ['ai_collections:view', 'collections:view'],
  ['ai_collections:act', 'collections:act'],
];

export class CollectionsForEveryPlan1789740000000 implements MigrationInterface {
  name = 'CollectionsForEveryPlan1789740000000';

  public async up(q: QueryRunner): Promise<void> {
    for (const [from, to] of RENAMES) await this.renamePermission(q, from, to);

    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "collections_automatic_reminders" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "collections_reminder_days" integer[] NOT NULL DEFAULT '{-3,1,7,15,30}'
    `);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_organization_settings_reminder_days') THEN
          ALTER TABLE "organization_settings" ADD CONSTRAINT "CHK_organization_settings_reminder_days"
            CHECK (cardinality("collections_reminder_days") BETWEEN 1 AND 8
                   AND -60 <= ALL ("collections_reminder_days") AND 365 >= ALL ("collections_reminder_days"));
        END IF;
      END $$;
    `);

    await q.query(`ALTER TABLE "collection_activities" ADD COLUMN IF NOT EXISTS "schedule_step" integer`);
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CHK_collection_activities_schedule_step') THEN
          ALTER TABLE "collection_activities" ADD CONSTRAINT "CHK_collection_activities_schedule_step"
            CHECK ("schedule_step" IS NULL OR ("kind" = 'REMINDER' AND "invoice_id" IS NOT NULL));
        END IF;
      END $$;
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_collection_activities_invoice_schedule_step"
        ON "collection_activities" ("invoice_id", "schedule_step")
        WHERE "schedule_step" IS NOT NULL
    `);

    await q.query(`ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "automatic_reminders" boolean NOT NULL DEFAULT true`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "automatic_reminders"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_collection_activities_invoice_schedule_step"`);
    await q.query(`ALTER TABLE "collection_activities" DROP CONSTRAINT IF EXISTS "CHK_collection_activities_schedule_step"`);
    await q.query(`ALTER TABLE "collection_activities" DROP COLUMN IF EXISTS "schedule_step"`);
    await q.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "CHK_organization_settings_reminder_days"`);
    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "collections_reminder_days",
        DROP COLUMN IF EXISTS "collections_automatic_reminders"
    `);
    for (const [from, to] of RENAMES) await this.renamePermission(q, to, from);
  }

  /**
   * `from` becomes `to` wherever a permission is stored, keeping each list's order and naming each
   * permission once (a role that somehow held both keeps one).
   */
  private async renamePermission(q: QueryRunner, from: string, to: string): Promise<void> {
    await q.query(
      `
      UPDATE "roles" r
         SET "permissions" = (
           SELECT string_agg(deduped.name, ',' ORDER BY deduped.position)
             FROM (
               SELECT renamed.name, min(renamed.position) AS position
                 FROM (
                   SELECT CASE p.value WHEN $1 THEN $2 ELSE p.value END AS name, p.position
                     FROM unnest(string_to_array(r."permissions", ',')) WITH ORDINALITY AS p(value, position)
                 ) renamed
                GROUP BY renamed.name
             ) deduped
         )
       WHERE $1 = ANY (string_to_array(coalesce(r."permissions", ''), ','))
      `,
      [from, to],
    );
    await q.query(
      `
      UPDATE "ai_reports" a
         SET "required_permissions" = (
           SELECT coalesce(jsonb_agg(renamed.name ORDER BY renamed.name), '[]'::jsonb)
             FROM (
               SELECT DISTINCT CASE value WHEN $1 THEN $2 ELSE value END AS name
                 FROM jsonb_array_elements_text(a."required_permissions") AS value
             ) renamed
         )
       WHERE a."required_permissions" @> jsonb_build_array($1::text)
      `,
      [from, to],
    );
  }
}

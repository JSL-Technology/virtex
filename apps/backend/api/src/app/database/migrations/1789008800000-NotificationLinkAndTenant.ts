import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A notification says where it leads and which company it belongs to (QA B-02).
 *
 * The bell listed text and nothing else: an approval waiting for somebody could not be opened from
 * its own notice, and a person in two companies saw both companies' notices mixed together.
 * Existing rows keep both columns null — they are shown everywhere and lead nowhere, as before.
 */
export class NotificationLinkAndTenant1789008800000 implements MigrationInterface {
  name = 'NotificationLinkAndTenant1789008800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "notification"
        ADD COLUMN IF NOT EXISTS "organization_id" uuid,
        ADD COLUMN IF NOT EXISTS "link" character varying(300)
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_notification_user_org_created"
        ON "notification" ("userId", "organization_id", "createdAt")
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_notification_user_org_created"`);
    await q.query(`
      ALTER TABLE "notification"
        DROP COLUMN IF EXISTS "link",
        DROP COLUMN IF EXISTS "organization_id"
    `);
  }
}

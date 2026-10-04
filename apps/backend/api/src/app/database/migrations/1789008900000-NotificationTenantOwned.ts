import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A notice about a company is erased with the company.
 *
 * `NotificationLinkAndTenant1789008800000` gave notices an `organization_id` without the reference
 * every other tenant column has (TenantErasureCompleteness1789008100000), so deleting a tenant
 * left its notices behind and `tenant-deletion.spec.ts` failed on a freshly migrated database.
 * Notices pointing at a company that no longer exists are removed first: they lead nowhere and
 * belong to no one who could read them.
 */
export class NotificationTenantOwned1789008900000 implements MigrationInterface {
  name = 'NotificationTenantOwned1789008900000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      DELETE FROM "notification" n
       WHERE n."organization_id" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = n."organization_id")
    `);
    await q.query(`
      ALTER TABLE "notification"
        ADD CONSTRAINT "FK_notification_organization"
        FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "notification" DROP CONSTRAINT IF EXISTS "FK_notification_organization"`);
  }
}

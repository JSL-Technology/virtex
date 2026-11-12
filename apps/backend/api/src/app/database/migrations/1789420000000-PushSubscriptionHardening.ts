import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push subscriptions keyed by endpoint, limited to real push services (audit 2026-11-07, PLT-NOT-01).
 *
 * 1. Rows whose endpoint is not a browser push service are deleted. The API used to accept any URL
 *    (and any `id`, which let one user overwrite another's row); such a row is either an attack or
 *    garbage, and the server would POST to it on every notification.
 * 2. One row per endpoint (an endpoint identifies a browser profile); duplicates keep one row.
 * 3. `endpoint` becomes varchar(2048), unique; `userId` gets an index (every send looks it up).
 * 4. Deleting a user deletes their subscriptions (the FK used to block the deletion instead).
 */
const TRUSTED_ENDPOINT =
  '^https://(fcm\\.googleapis\\.com|updates\\.push\\.services\\.mozilla\\.com|push\\.services\\.mozilla\\.com|' +
  'web\\.push\\.apple\\.com|[a-z0-9-]+\\.push\\.apple\\.com|[a-z0-9-]+\\.notify\\.windows\\.com)(:443)?/';

export class PushSubscriptionHardening1789420000000 implements MigrationInterface {
  name = 'PushSubscriptionHardening1789420000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`DELETE FROM "push_subscription" WHERE NOT (lower("endpoint") ~ $1) OR length("endpoint") > 2048`, [TRUSTED_ENDPOINT]);
    await q.query(`
      DELETE FROM "push_subscription" a
       USING "push_subscription" b
       WHERE a."endpoint" = b."endpoint" AND a."id" > b."id"
    `);
    await q.query(`ALTER TABLE "push_subscription" ALTER COLUMN "endpoint" TYPE character varying(2048)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_push_subscription_endpoint" ON "push_subscription" ("endpoint")`);
    await q.query(`CREATE INDEX "IDX_push_subscription_user" ON "push_subscription" ("userId")`);
    await q.query(`ALTER TABLE "push_subscription" DROP CONSTRAINT "FK_8a227cbc3dc43c0d56117ea1563"`);
    await q.query(`
      ALTER TABLE "push_subscription" ADD CONSTRAINT "FK_8a227cbc3dc43c0d56117ea1563"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "push_subscription" DROP CONSTRAINT "FK_8a227cbc3dc43c0d56117ea1563"`);
    await q.query(`
      ALTER TABLE "push_subscription" ADD CONSTRAINT "FK_8a227cbc3dc43c0d56117ea1563"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
    await q.query(`DROP INDEX IF EXISTS "IDX_push_subscription_user"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_push_subscription_endpoint"`);
    await q.query(`ALTER TABLE "push_subscription" ALTER COLUMN "endpoint" TYPE character varying`);
  }
}

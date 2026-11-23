import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lifetime quotas stop having a counter (IAM-P4).
 *
 * Members, customers, suppliers and subsidiaries are limited by how many EXIST, and the quota is now
 * enforced and shown by counting them (`SaasService.enforceLifetimeLimit`, `usage-sources.ts`). The
 * `saas_usage_metrics` rows with period `lifetime` were the old counter: it started at zero whatever
 * a tenant already had, and was corrected nightly by a job that counted nothing under the row-level
 * policies. Nothing reads them any more, and a number nobody maintains is one somebody will trust.
 *
 * Monthly rows stay: a monthly quota is a volume of activity, and its counter is the record of it.
 *
 * `down` rebuilds the counters from the rows they would have counted, so a rollback leaves the old
 * code a correct starting point rather than an empty table.
 */
export class LifetimeQuotasCountRows1789710000000 implements MigrationInterface {
  name = 'LifetimeQuotasCountRows1789710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "saas_usage_metrics" WHERE "period" = 'lifetime'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const sources: Array<[string, string]> = [
      ['users', `SELECT organization_id, COUNT(*)::int AS n FROM user_organizations GROUP BY organization_id`],
      ['customers', `SELECT organization_id, COUNT(*)::int AS n FROM customers GROUP BY organization_id`],
      ['suppliers', `SELECT organization_id, COUNT(*)::int AS n FROM suppliers GROUP BY organization_id`],
      [
        'subsidiaries',
        `SELECT parent_organization_id AS organization_id, COUNT(*)::int AS n FROM organization_subsidiaries GROUP BY parent_organization_id`,
      ],
    ];
    for (const [resource, counted] of sources) {
      await queryRunner.query(
        `INSERT INTO "saas_usage_metrics" (organization_id, resource, period, count, updated_at)
         SELECT c.organization_id, $1, 'lifetime', c.n, NOW() FROM (${counted}) c
         ON CONFLICT (organization_id, resource, period) DO UPDATE SET count = EXCLUDED.count, updated_at = NOW()`,
        [resource],
      );
    }
  }
}

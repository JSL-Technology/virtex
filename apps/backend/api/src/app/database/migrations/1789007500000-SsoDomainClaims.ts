import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * SSO domain claims: verified claims are global, pending ones are private and short-lived, and
 * verification is re-checked.
 *
 * ## What was wrong
 *
 * 1. `domain` was unique across ALL organizations whether or not the claim was verified. Any
 *    tenant could claim `acme.com` without proving anything and so block the real owner
 *    permanently; the error it got back ("already registered") also told a stranger that some
 *    other tenant had claimed it.
 * 2. Under row-level security, discovery — which runs before sign-in, with no tenant — could see
 *    no claim at all. Enterprise SSO could not be found by any user of the production role.
 * 3. A pending claim never expired, and a verified one was never re-checked: a domain that lapsed
 *    or changed hands stayed an SSO route for its former owner.
 *
 * ## What this does
 *
 *  - Uniqueness is enforced only among VERIFIED claims (a partial unique index), plus one claim
 *    per organization and domain. Several tenants may hold a pending claim; the first to prove
 *    DNS control wins, and the unique index settles a race.
 *  - A second, SELECT-only policy exposes verified claims to every tenant. A verified domain and
 *    the organization it routes to is what its owner published in DNS; it is routing data, and
 *    discovery needs it before there is a tenant. Pending claims and every write stay isolated.
 *  - `last_checked_at` and `failed_checks` record the periodic re-verification.
 */
export class SsoDomainClaims1789007500000 implements MigrationInterface {
  name = 'SsoDomainClaims1789007500000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_domains"
        ADD COLUMN IF NOT EXISTS "last_checked_at" timestamptz NULL,
        ADD COLUMN IF NOT EXISTS "failed_checks" integer NOT NULL DEFAULT 0
    `);

    await q.query(`DROP INDEX IF EXISTS "IDX_organization_domains_domain"`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_organization_domains_verified_domain"
        ON "organization_domains" ("domain") WHERE "verified" = true
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_organization_domains_org_domain"
        ON "organization_domains" ("organization_id", "domain")
    `);

    await q.query(`DROP POLICY IF EXISTS sso_routing ON "organization_domains"`);
    await q.query(`
      CREATE POLICY sso_routing ON "organization_domains"
        FOR SELECT
        USING ("verified" = true)
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP POLICY IF EXISTS sso_routing ON "organization_domains"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_organization_domains_org_domain"`);
    await q.query(`DROP INDEX IF EXISTS "UQ_organization_domains_verified_domain"`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_domains_domain"
        ON "organization_domains" ("domain")
    `);
    await q.query(`
      ALTER TABLE "organization_domains"
        DROP COLUMN IF EXISTS "failed_checks",
        DROP COLUMN IF EXISTS "last_checked_at"
    `);
  }
}

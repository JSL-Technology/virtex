import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The company profile shows what was typed at signup (QA A-02).
 *
 * The data was never lost — signup wrote address, city, state, postal code and industry onto the
 * organization — but `GET /organizations/profile` serialised the row through a DTO that did not
 * expose them, so the profile screen came up empty and the tenant believed they had to type it
 * all again. That is fixed in the response; this repairs the rows themselves where an earlier
 * build of the signup did not copy a field across.
 *
 * Only from where the data actually exists: the completed `pending_registrations` row that
 * produced the organization. Each field is filled only when the organization's own value is
 * empty, so nothing a tenant has since edited is overwritten, and an organization with no signup
 * row behind it (the development seed, subsidiaries) is left exactly as it is.
 */
export class BackfillOrganizationProfileFromSignup1789010230000 implements MigrationInterface {
  name = 'BackfillOrganizationProfileFromSignup1789010230000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      UPDATE "organizations" o
         SET "address"     = COALESCE(NULLIF(o."address", ''), p."address"),
             "city"        = COALESCE(NULLIF(o."city", ''), p."city"),
             "state"       = COALESCE(NULLIF(o."state", ''), p."state"),
             "postal_code" = COALESCE(NULLIF(o."postal_code", ''), p."postal_code"),
             "industry"    = COALESCE(NULLIF(o."industry", ''), p."industry"),
             "company_size" = COALESCE(NULLIF(o."company_size", ''), p."company_size")
        FROM "pending_registrations" p
       WHERE p."organization_id" = o."id"
         AND p."status" = 'completed'
         AND (
              (NULLIF(o."address", '') IS NULL AND p."address" IS NOT NULL)
           OR (NULLIF(o."city", '') IS NULL AND p."city" IS NOT NULL)
           OR (NULLIF(o."state", '') IS NULL AND p."state" IS NOT NULL)
           OR (NULLIF(o."postal_code", '') IS NULL AND p."postal_code" IS NOT NULL)
           OR (NULLIF(o."industry", '') IS NULL AND p."industry" IS NOT NULL)
           OR (NULLIF(o."company_size", '') IS NULL AND p."company_size" IS NOT NULL)
         )
    `);
  }

  public async down(): Promise<void> {
    // A backfill of facts the tenant itself supplied. There is nothing to undo: reverting would
    // erase data the profile is now showing correctly.
  }
}

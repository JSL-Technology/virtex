import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The company's branding, kept with the company instead of in one browser.
 *
 * Accent colour, typeface and corner radius were written to the `localStorage` of whoever set them;
 * the logo too, as a data URL. Every other member, and the same member on another device, saw the
 * defaults. `organization_settings.branding` holds the look; the logo goes to `organizations.logo_url`,
 * which already existed and nothing wrote. Additive and idempotent.
 */
export class OrganizationBranding1789240000000 implements MigrationInterface {
  name = 'OrganizationBranding1789240000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "branding" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "branding"`);
  }
}

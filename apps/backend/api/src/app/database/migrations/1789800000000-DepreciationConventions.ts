import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Depreciation conventions (audit 2026-11-07, FINB-12).
 *
 * The convention was fixed in the code: a whole month for the month an asset entered service in,
 * whatever the day, and nothing for the month it left in. `fixed_asset.depreciation_convention`
 * says it for each asset, and `organization_settings.default_depreciation_convention` what a new
 * asset follows unless it says otherwise. Every existing asset and company starts at `FULL_MONTH`,
 * which is what each of them has been charged by: nothing already posted changes meaning.
 */
export class DepreciationConventions1789800000000 implements MigrationInterface {
  name = 'DepreciationConventions1789800000000';

  public async up(q: QueryRunner): Promise<void> {
    const conventions = `('FULL_MONTH', 'NEXT_MONTH', 'MID_MONTH', 'DAILY')`;
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "depreciation_convention" character varying(20) NOT NULL DEFAULT 'FULL_MONTH'`);
    await q.query(`ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_convention" CHECK ("depreciation_convention" IN ${conventions})`);
    await q.query(
      `ALTER TABLE "organization_settings" ADD COLUMN "default_depreciation_convention" character varying(20) NOT NULL DEFAULT 'FULL_MONTH'`,
    );
    await q.query(
      `ALTER TABLE "organization_settings" ADD CONSTRAINT "CHK_organization_settings_depreciation_convention" CHECK ("default_depreciation_convention" IN ${conventions})`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" DROP CONSTRAINT IF EXISTS "CHK_organization_settings_depreciation_convention"`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "default_depreciation_convention"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_convention"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "depreciation_convention"`);
  }
}

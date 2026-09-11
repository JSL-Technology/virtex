import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Client-side UI for extensions.
 *
 * An extension version can now carry a browser UI (`uiEntry`) and a contribution manifest
 * (`contributes`) describing where that UI mounts. This is additive and nullable: existing
 * server-only extensions are unaffected. The UI runs in a sandboxed iframe in the client, never on
 * the server, so it is not part of the signed server `code` path.
 */
export class ExtensionUi1789002400000 implements MigrationInterface {
  name = 'ExtensionUi1789002400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plugin_versions" ADD COLUMN IF NOT EXISTS "uiEntry" text`);
    await queryRunner.query(
      `ALTER TABLE "plugin_versions" ADD COLUMN IF NOT EXISTS "contributes" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "plugin_versions" DROP COLUMN IF EXISTS "contributes"`);
    await queryRunner.query(`ALTER TABLE "plugin_versions" DROP COLUMN IF EXISTS "uiEntry"`);
  }
}

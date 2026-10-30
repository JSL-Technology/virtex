import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How dates, numbers and times are written — for the company, and for each person over it.
 *
 * The formats came from CLDR alone (the reader's language in the company's country), with no way
 * to say «decimal comma» or «year first». `organization_settings.regional_format` is the company's
 * default and `users.regional_format` a person's own choice; `null` and absent fields mean
 * automatic, so every existing row keeps exactly the format it had. Additive and idempotent.
 */
export class RegionalFormat1789250000000 implements MigrationInterface {
  name = 'RegionalFormat1789250000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "regional_format" jsonb`);
    await q.query(`ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "regional_format" jsonb`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "regional_format"`);
    await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "regional_format"`);
  }
}

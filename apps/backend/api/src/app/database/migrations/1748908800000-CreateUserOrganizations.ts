import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-tenancy foundation: a join table mapping users to every organization
 * they can access. The application reads this table during authentication to
 * build `user.organizations` for tenant access checks.
 *
 * Existing single-org memberships (users.organization_id) are backfilled so the
 * data stays consistent after the switch from a 1:1 to an N:N model.
 */
export class CreateUserOrganizations1748908800000 implements MigrationInterface {
  name = 'CreateUserOrganizations1748908800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_organizations" (
        "user_id" uuid NOT NULL,
        "organization_id" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_user_organizations" PRIMARY KEY ("user_id", "organization_id"),
        CONSTRAINT "FK_user_organizations_user" FOREIGN KEY ("user_id")
          REFERENCES "users" ("id") ON DELETE CASCADE,
        CONSTRAINT "FK_user_organizations_org" FOREIGN KEY ("organization_id")
          REFERENCES "organizations" ("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_organizations_user" ON "user_organizations" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_organizations_org" ON "user_organizations" ("organization_id")`,
    );

    // Backfill existing 1:1 memberships. organization_id is stored as varchar on
    // users but always holds a valid UUID; cast and skip blanks/duplicates.
    await queryRunner.query(`
      INSERT INTO "user_organizations" ("user_id", "organization_id")
      SELECT u."id", u."organization_id"::uuid
        FROM "users" u
       WHERE u."organization_id" IS NOT NULL
         AND u."organization_id" <> ''
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_organizations_org"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_organizations_user"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "user_organizations"`);
  }
}

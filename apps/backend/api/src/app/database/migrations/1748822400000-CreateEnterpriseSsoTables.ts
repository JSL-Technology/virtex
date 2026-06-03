import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 2 — Enterprise SSO: per-organization identity providers and verified email domains.
 */
export class CreateEnterpriseSsoTables1748822400000 implements MigrationInterface {
  name = 'CreateEnterpriseSsoTables1748822400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);

    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "identity_providers_type_enum" AS ENUM ('oidc', 'saml');
      EXCEPTION WHEN duplicate_object THEN null;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "identity_providers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "name" character varying(120) NOT NULL,
        "type" "identity_providers_type_enum" NOT NULL DEFAULT 'oidc',
        "issuer_url" character varying NOT NULL,
        "client_id" character varying NOT NULL,
        "client_secret_encrypted" text NOT NULL,
        "scopes" text NOT NULL DEFAULT 'openid,email,profile',
        "default_role_id" uuid,
        "enabled" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_identity_providers" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_identity_providers_org" ON "identity_providers" ("organization_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "organization_domains" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "organization_id" uuid NOT NULL,
        "domain" character varying NOT NULL,
        "verified" boolean NOT NULL DEFAULT false,
        "verification_token" character varying NOT NULL,
        "verified_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_organization_domains" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_organization_domains_domain" ON "organization_domains" ("domain")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_organization_domains_domain"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "organization_domains"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_identity_providers_org"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "identity_providers"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "identity_providers_type_enum"`);
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The tables behind the extensions marketplace and sandbox ("virtual machine for extensions"),
 * consolidated from the standalone plugin-host service into the API.
 *
 * The split mirrors the trust model the sandbox enforces:
 *  - `plugins` / `plugin_versions` are the GLOBAL catalogue — an extension is authored and admitted
 *    once. A version's `signature` is the admission pipeline's attestation over its `code`; the
 *    sandbox refuses to run a version whose signature does not verify, so a row tampered with after
 *    admission simply does not execute.
 *  - `plugin_tenant_consents` and `plugin_metering_records` are TENANT-scoped and cascade on tenant
 *    deletion, because consent (what a tenant lets an extension do to its data) and usage (what it
 *    cost that tenant) are facts about one tenant, not the catalogue.
 *
 * Column identifiers are camelCase to match the entity definitions, which — like the majority of
 * this schema — carry no snake-case `name:` override, so TypeORM maps the property name verbatim.
 */
export class Extensions1789002200000 implements MigrationInterface {
  name = 'Extensions1789002200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "plugins_status_enum" AS ENUM ('ACTIVE', 'DISABLED', 'REVOKED');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "plugin_versions_channel_enum" AS ENUM ('STABLE', 'BETA', 'CANARY');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "plugin_metering_records_status_enum" AS ENUM ('success', 'failure');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugins" (
        "id"          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "name"        character varying(255) NOT NULL,
        "description" text,
        "author"      character varying(255),
        "status"      "plugins_status_enum" NOT NULL DEFAULT 'ACTIVE',
        "createdAt"   timestamptz NOT NULL DEFAULT now(),
        "updatedAt"   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_plugins_name" ON "plugins" ("name")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugin_versions" (
        "id"           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "pluginId"     uuid NOT NULL,
        "version"      character varying(50) NOT NULL,
        "code"         text NOT NULL,
        "capabilities" text,
        "sbom"         jsonb,
        "signature"    text,
        "channel"      "plugin_versions_channel_enum" NOT NULL DEFAULT 'STABLE',
        "createdAt"    timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_plugin_versions_plugin"
          FOREIGN KEY ("pluginId") REFERENCES "plugins"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_plugin_versions_plugin_version"
        ON "plugin_versions" ("pluginId", "version")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugin_tenant_consents" (
        "id"                   uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organizationId"       uuid NOT NULL,
        "pluginId"             uuid NOT NULL,
        "grantedCapabilities"  text NOT NULL DEFAULT '',
        "enabled"              boolean NOT NULL DEFAULT true,
        "createdAt"            timestamptz NOT NULL DEFAULT now(),
        "updatedAt"            timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_plugin_consent_plugin"
          FOREIGN KEY ("pluginId") REFERENCES "plugins"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_plugin_consent_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_plugin_consent_org_plugin"
        ON "plugin_tenant_consents" ("organizationId", "pluginId")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plugin_consent_org"
        ON "plugin_tenant_consents" ("organizationId")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "plugin_metering_records" (
        "id"              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "organizationId"  uuid NOT NULL,
        "pluginId"        character varying(255) NOT NULL,
        "pluginVersion"   character varying(50) NOT NULL DEFAULT '0.0.0',
        "executionTimeMs" integer NOT NULL DEFAULT 0,
        "memoryBytes"     bigint NOT NULL DEFAULT 0,
        "egressCount"     integer NOT NULL DEFAULT 0,
        "status"          "plugin_metering_records_status_enum" NOT NULL DEFAULT 'success',
        "timestamp"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_plugin_metering_organization"
          FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plugin_metering_org_ts"
        ON "plugin_metering_records" ("organizationId", "timestamp")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plugin_metering_org_plugin"
        ON "plugin_metering_records" ("organizationId", "pluginId")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "plugin_metering_records"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plugin_tenant_consents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plugin_versions"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "plugins"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "plugin_metering_records_status_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "plugin_versions_channel_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "plugins_status_enum"`);
  }
}

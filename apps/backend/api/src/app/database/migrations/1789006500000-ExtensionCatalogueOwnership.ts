import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Gives the extensions catalogue an owner per row, and pins each tenant's consent to a version.
 *
 * ## The hole this closes
 *
 * `plugins` and `plugin_versions` are deliberately global — an extension is authored once and
 * offered to every tenant — so they carry no `organization_id`. The write routes, however, were
 * guarded by `extensions:manage`, an ordinary TENANT permission that the `'*'` of every tenant's
 * ADMINISTRATOR role satisfies. And `register` located a plugin by NAME and appended a version to
 * whatever it found, with no check on who was appending.
 *
 * Put together: anybody who signed up could publish a new version of any extension in the
 * catalogue. Because `resolveVersion` serves the most recent version and `runtime` serves the most
 * recent `uiEntry`, that code then ran server-side in other tenants' isolates — with the
 * capabilities THOSE tenants had granted — and client-side in their administrators' browsers.
 * `revoke(name)` was the same shape in reverse: one call withdrew an extension from everyone.
 *
 * ## What changes here
 *
 * - `plugins.publisher_organization_id` — a name is now an identity. Publishing under a name
 *   somebody else owns is refused.
 * - `plugin_tenant_consents.consented_version_id` — consent is to a VERSION, not to a name, so a
 *   version published later does not inherit it. A new release becomes a proposal.
 * - `plugin_tenant_consents.pending_version_id` — where that proposal waits for the tenant.
 *
 * The permission change that goes with this lives in the code: those routes now require
 * `platform:extensions:publish` / `platform:extensions:revoke`, which no tenant role can carry.
 *
 * ## Backfill
 *
 * `publisher_organization_id` is left NULL for existing rows, which means "published by the
 * platform" — the truthful reading, since before this migration there was no tenant ownership to
 * record, and it is the conservative one: a NULL row is editable only by a platform principal.
 *
 * `consented_version_id` is also left NULL and resolved lazily on first read (see
 * `ExtensionsService.resolveConsentedVersion`), which pins the version the tenant is running today
 * rather than a version this migration would have to guess at.
 */
export class ExtensionCatalogueOwnership1789006500000 implements MigrationInterface {
  name = 'ExtensionCatalogueOwnership1789006500000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plugins"
        ADD COLUMN IF NOT EXISTS "publisher_organization_id" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_plugins_publisher_organization"
        ON "plugins" ("publisher_organization_id")
    `);
    // ON DELETE SET NULL, not CASCADE: a tenant closing its account must not delete an extension
    // other tenants have installed. The row survives and becomes platform-owned, which is also
    // what makes it un-republishable by anyone but an operator.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_plugins_publisher_organization'
        ) THEN
          ALTER TABLE "plugins"
            ADD CONSTRAINT "FK_plugins_publisher_organization"
            FOREIGN KEY ("publisher_organization_id") REFERENCES "organizations"("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "plugin_tenant_consents"
        ADD COLUMN IF NOT EXISTS "consented_version_id" uuid,
        ADD COLUMN IF NOT EXISTS "pending_version_id" uuid
    `);
    // A version that is deleted leaves the consent unpinned rather than deleting the consent, so
    // the tenant keeps its granted capabilities and simply re-pins on the next read.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_plugin_consent_consented_version'
        ) THEN
          ALTER TABLE "plugin_tenant_consents"
            ADD CONSTRAINT "FK_plugin_consent_consented_version"
            FOREIGN KEY ("consented_version_id") REFERENCES "plugin_versions"("id")
            ON DELETE SET NULL;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_plugin_consent_pending_version'
        ) THEN
          ALTER TABLE "plugin_tenant_consents"
            ADD CONSTRAINT "FK_plugin_consent_pending_version"
            FOREIGN KEY ("pending_version_id") REFERENCES "plugin_versions"("id")
            ON DELETE SET NULL;
        END IF;
      END
      $$;
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE ON "plugins" TO virtex_app;
          GRANT SELECT, INSERT, UPDATE, DELETE ON "plugin_tenant_consents" TO virtex_app;
        END IF;
      END
      $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "plugin_tenant_consents"
        DROP CONSTRAINT IF EXISTS "FK_plugin_consent_pending_version",
        DROP CONSTRAINT IF EXISTS "FK_plugin_consent_consented_version",
        DROP COLUMN IF EXISTS "pending_version_id",
        DROP COLUMN IF EXISTS "consented_version_id"
    `);
    await queryRunner.query(`
      ALTER TABLE "plugins"
        DROP CONSTRAINT IF EXISTS "FK_plugins_publisher_organization"
    `);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_plugins_publisher_organization"`);
    await queryRunner.query(`ALTER TABLE "plugins" DROP COLUMN IF EXISTS "publisher_organization_id"`);
  }
}

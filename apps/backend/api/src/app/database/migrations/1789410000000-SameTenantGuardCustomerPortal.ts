import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Guard `customer_portal_accounts.customer_id` against cross-tenant references.
 *
 * `SameTenantReferences` installs a deferred constraint trigger on every single-column foreign key
 * between two tenant tables. It evaluates the catalogue once, when it runs, so a foreign key created
 * by a LATER migration is unguarded until the installer runs again. `CustomerPortalAccounts`
 * (1789380000000) added exactly such a key, `FK_customer_portal_accounts_customer`, and
 * `same-tenant-references.spec.ts` — which asserts that no such key is left unguarded — has failed
 * since. The application already refuses a foreign customer (`CustomerPortalAccountsService.grant`
 * answers 404); this restores the database-level guarantee underneath it.
 *
 * The installer is idempotent (it drops and recreates each guard), so re-running it is safe and
 * guards anything else added since. Any migration that adds a foreign key between tenant tables
 * must end with the same call; the spec fails CI otherwise.
 */
export class SameTenantGuardCustomerPortal1789410000000 implements MigrationInterface {
  name = 'SameTenantGuardCustomerPortal1789410000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $do$
      BEGIN
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON customer_portal_accounts',
                       'tg_same_tenant_' || substr(md5('FK_customer_portal_accounts_customer'), 1, 24));
      END
      $do$;
    `);
  }
}

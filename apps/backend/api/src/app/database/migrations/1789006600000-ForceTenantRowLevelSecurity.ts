import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes the tenant isolation policies apply to the table owner too.
 *
 * ## What was wrong
 *
 * `ENABLE ROW LEVEL SECURITY` does not apply to a table's OWNER. The 118 policies installed by
 * `TenantRowLevelSecurity1789002100000` were therefore inert for any connection made as the role
 * that created the schema, and whether they governed the running application came down to one
 * environment variable: `DB_USERNAME=virtex_app` rather than the owner.
 *
 * The migration that installed them says so plainly, and staged it that way on purpose so the
 * cutover could be made deliberately. What was missing is the step that makes the decision
 * irreversible. A deployment that inherited an older `DB_USERNAME` — or a future migration run
 * that changes who owns a table — silently went back to isolation-by-remembering, and
 * `tenant-isolation.check.ts` describes exactly why that is the dangerous state: it is
 * indistinguishable from the correct one from inside. Everything works until somebody sees
 * another company's ledger.
 *
 * `FORCE ROW LEVEL SECURITY` removes the owner exemption, so the policies hold for every role
 * except a superuser or one with BYPASSRLS — which are, by definition, deliberate grants.
 *
 * ## Why this does not break migrations
 *
 * A superuser bypasses RLS whether or not it is forced, so a migration or maintenance connection
 * made as one is unaffected. A non-superuser migration role needs BYPASSRLS; `.env.example`
 * documents that, and `TenantIsolationCheck` reports it at boot.
 *
 * ## Coverage is read from the catalogue, not from a list
 *
 * Every table that HAS the `tenant_isolation` policy is forced. Reading `pg_policies` rather than
 * repeating a list means a table protected by a later migration is covered here too, and cannot
 * be missed by somebody forgetting to add it.
 */
export class ForceTenantRowLevelSecurity1789006600000 implements MigrationInterface {
  name = 'ForceTenantRowLevelSecurity1789006600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const tables: Array<{ tablename: string }> = await queryRunner.query(`
      SELECT DISTINCT p.tablename
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.policyname = 'tenant_isolation'
       ORDER BY p.tablename
    `);

    for (const { tablename } of tables) {
      await queryRunner.query(`ALTER TABLE "${tablename}" FORCE ROW LEVEL SECURITY`);
    }

    // Said out loud in the migration log, because the number is the whole point: if it is zero,
    // the policies were never installed and this migration has protected nothing.
    // eslint-disable-next-line no-console
    console.log(
      `[migration] FORCE ROW LEVEL SECURITY applied to ${tables.length} table(s) carrying the ` +
        `tenant_isolation policy.`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables: Array<{ tablename: string }> = await queryRunner.query(`
      SELECT DISTINCT p.tablename
        FROM pg_policies p
       WHERE p.schemaname = 'public'
         AND p.policyname = 'tenant_isolation'
       ORDER BY p.tablename
    `);

    for (const { tablename } of tables) {
      await queryRunner.query(`ALTER TABLE "${tablename}" NO FORCE ROW LEVEL SECURITY`);
    }
  }
}

import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tenant isolation, enforced by the database.
 *
 * ## Why the application filter is not enough
 *
 * Today isolation is 87 services each remembering `where organizationId`. That is the same shape of
 * control this repository has already watched fail three times — CSRF reached "4 of 50" controllers
 * while it was opt-in, entitlement "1 of 67", permissions 47 of 76 — and it has already failed
 * here too: a migration in this very folder records a cross-tenant leak shipped to production,
 * every webhook subscriber receiving every tenant's payloads.
 *
 * A `WHERE` clause that must be remembered is a `WHERE` clause that will be forgotten, and the
 * product is about to multiply the places it has to be remembered in: seven applications and two
 * portals for people who are not staff of the tenant.
 *
 * So the rule moves to where it cannot be skipped. With these policies, a query that omits the
 * tenant does not return the wrong rows — it returns none.
 *
 * ## How it is staged, and why that is not a disabled flag
 *
 * `ENABLE ROW LEVEL SECURITY` does not apply to a table's owner. The API connects as the owner
 * today, so this migration changes nothing for the running application: it installs the policies
 * and proves them, without a big-bang cutover that could only be validated in production.
 *
 * Enforcement is switched on by pointing the API at the `virtex_app` role created below, which owns
 * nothing and therefore obeys the policies. That switch has one prerequisite, and it is a real
 * piece of work rather than a checkbox: `app.current_organization` has to be set on the connection
 * that serves each request. With 91 services using `@InjectRepository`, whose repositories bind to
 * the default entity manager, that means a request-scoped transaction — the same `AsyncLocalStorage`
 * pattern `i18n/request-locale.ts` already uses here — so the setting reaches every query.
 *
 * Until then the policies sit inert against the owner, and `npm run verify:rls` proves against a
 * live database that they isolate correctly. Doing it the other way round — flipping the role
 * first — would take the product down; landing the policies first makes the switch a one-line
 * credential change whose behaviour is already known.
 *
 * ## What is deliberately not covered
 *
 * Tables whose `organization_id` is NULLABLE are excluded: `users`, `roles`, `audit_logs`,
 * `warehouses`, `employees`, `projects` and twelve more. A nullable tenant column means the table
 * holds rows that belong to no tenant — a system role, a person who has not joined a company yet,
 * a signup in flight — and who may see those is a question about the data model, not one a policy
 * can answer. Several of them are also read by the authentication path, which runs BEFORE a tenant
 * context exists and would see nothing under a tenant policy.
 *
 * Global reference data is excluded for the same reason and the opposite cause: `currency`,
 * `exchange_rate`, `saas_plans`, `fiscal_regions`, `coa_templates`, `tax_templates` and
 * `localization_templates` are facts about the world, shared on purpose.
 */
export class TenantRowLevelSecurity1789002100000 implements MigrationInterface {
  name = 'TenantRowLevelSecurity1789002100000';

  /**
   * The comparison for one table's tenant column.
   *
   * Ten tables store `organization_id` as `character varying` and the rest as `uuid` — a schema
   * inconsistency this migration surfaced by failing on `operator does not exist: character varying
   * = uuid`. The predicate is therefore derived from the column's ACTUAL type rather than assumed,
   * which also means it cannot drift: a table added later is read from `information_schema`, not
   * from a list somebody has to remember to update.
   *
   * The cast goes on the setting, never on the column: casting the column would defeat the index
   * behind every query the policy touches.
   */
  private async tenantPredicate(
    queryRunner: QueryRunner,
    table: string,
    alias?: string,
  ): Promise<string> {
    const rows: Array<{ data_type: string }> = await queryRunner.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'`,
      [table],
    );
    const column = `${alias ? `${alias}.` : ''}organization_id`;
    // NULLIF, because a released connection resets the setting and an empty string is not a uuid:
    // without it `''::uuid` raises `invalid input syntax for type uuid` and the request fails with a
    // database error instead of simply seeing nothing. Absent and empty must mean the same thing —
    // no tenant, therefore no rows.
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;

    return rows[0]?.data_type === 'uuid'
      ? `${column} = ${setting}::uuid`
      : `${column} = ${setting}`;
  }

  /**
   * Enable RLS on one table and install its policy.
   *
   * `USING` governs what is visible; `WITH CHECK` governs what may be written. Both are needed:
   * without `WITH CHECK`, a tenant cannot READ another's rows but can still CREATE a row stamped
   * with somebody else's id.
   *
   * `current_setting(..., true)` returns NULL when the setting is absent, so the comparison is NULL
   * and the row is not visible. Absent context therefore means no rows, never all rows.
   */
  private async protect(queryRunner: QueryRunner, table: string, predicate: string): Promise<void> {
    await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
    await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    await queryRunner.query(`
      CREATE POLICY tenant_isolation ON "${table}"
        USING (${predicate})
        WITH CHECK (${predicate})
    `);
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    // The role the API will connect as once request-scoped tenant binding lands. It owns nothing,
    // so the policies apply to it; the owner keeps working meanwhile.
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'virtex_app') THEN
          CREATE ROLE virtex_app LOGIN;
        END IF;
      END
      $$;
    `);
    await queryRunner.query(`GRANT USAGE ON SCHEMA public TO virtex_app`);
    await queryRunner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO virtex_app`,
    );
    await queryRunner.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO virtex_app`);
    // Tables added by later migrations must not silently be unreachable by the app role.
    await queryRunner.query(`
      ALTER DEFAULT PRIVILEGES IN SCHEMA public
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO virtex_app
    `);

    // ── Tables that carry their own tenant ────────────────────────────────────
    //
    // Read from the schema rather than listed here. A NULLABLE tenant column is excluded on
    // purpose: it means the table holds rows belonging to no tenant, and who may see those is a
    // question about the data model that a policy cannot answer.
    const owned: Array<{ table_name: string }> = await queryRunner.query(`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      WHERE c.table_schema = 'public'
        AND c.column_name = 'organization_id'
        AND c.is_nullable = 'NO'
      ORDER BY c.table_name
    `);

    for (const { table_name } of owned) {
      await this.protect(queryRunner, table_name, await this.tenantPredicate(queryRunner, table_name));
    }

    // ── Tables that inherit the tenant from their document ────────────────────
    //
    // A line belongs to its document, not to the product it references, so the parent is named
    // explicitly instead of being guessed from the foreign keys.
    const inherited: Array<[string, string, string]> = [
      ['account_hierarchy_versions', 'accounts', '"accountId"'],
      ['account_history', 'accounts', 'account_id'],
      ['account_period_locks', 'accounting_periods', '"periodId"'],
      ['account_segments', 'accounts', 'account_id'],
      ['accounts_closure', 'accounts', 'id_descendant'],
      ['bank_transactions', 'bank_statements', 'statement_id'],
      ['budget_lines', 'budgets', 'budget_id'],
      ['consolidation_maps', 'accounts', 'subsidiary_account_id'],
      ['customer_addresses', 'customers', 'customer_id'],
      ['customer_contacts', 'customers', 'customer_id'],
      ['customer_payment_lines', 'customer_payments', 'payment_id'],
      ['dimension_rules', 'dimensions', 'dimension_id'],
      ['dimension_values', 'dimensions', 'dimension_id'],
      ['invoice_line_item', 'invoices', '"invoiceId"'],
      ['journal_entry_lines', 'journal_entries', 'journal_entry_id'],
      ['journal_entry_line_valuations', 'journal_entry_lines', 'journal_entry_line_id'],
      ['ledger_mapping_rule_conditions', 'ledger_mapping_rules', 'rule_id'],
      ['price_list_items', 'price_lists', 'price_list_id'],
      ['proposed_adjustment_evidence', 'proposed_audit_adjustments', 'proposed_adjustment_id'],
      ['quote_lines', 'quotes', 'quote_id'],
      ['reconciliation_match_lines', 'reconciliation_matches', 'match_id'],
      ['tax_rules', 'taxes', 'tax_id'],
      ['vendor_bill_line', 'vendor_bills', '"vendorBillId"'],
    ];

    const parentOf = new Map(inherited.map(([child, parent, fk]) => [child, { parent, fk }]));

    /**
     * The predicate for a child, resolved through however many levels it takes.
     *
     * A valuation hangs off a journal-entry LINE, which hangs off the entry, which is the row that
     * carries the tenant. Chaining is done here rather than by special-casing that one table,
     * because the next two-level child would otherwise fail the same way — and it failed loudly,
     * with `column p.organization_id does not exist`, which is how this was found.
     */
    const inheritedPredicate = async (child: string, depth = 0): Promise<string> => {
      const link = parentOf.get(child);
      if (!link) throw new Error(`RLS: no parent declared for ${child}`);

      const { parent, fk } = link;
      const alias = `p${depth}`;
      const column = fk.replace(/"/g, '');

      const hasColumn: Array<{ ok: boolean }> = await queryRunner.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2
         ) AS ok`,
        [child, column],
      );
      if (!hasColumn[0]?.ok) {
        throw new Error(
          `RLS: ${child}.${column} does not exist, so ${child} would be left without tenant ` +
            `isolation. Fix the column name in this migration rather than dropping the row.`,
        );
      }

      const parentOwnsTenant: Array<{ ok: boolean }> = await queryRunner.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'organization_id'
         ) AS ok`,
        [parent],
      );

      const inner = parentOwnsTenant[0]?.ok
        ? await this.tenantPredicate(queryRunner, parent, alias)
        : await inheritedPredicate(parent, depth + 1);

      const childRef = depth === 0 ? `"${child}"` : `p${depth - 1}`;
      return `EXISTS (SELECT 1 FROM "${parent}" ${alias} WHERE ${alias}.id = ${childRef}.${fk} AND ${inner})`;
    };

    for (const [child] of inherited) {
      const exists: Array<{ ok: boolean }> = await queryRunner.query(
        `SELECT EXISTS (
           SELECT 1 FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = $1
         ) AS ok`,
        [child],
      );
      if (!exists[0]?.ok) continue;

      await this.protect(queryRunner, child, await inheritedPredicate(child));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const tables: string[] = await queryRunner
      .query(`SELECT tablename FROM pg_policies WHERE policyname = 'tenant_isolation'`)
      .then((rows: Array<{ tablename: string }>) => rows.map((r) => r.tablename));

    for (const table of tables) {
      await queryRunner.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await queryRunner.query(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
    }
    // The role is left in place: dropping it would fail while anything still holds grants through
    // it, and an unused role denies nobody anything.
  }
}

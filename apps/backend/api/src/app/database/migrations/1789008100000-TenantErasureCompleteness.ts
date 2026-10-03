import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a tenant deletes ALL of it.
 *
 * ## What was wrong
 *
 * Forty-three tables carry an `organization_id` that no constraint enforced. Among them: employees,
 * their compensation, payroll runs, payslips and their lines, leads, opportunities, cases, activity
 * history, projects and timesheets, approval requests, uploaded documents and journal attachments.
 * Deleting a tenant — the path offboarding and every privacy-erasure request (LGPD, GDPR-style
 * statutes, the platform's own offboarding promise) depend on — removed the organization and left
 * every one of those rows behind: names, national IDs, salaries, customer conversations, owned by
 * a tenant that no longer exists, invisible to every row-level-security policy and so impossible
 * for anyone to find, export or erase afterwards. `tenant-deletion.spec.ts` now seeds an employee
 * and proves this is closed; `every tenant table is owned by its tenant` keeps it closed.
 *
 * ## What changes
 *
 * 1. Each such table gains `organization_id → organizations ON DELETE CASCADE`.
 * 2. References BETWEEN tenant tables that were immediate `NO ACTION`/`RESTRICT` become
 *    `NO ACTION DEFERRABLE INITIALLY DEFERRED`: a customer with cases, a project with timesheets,
 *    a bill of materials that production orders use, a warehouse with bins, a customer group with
 *    members is still refused when deleted on its own — checked at commit — while the tenant's own
 *    delete, which removes both ends in one statement, is not defeated by the order PostgreSQL
 *    cascades in. (The full argument is in `ProtectReferencedMasterData1789007600000`.)
 * 3. A bill of materials' items are its own lines, and go with it (CASCADE), like every other
 *    document's lines.
 *
 * `audit_logs` is deliberately left alone: its `organization_id` is nullable because platform
 * events have no tenant, and what an erasure does to the audit trail is a retention decision of
 * its own, not a side effect of a foreign key.
 *
 * ## Tenant ids stored as text
 *
 * Nineteen of these tables kept `organization_id` as `varchar` — which is why no foreign key was
 * ever possible on them, and why their row-level-security policies compared
 * `organization_id::text`, a cast that stops PostgreSQL from using the tenant index on every
 * query those tables answer. The column becomes `uuid` (the policies, which PostgreSQL will not let
 * a column change type under, are recreated with the same predicate every other tenant table
 * uses). A value that is not a UUID stops the migration with the table named: that is corrupt
 * tenancy, and converting past it silently would hide which rows belonged to whom.
 *
 * ## Existing orphans
 *
 * Nothing is deleted here. Each tenant constraint is added `NOT VALID` — enforced, and cascading,
 * from now on — and validated only when no row points at a tenant that is already gone; otherwise
 * a NOTICE names the table so an operator can review those rows and validate it afterwards.
 */
export class TenantErasureCompleteness1789008100000 implements MigrationInterface {
  name = 'TenantErasureCompleteness1789008100000';

  static readonly TENANT_TABLES: readonly string[] = [
    'account_period_locks',
    'activities',
    'approval_policies',
    'approval_requests',
    'approval_step_actions',
    'bill_of_material_items',
    'bill_of_materials',
    'bin_locations',
    'cases',
    'cost_centers',
    'customer_groups',
    'document_nodes',
    'einvoice_provider_configs',
    'employee_compensations',
    'employees',
    'inflation_indices',
    'journal_entry_attachments',
    'journal_entry_sequences',
    'knowledge_base_articles',
    'landed_costs',
    'leads',
    'opportunities',
    'payroll_concepts',
    'payroll_inputs',
    'payroll_runs',
    'payslip_lines',
    'payslips',
    'production_orders',
    'project_tasks',
    'projects',
    'proposed_audit_adjustments',
    'purchase_order_lines',
    'purchase_requisition_lines',
    'recurring_journal_entries',
    'reports',
    'supplier_portal_users',
    'tax_categories',
    'tax_configurations',
    'tax_groups',
    'timesheets',
    'vendor_debit_note',
    'warehouses',
    'work_centers',
  ];

  /**
   * Tenant constraints that existed but did not cascade, so any tenant with a row in them could
   * not be deleted at all: every tenant that ever changed plan, every one that opened a datasheet.
   */
  static readonly NON_CASCADING_TENANT_TABLES: readonly string[] = [
    'organization_subscription_history',
    'datasheet_books',
  ];

  /** Tables whose tenant column was created as `varchar`. */
  static readonly TEXT_TENANT_TABLES: readonly string[] = [
    'activities',
    'approval_policies',
    'approval_requests',
    'cases',
    'cost_centers',
    'customer_groups',
    'einvoice_provider_configs',
    'inflation_indices',
    'journal_entry_attachments',
    'knowledge_base_articles',
    'leads',
    'opportunities',
    'proposed_audit_adjustments',
    'recurring_journal_entries',
    'reports',
    'tax_categories',
    'tax_configurations',
    'tax_groups',
    'vendor_debit_note',
  ];

  private static readonly PREDICATE = `organization_id = (NULLIF(current_setting('app.current_organization', true), ''))::uuid`;

  /** `[table, column, referenced table, action]` — edges between two tables a tenant owns. */
  static readonly INTERNAL_EDGES: ReadonlyArray<[string, string, string, 'DEFERRED' | 'CASCADE']> = [
    ['taxes', 'tax_group_id', 'tax_groups', 'DEFERRED'],
    ['bin_locations', 'warehouse_id', 'warehouses', 'DEFERRED'],
    ['customers', 'customer_group_id', 'customer_groups', 'DEFERRED'],
    ['opportunities', 'customer_id', 'customers', 'DEFERRED'],
    ['quotes', 'opportunity_id', 'opportunities', 'DEFERRED'],
    ['activities', 'customer_id', 'customers', 'DEFERRED'],
    ['cases', 'customer_id', 'customers', 'DEFERRED'],
    ['project_tasks', 'project_id', 'projects', 'DEFERRED'],
    ['timesheets', 'project_id', 'projects', 'DEFERRED'],
    ['timesheets', 'task_id', 'project_tasks', 'DEFERRED'],
    ['production_orders', 'bill_of_material_id', 'bill_of_materials', 'DEFERRED'],
    ['product_categories', 'parent_id', 'product_categories', 'DEFERRED'],
    ['bill_of_material_items', 'bill_of_material_id', 'bill_of_materials', 'CASCADE'],
  ];

  public async up(q: QueryRunner): Promise<void> {
    for (const table of TenantErasureCompleteness1789008100000.TEXT_TENANT_TABLES) {
      if (!(await q.hasTable(table))) continue;
      const type: Array<{ data_type: string }> = await q.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = current_schema() AND table_name = $1 AND column_name = 'organization_id'`,
        [table],
      );
      if (type[0]?.data_type === 'uuid') continue;
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "${table}"
             WHERE "organization_id" !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          ) THEN
            RAISE EXCEPTION '${table}.organization_id holds values that are not tenant ids; review them before migrating';
          END IF;
        END $$;
      `);
      // Every policy that reads this column — the table's own and those of child tables that
      // reach it through a subquery — has to be lifted for the type change and put back after.
      const dependents = await this.policiesReading(q, table);
      for (const policy of dependents) {
        await q.query(`DROP POLICY "${policy.name}" ON "${policy.table}"`);
      }
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid`);
      for (const policy of dependents) {
        if (policy.table === table && policy.name === 'tenant_isolation') {
          await q.query(`
            CREATE POLICY tenant_isolation ON "${table}"
              USING (${TenantErasureCompleteness1789008100000.PREDICATE})
              WITH CHECK (${TenantErasureCompleteness1789008100000.PREDICATE})
          `);
        } else {
          await q.query(policy.definition);
        }
      }
    }

    for (const table of TenantErasureCompleteness1789008100000.TENANT_TABLES) {
      if (!(await q.hasTable(table))) continue;
      const constraint = `FK_${table}_organization`;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${constraint}"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
          NOT VALID
      `);
      await q.query(`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM "${table}" t
             WHERE NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = t."organization_id")
          ) THEN
            RAISE NOTICE '${table}: rows reference organizations that no longer exist; "${constraint}" left NOT VALID until they are reviewed.';
          ELSE
            ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}";
          END IF;
        END $$;
      `);
    }

    for (const table of TenantErasureCompleteness1789008100000.NON_CASCADING_TENANT_TABLES) {
      const name = await this.constraintOn(q, table, 'organization_id', 'organizations');
      if (!name) continue;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${name}"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
          ON DELETE CASCADE ON UPDATE NO ACTION
      `);
    }

    for (const [table, column, references, action] of TenantErasureCompleteness1789008100000.INTERNAL_EDGES) {
      const name = await this.constraintOn(q, table, column, references);
      if (!name) continue;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${name}"
          FOREIGN KEY ("${column}") REFERENCES "${references}"("id")
          ${action === 'CASCADE' ? 'ON DELETE CASCADE ON UPDATE NO ACTION' : 'ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED'}
      `);
    }
  }

  public async down(q: QueryRunner): Promise<void> {
    for (const table of TenantErasureCompleteness1789008100000.NON_CASCADING_TENANT_TABLES) {
      const name = await this.constraintOn(q, table, 'organization_id', 'organizations');
      if (!name) continue;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${name}"
          FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
          ON DELETE NO ACTION ON UPDATE NO ACTION
      `);
    }
    for (const [table, column, references] of TenantErasureCompleteness1789008100000.INTERNAL_EDGES) {
      const name = await this.constraintOn(q, table, column, references);
      if (!name) continue;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT "${name}"`);
      const onDelete = table === 'product_categories' ? 'RESTRICT' : 'NO ACTION';
      await q.query(`
        ALTER TABLE "${table}"
          ADD CONSTRAINT "${name}"
          FOREIGN KEY ("${column}") REFERENCES "${references}"("id")
          ON DELETE ${onDelete} ON UPDATE NO ACTION
      `);
    }
    for (const table of TenantErasureCompleteness1789008100000.TENANT_TABLES) {
      if (!(await q.hasTable(table))) continue;
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_organization"`);
    }
    const legacy = `(organization_id)::text = NULLIF(current_setting('app.current_organization', true), '')`;
    for (const table of TenantErasureCompleteness1789008100000.TEXT_TENANT_TABLES) {
      if (!(await q.hasTable(table))) continue;
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`ALTER TABLE "${table}" ALTER COLUMN "organization_id" TYPE character varying USING "organization_id"::text`);
      await q.query(`CREATE POLICY tenant_isolation ON "${table}" USING (${legacy}) WITH CHECK (${legacy})`);
    }
  }

  /**
   * The policies that depend on `table.organization_id`, each with the statement that recreates it
   * exactly as it was (command, permissiveness, roles, both expressions).
   */
  private async policiesReading(
    q: QueryRunner,
    table: string,
  ): Promise<Array<{ table: string; name: string; definition: string }>> {
    const rows: Array<{
      table: string;
      name: string;
      permissive: string;
      cmd: string;
      roles: string[] | string;
      qual: string | null;
      with_check: string | null;
    }> = await q.query(
      `SELECT DISTINCT p.tablename AS table, p.policyname AS name, p.permissive, p.cmd, p.roles,
              p.qual, p.with_check
         FROM pg_depend d
         JOIN pg_policy pol ON pol.oid = d.objid
         JOIN pg_class c ON c.oid = pol.polrelid
         JOIN pg_policies p ON p.tablename = c.relname AND p.policyname = pol.polname
                           AND p.schemaname = current_schema()
         JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
        WHERE d.classid = 'pg_policy'::regclass
          AND d.refobjid = to_regclass($1)
          AND a.attname = 'organization_id'`,
      [`"${table}"`],
    );
    return rows.map((row) => {
      const roles = Array.isArray(row.roles)
        ? row.roles
        : String(row.roles).replace(/^\{|\}$/g, '').split(',').filter(Boolean);
      const to = roles.length ? roles.map((role) => (role === 'public' ? 'PUBLIC' : `"${role}"`)).join(', ') : 'PUBLIC';
      return {
        table: row.table,
        name: row.name,
        definition:
          `CREATE POLICY "${row.name}" ON "${row.table}" AS ${row.permissive} FOR ${row.cmd} TO ${to}` +
          (row.qual ? ` USING (${row.qual})` : '') +
          (row.with_check ? ` WITH CHECK (${row.with_check})` : ''),
      };
    });
  }

  /** The existing constraint's name, kept so the entity (TypeORM's derived name) still matches. */
  private async constraintOn(
    q: QueryRunner,
    table: string,
    column: string,
    references: string,
  ): Promise<string | null> {
    const rows: Array<{ name: string }> = await q.query(
      `SELECT k.conname AS name
         FROM pg_constraint k
         JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attnum = ANY (k.conkey)
        WHERE k.contype = 'f'
          AND k.conrelid = to_regclass($1)
          AND k.confrelid = to_regclass($2)
          AND a.attname = $3`,
      [`"${table}"`, `"${references}"`, column],
    );
    return rows[0]?.name ?? null;
  }
}

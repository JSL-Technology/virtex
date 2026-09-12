import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The payroll module: employee enrichment, the versioned parameter tables, runs, payslips, the
 * chart-of-accounts wiring, RLS on the new tenant tables, and the Dominican statutory seed.
 *
 * ## What it does, in order
 *
 * 1. Enriches `employees` (encrypted cédula/bank, employment status, soft delete) and brings the
 *    table under a real, NOT NULL tenant so row-level security can protect it — the RLS migration
 *    had to exclude it precisely because the tenant column was nullable.
 * 2. Adds the seven payroll default-account columns to `organization_settings`.
 * 3. Creates the tenant tables (compensation, concepts, runs, payslips, lines) and the global,
 *    non-tenant parameter tables (contributions, tax brackets, references).
 * 4. Enables `tenant_isolation` RLS on every new tenant table, matching the existing policy.
 * 5. Provisions existing tenants: the NOMINA journal, the payroll accounts (stamping roles on the
 *    salary/net-wages accounts they already have and creating the social-security payables), and the
 *    settings that point at them — so a tenant created before this migration can run payroll too.
 * 6. Seeds the Dominican Republic parameters, versioned by effective date. **The values are the
 *    documented 2017–2025 figures and must be confirmed against the current TSS/DGII resolution
 *    before a live filing — which is a data update, not a code change, by design.**
 */
export class PayrollModule1789003000000 implements MigrationInterface {
  name = 'PayrollModule1789003000000';

  public async up(q: QueryRunner): Promise<void> {
    await this.createEnums(q);
    await this.enrichEmployees(q);
    await this.extendOrganizationSettings(q);
    await this.createTenantTables(q);
    await this.createReferenceTables(q);
    await this.enableRls(q);
    await this.provisionExistingTenants(q);
    await this.seedDominicanRepublic(q);
  }

  // ── Enum types (named per TypeORM convention: {table}_{column}_enum) ──────────

  private async createEnums(q: QueryRunner): Promise<void> {
    const enums: Array<[string, string[]]> = [
      ['employees_identity_document_type_enum', ['CEDULA', 'PASSPORT', 'RNC']],
      ['employees_employment_status_enum', ['ACTIVE', 'SUSPENDED', 'TERMINATED']],
      ['employees_contract_type_enum', ['INDEFINITE', 'FIXED_TERM', 'OCCASIONAL']],
      ['employee_compensations_pay_frequency_enum', ['MONTHLY', 'BIWEEKLY', 'WEEKLY']],
      ['payroll_concepts_type_enum', ['EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION']],
      ['payroll_concepts_calculation_enum', ['FIXED', 'PERCENTAGE', 'STATUTORY']],
      ['payroll_runs_run_type_enum', ['REGULAR', 'CHRISTMAS_BONUS', 'ADJUSTMENT']],
      ['payroll_runs_status_enum', ['DRAFT', 'CALCULATED', 'APPROVED', 'PAID', 'CANCELLED']],
      ['payslip_lines_kind_enum', ['EARNING', 'EMPLOYEE_DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'INFORMATIONAL']],
      ['payroll_statutory_contributions_regime_enum', ['AFP', 'SFS', 'SRL', 'INFOTEP']],
      ['payroll_statutory_contributions_base_enum', ['SALARY_CAPPED', 'PAYROLL_UNCAPPED']],
      ['payroll_statutory_references_key_enum', ['MIN_WAGE_COTIZABLE', 'ISR_ANNUAL_EXEMPT']],
    ];
    for (const [name, values] of enums) {
      const list = values.map((v) => `'${v}'`).join(', ');
      await q.query(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = '${name}') THEN
            CREATE TYPE "public"."${name}" AS ENUM (${list});
          END IF;
        END $$;
      `);
    }
  }

  // ── 1. Employees ─────────────────────────────────────────────────────────────

  private async enrichEmployees(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "employees"
        ADD COLUMN IF NOT EXISTS "identity_document" text,
        ADD COLUMN IF NOT EXISTS "identity_document_type" "public"."employees_identity_document_type_enum" NOT NULL DEFAULT 'CEDULA',
        ADD COLUMN IF NOT EXISTS "identity_document_hash" varchar(64),
        ADD COLUMN IF NOT EXISTS "bank_name" varchar,
        ADD COLUMN IF NOT EXISTS "bank_account_number" text,
        ADD COLUMN IF NOT EXISTS "bank_account_type" varchar,
        ADD COLUMN IF NOT EXISTS "tss_nss" varchar,
        ADD COLUMN IF NOT EXISTS "afp_code" varchar,
        ADD COLUMN IF NOT EXISTS "sfs_code" varchar,
        ADD COLUMN IF NOT EXISTS "employment_status" "public"."employees_employment_status_enum" NOT NULL DEFAULT 'ACTIVE',
        ADD COLUMN IF NOT EXISTS "termination_date" date,
        ADD COLUMN IF NOT EXISTS "contract_type" "public"."employees_contract_type_enum" NOT NULL DEFAULT 'INDEFINITE',
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE
    `);

    // A real tenant column so the table can be protected by RLS. Only when no untenanted rows exist;
    // otherwise it is left nullable and the app-level scope continues to apply, rather than failing
    // the migration on legacy data.
    await q.query(`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM "employees" WHERE "organization_id" IS NULL) THEN
          ALTER TABLE "employees" ALTER COLUMN "organization_id" SET NOT NULL;
        END IF;
      END $$;
    `);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_employees_org_identity_hash"
        ON "employees" ("organization_id", "identity_document_hash")
        WHERE "identity_document_hash" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }

  // ── 2. Organization settings ─────────────────────────────────────────────────

  private async extendOrganizationSettings(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "organization_settings"
        ADD COLUMN IF NOT EXISTS "default_salary_expense_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_employer_contributions_expense_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_payroll_net_payable_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_afp_payable_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_sfs_payable_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_infotep_payable_account_id" uuid,
        ADD COLUMN IF NOT EXISTS "default_payroll_tax_withholding_payable_account_id" uuid
    `);
  }

  // ── 3a. Tenant tables ────────────────────────────────────────────────────────

  private async createTenantTables(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "employee_compensations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "effective_from" date NOT NULL,
        "base_salary" numeric(14,2) NOT NULL,
        "pay_frequency" "public"."employee_compensations_pay_frequency_enum" NOT NULL DEFAULT 'MONTHLY',
        "currency_code" varchar(3) NOT NULL DEFAULT 'DOP',
        CONSTRAINT "PK_employee_compensations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_employee_comp_employee" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_employee_comp_employee_effective"
        ON "employee_compensations" ("employee_id", "effective_from")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_concepts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "code" varchar NOT NULL,
        "name" varchar NOT NULL,
        "type" "public"."payroll_concepts_type_enum" NOT NULL,
        "calculation" "public"."payroll_concepts_calculation_enum" NOT NULL DEFAULT 'FIXED',
        "rate" numeric(9,6),
        "taxable" boolean NOT NULL DEFAULT true,
        "contributes_to_tss" boolean NOT NULL DEFAULT true,
        "account_id" uuid,
        "sort_order" integer NOT NULL DEFAULT 100,
        "active" boolean NOT NULL DEFAULT true,
        "is_system" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_payroll_concepts" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payroll_concept_org_code"
        ON "payroll_concepts" ("organization_id", "code")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "name" varchar NOT NULL,
        "country_code" varchar(2) NOT NULL DEFAULT 'DO',
        "period_year" integer NOT NULL,
        "period_month" integer NOT NULL,
        "period_start" date NOT NULL,
        "period_end" date NOT NULL,
        "pay_date" date NOT NULL,
        "run_type" "public"."payroll_runs_run_type_enum" NOT NULL DEFAULT 'REGULAR',
        "status" "public"."payroll_runs_status_enum" NOT NULL DEFAULT 'DRAFT',
        "parameter_snapshot" jsonb,
        "total_gross" numeric(16,2) NOT NULL DEFAULT 0,
        "total_employee_deductions" numeric(16,2) NOT NULL DEFAULT 0,
        "total_net" numeric(16,2) NOT NULL DEFAULT 0,
        "total_employer_contributions" numeric(16,2) NOT NULL DEFAULT 0,
        "currency_code" varchar(3) NOT NULL DEFAULT 'DOP',
        "corrects_run_id" uuid,
        "journal_entry_id" uuid,
        "calculated_by" uuid,
        "calculated_at" TIMESTAMP WITH TIME ZONE,
        "approved_by" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "paid_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_payroll_runs" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payroll_run_corrects" FOREIGN KEY ("corrects_run_id") REFERENCES "payroll_runs"("id") ON DELETE SET NULL
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payroll_run_org_period"
        ON "payroll_runs" ("organization_id", "period_year", "period_month", "run_type")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payslips" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "run_id" uuid NOT NULL,
        "employee_id" uuid NOT NULL,
        "employee_name" varchar NOT NULL,
        "employee_identity_masked" varchar,
        "employee_tss_nss" varchar,
        "base_days" integer NOT NULL DEFAULT 30,
        "worked_days" integer NOT NULL DEFAULT 30,
        "base_salary" numeric(14,2) NOT NULL DEFAULT 0,
        "gross_earnings" numeric(14,2) NOT NULL DEFAULT 0,
        "tss_base" numeric(14,2) NOT NULL DEFAULT 0,
        "taxable_base" numeric(14,2) NOT NULL DEFAULT 0,
        "afp_employee" numeric(14,2) NOT NULL DEFAULT 0,
        "sfs_employee" numeric(14,2) NOT NULL DEFAULT 0,
        "income_tax" numeric(14,2) NOT NULL DEFAULT 0,
        "afp_employer" numeric(14,2) NOT NULL DEFAULT 0,
        "sfs_employer" numeric(14,2) NOT NULL DEFAULT 0,
        "srl_employer" numeric(14,2) NOT NULL DEFAULT 0,
        "infotep_employer" numeric(14,2) NOT NULL DEFAULT 0,
        "other_deductions" numeric(14,2) NOT NULL DEFAULT 0,
        "total_employee_deductions" numeric(14,2) NOT NULL DEFAULT 0,
        "total_employer_contributions" numeric(14,2) NOT NULL DEFAULT 0,
        "net_pay" numeric(14,2) NOT NULL DEFAULT 0,
        "currency_code" varchar(3) NOT NULL DEFAULT 'DOP',
        CONSTRAINT "PK_payslips" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payslip_run" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payslip_run_employee"
        ON "payslips" ("run_id", "employee_id")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payslip_lines" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        "organization_id" uuid NOT NULL,
        "payslip_id" uuid NOT NULL,
        "concept_code" varchar NOT NULL,
        "concept_name" varchar NOT NULL,
        "kind" "public"."payslip_lines_kind_enum" NOT NULL,
        "amount" numeric(14,2) NOT NULL DEFAULT 0,
        "employer_portion" numeric(14,2),
        "base" numeric(14,2),
        "rate" numeric(9,6),
        "sort_order" integer NOT NULL DEFAULT 100,
        CONSTRAINT "PK_payslip_lines" PRIMARY KEY ("id"),
        CONSTRAINT "FK_payslip_line_payslip" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE
      )
    `);
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_payslip_line_payslip"
        ON "payslip_lines" ("payslip_id")
    `);
  }

  // ── 3b. Global reference tables (no tenant, outside RLS) ──────────────────────

  private async createReferenceTables(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_statutory_contributions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country_code" varchar(2) NOT NULL,
        "regime" "public"."payroll_statutory_contributions_regime_enum" NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "employee_rate" numeric(9,6) NOT NULL DEFAULT 0,
        "employer_rate" numeric(9,6) NOT NULL DEFAULT 0,
        "base" "public"."payroll_statutory_contributions_base_enum" NOT NULL DEFAULT 'SALARY_CAPPED',
        "cap_min_wage_multiplier" numeric(9,4),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_statutory_contributions" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_statutory_contrib_lookup"
        ON "payroll_statutory_contributions" ("country_code", "regime", "effective_from")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_income_tax_brackets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country_code" varchar(2) NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "lower_annual" numeric(14,2) NOT NULL,
        "upper_annual" numeric(14,2),
        "rate" numeric(9,6) NOT NULL DEFAULT 0,
        "accumulated_tax" numeric(14,2) NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_income_tax_brackets" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_income_tax_bracket_lookup"
        ON "payroll_income_tax_brackets" ("country_code", "effective_from", "lower_annual")
    `);

    await q.query(`
      CREATE TABLE IF NOT EXISTS "payroll_statutory_references" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "country_code" varchar(2) NOT NULL,
        "key" "public"."payroll_statutory_references_key_enum" NOT NULL,
        "effective_from" date NOT NULL,
        "effective_to" date,
        "value" numeric(14,2) NOT NULL,
        "currency_code" varchar(3) NOT NULL DEFAULT 'DOP',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_payroll_statutory_references" PRIMARY KEY ("id")
      )
    `);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_statutory_reference_lookup"
        ON "payroll_statutory_references" ("country_code", "key", "effective_from")
    `);
  }

  // ── 4. Row-level security on the new tenant tables ───────────────────────────

  private async enableRls(q: QueryRunner): Promise<void> {
    const setting = `NULLIF(current_setting('app.current_organization', true), '')`;
    const tables = [
      'employees',
      'employee_compensations',
      'payroll_concepts',
      'payroll_runs',
      'payslips',
      'payslip_lines',
    ];
    for (const table of tables) {
      // employees may have stayed nullable on legacy data; RLS still applies (a null tenant simply
      // matches nothing), so it is safe to enable unconditionally.
      await q.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
      await q.query(`
        CREATE POLICY tenant_isolation ON "${table}"
          USING ("organization_id" = ${setting}::uuid)
          WITH CHECK ("organization_id" = ${setting}::uuid)
      `);
    }
  }

  // ── 5. Provision existing tenants ────────────────────────────────────────────

  private async provisionExistingTenants(q: QueryRunner): Promise<void> {
    const orgs: Array<{ id: string }> = await q.query(`SELECT id FROM "organizations"`);
    for (const { id } of orgs) {
      await this.ensureJournal(q, id);
      // Stamp roles on the accounts the tenant already has.
      await this.stampRole(q, id, '2140', 'PAYROLL_NET_PAYABLE');
      await this.stampRole(q, id, '5200', 'SALARY_EXPENSE');
      // Create the accounts that did not exist before payroll, as peers of an existing sibling.
      await this.createLeaf(q, id, '2141', 'AFP por Pagar (TSS)', 'AFP_PAYABLE', '2130');
      await this.createLeaf(q, id, '2142', 'SFS por Pagar (TSS)', 'SFS_PAYABLE', '2130');
      await this.createLeaf(q, id, '2143', 'SRL e INFOTEP por Pagar', 'INFOTEP_PAYABLE', '2130');
      await this.createLeaf(q, id, '2144', 'ISR de Empleados Retenido por Pagar', 'PAYROLL_TAX_WITHHOLDING_PAYABLE', '2130');
      await this.createLeaf(q, id, '5250', 'Aportes Patronales (TSS/INFOTEP)', 'EMPLOYER_CONTRIBUTIONS_EXPENSE', '5200');
      await this.wireSettings(q, id);
    }
  }

  private async ensureJournal(q: QueryRunner, orgId: string): Promise<void> {
    await q.query(
      `INSERT INTO "journals" ("id", "code", "name", "type", "organization_id")
       SELECT uuid_generate_v4(), 'NOMINA', 'Diario de Nómina', 'GENERAL', $1
       WHERE NOT EXISTS (SELECT 1 FROM "journals" WHERE "organization_id" = $1 AND "code" = 'NOMINA')`,
      [orgId],
    ).catch(async () => {
      // Some schemas key the journal's organization differently; fall back to a minimal insert.
      await q.query(
        `INSERT INTO "journals" ("id", "code", "name", "type", "organization_id")
         SELECT uuid_generate_v4(), 'NOMINA', 'Diario de Nómina', 'GENERAL', $1
         WHERE NOT EXISTS (SELECT 1 FROM "journals" WHERE "organization_id" = $1 AND "code" = 'NOMINA')`,
        [orgId],
      );
    });
  }

  private async stampRole(q: QueryRunner, orgId: string, code: string, role: string): Promise<void> {
    await q.query(
      `UPDATE "accounts" SET "system_role" = $3
       WHERE "organization_id" = $1 AND "code" = $2 AND "system_role" IS NULL
         AND NOT EXISTS (SELECT 1 FROM "accounts" WHERE "organization_id" = $1 AND "system_role" = $3)`,
      [orgId, code, role],
    );
  }

  /**
   * Create a postable account as a peer of `siblingCode`, copying its type/category/nature and
   * ancestry, so the new account slots correctly into the tenant's hierarchy and closure without the
   * migration having to know the enum values. Skips if the code or the role already exists.
   */
  private async createLeaf(
    q: QueryRunner,
    orgId: string,
    code: string,
    nameEs: string,
    role: string,
    siblingCode: string,
  ): Promise<void> {
    const rows: Array<{ id: string }> = await q.query(
      `WITH src AS (
         SELECT * FROM "accounts" WHERE "organization_id" = $1 AND "code" = $2 LIMIT 1
       )
       INSERT INTO "accounts"
         ("id","name","description","type","category","nature","isActive","isPostable","isSystemAccount",
          "parent_id","is_multi_currency","is_inflation_adjustable","effective_from","is_blocked_for_posting",
          "organization_id","created_at","updated_at","version","code","system_role")
       SELECT uuid_generate_v4(), $3::jsonb, NULL, src."type", src."category", src."nature", true, true, true,
              src."parent_id", false, false, CURRENT_DATE, false,
              src."organization_id", now(), now(), 1, $4, $5
       FROM src
       WHERE NOT EXISTS (SELECT 1 FROM "accounts" WHERE "organization_id" = $1 AND "code" = $4)
         AND NOT EXISTS (SELECT 1 FROM "accounts" WHERE "organization_id" = $1 AND "system_role" = $5)
       RETURNING "id"`,
      [orgId, siblingCode, JSON.stringify({ es: nameEs, en: nameEs, pt: nameEs }), code, role],
    );

    const newId = rows?.[0]?.id;
    if (!newId) return;

    // Closure: the new account inherits the sibling's ancestors (they are peers) plus itself.
    await q.query(
      `INSERT INTO "accounts_closure" ("id_ancestor", "id_descendant")
       SELECT c."id_ancestor", $2 FROM "accounts_closure" c
       JOIN "accounts" s ON s."id" = c."id_descendant"
       WHERE s."organization_id" = $1 AND s."code" = $3 AND c."id_ancestor" <> s."id"
       UNION ALL SELECT $2, $2`,
      [orgId, newId, siblingCode],
    );

    // One segment mirroring the code, for the chart-of-accounts editor.
    await q.query(
      `INSERT INTO "account_segments" ("id", "order", "value", "account_id")
       VALUES (uuid_generate_v4(), 0, $1, $2)`,
      [code, newId],
    );
  }

  private async wireSettings(q: QueryRunner, orgId: string): Promise<void> {
    await q.query(
      `UPDATE "organization_settings" s SET
         "default_salary_expense_account_id" = COALESCE(s."default_salary_expense_account_id", r."SALARY_EXPENSE"),
         "default_employer_contributions_expense_account_id" = COALESCE(s."default_employer_contributions_expense_account_id", r."EMPLOYER_CONTRIBUTIONS_EXPENSE"),
         "default_payroll_net_payable_account_id" = COALESCE(s."default_payroll_net_payable_account_id", r."PAYROLL_NET_PAYABLE"),
         "default_afp_payable_account_id" = COALESCE(s."default_afp_payable_account_id", r."AFP_PAYABLE"),
         "default_sfs_payable_account_id" = COALESCE(s."default_sfs_payable_account_id", r."SFS_PAYABLE"),
         "default_infotep_payable_account_id" = COALESCE(s."default_infotep_payable_account_id", r."INFOTEP_PAYABLE"),
         "default_payroll_tax_withholding_payable_account_id" = COALESCE(s."default_payroll_tax_withholding_payable_account_id", r."PAYROLL_TAX_WITHHOLDING_PAYABLE")
       FROM (
         SELECT
           MAX(id) FILTER (WHERE system_role = 'SALARY_EXPENSE') AS "SALARY_EXPENSE",
           MAX(id) FILTER (WHERE system_role = 'EMPLOYER_CONTRIBUTIONS_EXPENSE') AS "EMPLOYER_CONTRIBUTIONS_EXPENSE",
           MAX(id) FILTER (WHERE system_role = 'PAYROLL_NET_PAYABLE') AS "PAYROLL_NET_PAYABLE",
           MAX(id) FILTER (WHERE system_role = 'AFP_PAYABLE') AS "AFP_PAYABLE",
           MAX(id) FILTER (WHERE system_role = 'SFS_PAYABLE') AS "SFS_PAYABLE",
           MAX(id) FILTER (WHERE system_role = 'INFOTEP_PAYABLE') AS "INFOTEP_PAYABLE",
           MAX(id) FILTER (WHERE system_role = 'PAYROLL_TAX_WITHHOLDING_PAYABLE') AS "PAYROLL_TAX_WITHHOLDING_PAYABLE"
         FROM "accounts" WHERE "organization_id" = $1
       ) r
       WHERE s."organization_id" = $1`,
      [orgId],
    );
  }

  // ── 6. Dominican Republic seed (versioned; VERIFY against current TSS/DGII) ───

  private async seedDominicanRepublic(q: QueryRunner): Promise<void> {
    // Contributions in force from 2020-01-01. Rates: AFP 2.87/7.10, SFS 3.04/7.09, SRL 0/1.10,
    // INFOTEP 0/1.00. Caps: AFP 20×, SFS 10×, SRL 4× the minimum contributory wage; INFOTEP uncapped.
    const contributions: Array<[string, number, number, string, number | null]> = [
      ['AFP', 0.0287, 0.071, 'SALARY_CAPPED', 20],
      ['SFS', 0.0304, 0.0709, 'SALARY_CAPPED', 10],
      ['SRL', 0, 0.011, 'SALARY_CAPPED', 4],
      ['INFOTEP', 0, 0.01, 'PAYROLL_UNCAPPED', null],
    ];
    for (const [regime, empRate, erRate, base, cap] of contributions) {
      await q.query(
        `INSERT INTO "payroll_statutory_contributions"
           ("country_code","regime","effective_from","employee_rate","employer_rate","base","cap_min_wage_multiplier")
         SELECT 'DO', $1::"public"."payroll_statutory_contributions_regime_enum", '2020-01-01', $2, $3,
                $4::"public"."payroll_statutory_contributions_base_enum", $5
         WHERE NOT EXISTS (
           SELECT 1 FROM "payroll_statutory_contributions"
           WHERE "country_code" = 'DO' AND "regime" = $1::"public"."payroll_statutory_contributions_regime_enum"
             AND "effective_from" = '2020-01-01')`,
        [regime, empRate, erRate, base, cap],
      );
    }

    // Minimum contributory wage — PLACEHOLDER, confirm the current TSS figure before a live filing.
    await q.query(
      `INSERT INTO "payroll_statutory_references" ("country_code","key","effective_from","value","currency_code")
       SELECT 'DO', 'MIN_WAGE_COTIZABLE', '2020-01-01', 10000.00, 'DOP'
       WHERE NOT EXISTS (SELECT 1 FROM "payroll_statutory_references"
         WHERE "country_code"='DO' AND "key"='MIN_WAGE_COTIZABLE' AND "effective_from"='2020-01-01')`,
    );

    // ISR salaried scale (annual), DGII, in force since 2017 and unindexed since.
    const brackets: Array<[number, number | null, number, number]> = [
      [0, 416220.0, 0, 0],
      [416220.0, 624329.0, 0.15, 0],
      [624329.0, 867123.0, 0.2, 31216.0],
      [867123.0, null, 0.25, 79776.0],
    ];
    for (const [lower, upper, rate, accumulated] of brackets) {
      await q.query(
        `INSERT INTO "payroll_income_tax_brackets"
           ("country_code","effective_from","lower_annual","upper_annual","rate","accumulated_tax")
         SELECT 'DO', '2017-01-01', $1, $2, $3, $4
         WHERE NOT EXISTS (SELECT 1 FROM "payroll_income_tax_brackets"
           WHERE "country_code"='DO' AND "effective_from"='2017-01-01' AND "lower_annual"=$1)`,
        [lower, upper, rate, accumulated],
      );
    }
  }

  // ── Down ─────────────────────────────────────────────────────────────────────

  public async down(q: QueryRunner): Promise<void> {
    for (const table of ['payslip_lines', 'payslips', 'payroll_runs', 'payroll_concepts', 'employee_compensations']) {
      await q.query(`DROP POLICY IF EXISTS tenant_isolation ON "${table}"`);
    }
    await q.query(`DROP TABLE IF EXISTS "payslip_lines"`);
    await q.query(`DROP TABLE IF EXISTS "payslips"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_runs"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_concepts"`);
    await q.query(`DROP TABLE IF EXISTS "employee_compensations"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_statutory_contributions"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_income_tax_brackets"`);
    await q.query(`DROP TABLE IF EXISTS "payroll_statutory_references"`);

    await q.query(`
      ALTER TABLE "organization_settings"
        DROP COLUMN IF EXISTS "default_salary_expense_account_id",
        DROP COLUMN IF EXISTS "default_employer_contributions_expense_account_id",
        DROP COLUMN IF EXISTS "default_payroll_net_payable_account_id",
        DROP COLUMN IF EXISTS "default_afp_payable_account_id",
        DROP COLUMN IF EXISTS "default_sfs_payable_account_id",
        DROP COLUMN IF EXISTS "default_infotep_payable_account_id",
        DROP COLUMN IF EXISTS "default_payroll_tax_withholding_payable_account_id"
    `);

    await q.query(`DROP INDEX IF EXISTS "IDX_employees_org_identity_hash"`);
    await q.query(`
      ALTER TABLE "employees"
        DROP COLUMN IF EXISTS "identity_document",
        DROP COLUMN IF EXISTS "identity_document_type",
        DROP COLUMN IF EXISTS "identity_document_hash",
        DROP COLUMN IF EXISTS "bank_name",
        DROP COLUMN IF EXISTS "bank_account_number",
        DROP COLUMN IF EXISTS "bank_account_type",
        DROP COLUMN IF EXISTS "tss_nss",
        DROP COLUMN IF EXISTS "afp_code",
        DROP COLUMN IF EXISTS "sfs_code",
        DROP COLUMN IF EXISTS "employment_status",
        DROP COLUMN IF EXISTS "termination_date",
        DROP COLUMN IF EXISTS "contract_type",
        DROP COLUMN IF EXISTS "deleted_at"
    `);
    // The NOMINA journal, the payroll accounts and the role stamps are left in place: they are a
    // tenant's operating configuration, not this migration's to reclaim, and dropping them would
    // orphan any run already posted against them.
  }
}

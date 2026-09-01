import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foreign-key names TypeORM derives for each tenant relation. Stated explicitly so the migration
 * creates exactly the constraint the entity model expects, and the schema-drift gate stays quiet.
 */
const TENANT_FK_NAMES: Readonly<Record<string, string>> = {
  journals: 'FK_d38cfe56fcaa0be96a986adc354',
  accounting_periods: 'FK_09345bf541c4739d3cb1f8031e4',
  ncf_sequences: 'FK_6cc063ba9a36272d0061b2413c2',
  ecf_submissions: 'FK_7a77ed83594a19dbb3d5f0c7d41',
  ecf_certificates: 'FK_69e9d6b000e0dc1dc9e232add15',
  quotes: 'FK_7b97bd191d680f9e37bf22899d2',
  fiscal_years: 'FK_dc2f05776164673c7e54e10d676',
  ledger_mapping_rules: 'FK_e69aa572146fa55c04353806d84',
};

/**
 * The invoicing overhaul: a tenant that can actually issue a compliant fiscal document.
 *
 * ## Why this is one migration and not ten
 *
 * The changes below are not independent. A sale cannot post to the ledger without the accounts the
 * settings point at; the settings cannot be derived without the account roles; the fiscal reports
 * cannot be produced without the goods/services split on the document; and the unique index on the
 * fiscal number cannot be created until the duplicates it would reject are impossible to create.
 * Applying a subset leaves the product in a state where issuing an invoice fails in a new way.
 *
 * ## It preserves data
 *
 * The generated migration wanted to `DROP COLUMN "quantity"` and re-add it with a different type,
 * and to drop `"customerId"` before anything had copied it into `customer_id`. Both destroy live
 * invoices. Every type change here is an `ALTER … TYPE` with an explicit `USING`, every new
 * not-null column is backfilled from the data already present, and the duplicate customer column is
 * copied before it is removed.
 *
 * ## It backfills existing tenants
 *
 * Organizations created before this migration have a chart of accounts and nothing else — no
 * settings, no ledger, no journals, no document sequences, no periods — which is why not one of
 * them could issue an invoice. The final section provisions all of it from the chart they already
 * have, so an existing customer is able to invoice the moment this deploys rather than after
 * someone runs a script.
 */
export class InvoicingOverhaul1788500000000 implements MigrationInterface {
  name = 'InvoicingOverhaul1788500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.referenceData(queryRunner);
    await this.accountRoles(queryRunner);
    await this.organizationColumns(queryRunner);
    await this.productColumns(queryRunner);
    await this.supplierColumns(queryRunner);
    await this.invoiceColumns(queryRunner);
    await this.invoiceLineColumns(queryRunner);
    await this.vendorBillColumns(queryRunner);
    await this.fiscalSequenceColumns(queryRunner);
    await this.ecfTimestamps(queryRunner);
    await this.normalizeTenantColumnTypes(queryRunner);
    await this.backfillInvoiceTotals(queryRunner);
    await this.constraintsAndIndexes(queryRunner);
    await this.provisionExistingTenants(queryRunner);
  }

  // ── Reference data ─────────────────────────────────────────────────────────

  /**
   * `currency` is referenced by a foreign key from `invoices`, `vendor_bills` and `quotes`, and was
   * empty in every environment: the first invoice a tenant tried to issue violated the constraint.
   */
  private async referenceData(q: QueryRunner): Promise<void> {
    const currencies: Array<[string, string, string]> = [
      ['DOP', 'Peso dominicano', 'RD$'],
      ['USD', 'Dólar estadounidense', 'US$'],
      ['EUR', 'Euro', '€'],
      ['MXN', 'Peso mexicano', 'MX$'],
      ['COP', 'Peso colombiano', 'CO$'],
      ['CLP', 'Peso chileno', 'CL$'],
      ['PEN', 'Sol peruano', 'S/'],
      ['ARS', 'Peso argentino', 'AR$'],
      ['BRL', 'Real brasileño', 'R$'],
      ['UYU', 'Peso uruguayo', '$U'],
      ['PYG', 'Guaraní paraguayo', '₲'],
      ['BOB', 'Boliviano', 'Bs'],
      ['VES', 'Bolívar venezolano', 'Bs.'],
      ['PAB', 'Balboa panameño', 'B/.'],
      ['CRC', 'Colón costarricense', '₡'],
      ['GTQ', 'Quetzal guatemalteco', 'Q'],
      ['HNL', 'Lempira hondureño', 'L'],
      ['NIO', 'Córdoba nicaragüense', 'C$'],
      ['CAD', 'Dólar canadiense', 'CA$'],
      ['GBP', 'Libra esterlina', '£'],
      ['CHF', 'Franco suizo', 'CHF'],
      ['JPY', 'Yen japonés', '¥'],
      ['CNY', 'Yuan chino', 'CN¥'],
    ];
    for (const [code, name, symbol] of currencies) {
      await q.query(
        `INSERT INTO "currency" ("code", "name", "symbol") VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [code, name, symbol],
      );
    }
  }

  // ── Account roles ──────────────────────────────────────────────────────────

  /**
   * The operational job an account does, so automatic postings can find it without matching on a
   * localized name or a code a statutory plan would write differently.
   */
  private async accountRoles(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "accounts" ADD COLUMN IF NOT EXISTS "system_role" character varying(40)`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_accounts_org_system_role"
       ON "accounts" ("organization_id", "system_role") WHERE "system_role" IS NOT NULL`,
    );

    // Backfill from the account code every existing tenant's chart was built with. The codes come
    // from `coa-builder.ts`, which is the only thing that has ever created these accounts.
    const roleByCode: Array<[string, string]> = [
      ['1110', 'CASH'],
      ['1120', 'BANK'],
      ['1130', 'ACCOUNTS_RECEIVABLE'],
      ['1135', 'DOUBTFUL_ALLOWANCE'],
      ['1140', 'INVENTORY'],
      ['1150', 'TAX_RECEIVABLE'],
      ['1155', 'WITHHOLDING_RECEIVABLE'],
      ['1220', 'ACCUMULATED_DEPRECIATION'],
      ['2110', 'ACCOUNTS_PAYABLE'],
      ['2130', 'TAX_PAYABLE'],
      ['2135', 'WITHHOLDING_PAYABLE'],
      ['3300', 'RETAINED_EARNINGS'],
      ['4100', 'SALES_REVENUE'],
      ['4200', 'SERVICE_REVENUE'],
      ['4300', 'SALES_DISCOUNTS'],
      ['5100', 'COST_OF_GOODS_SOLD'],
      ['5500', 'DEPRECIATION_EXPENSE'],
    ];

    for (const [code, role] of roleByCode) {
      await q.query(
        `UPDATE "accounts" a SET "system_role" = '${role}'
         WHERE a."system_role" IS NULL
           AND EXISTS (
             SELECT 1 FROM "account_segments" s
             WHERE s."account_id" = a."id" AND s."order" = 0 AND s."value" = '${code}'
           )
           AND NOT EXISTS (
             SELECT 1 FROM "accounts" b
             WHERE b."organization_id" = a."organization_id" AND b."system_role" = '${role}'
           )`,
      );
    }
  }

  // ── Organizations ──────────────────────────────────────────────────────────

  private async organizationColumns(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "commercial_name" character varying`);
    await q.query(`ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "email" character varying`);

    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_purchase_tax_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_service_revenue_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_cost_of_goods_sold_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_sales_discounts_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_service_charge_payable_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_tax_withheld_receivable_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_tax_withheld_payable_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_cash_id" uuid`);
    await q.query(`ALTER TABLE "organization_settings" ADD COLUMN IF NOT EXISTS "default_bank_id" uuid`);
  }

  // ── Products ───────────────────────────────────────────────────────────────

  /**
   * The catalogue gains the fiscal classification every regime asks for per line. Without it the
   * e-CF declared every item a good — a consultancy hour included — and the 606/607 could not split
   * goods from services.
   */
  private async productColumns(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."products_kind_enum" AS ENUM('GOOD', 'SERVICE');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await q.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "kind" "public"."products_kind_enum" NOT NULL DEFAULT 'GOOD'`,
    );
    await q.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "unit_of_measure" character varying(16) NOT NULL DEFAULT 'UND'`,
    );
    await q.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_treatment" character varying(16) NOT NULL DEFAULT 'TAXED'`,
    );
    await q.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "tax_rate" numeric(9,6) NOT NULL DEFAULT 0`,
    );
    await q.query(
      `ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "excise_rate" numeric(9,6) NOT NULL DEFAULT 0`,
    );
    await q.query(`ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "fiscal_item_code" character varying(32)`);

    // Stock and prices become fractional. Stock was an integer while a line now bills 1.5 kg, and
    // prices were capped at two decimals, which fuel and pharmaceutical pricing exceed routinely.
    await q.query(`ALTER TABLE "products" ALTER COLUMN "stock" TYPE numeric(18,6) USING "stock"::numeric`);
    await q.query(
      `ALTER TABLE "products" ALTER COLUMN "reorder_level" TYPE numeric(18,6) USING "reorder_level"::numeric`,
    );
    await q.query(`ALTER TABLE "products" ALTER COLUMN "price" TYPE numeric(18,6)`);
    await q.query(`ALTER TABLE "products" ALTER COLUMN "cost" TYPE numeric(18,6)`);

    // Give every existing item its market's standard rate, so an upgrade does not silently start
    // invoicing at 0 %. Markets whose base is sub-national keep 0 and are configured by the tenant.
    await q.query(`
      UPDATE "products" p SET "tax_rate" = r.rate
      FROM (VALUES
        ('DO', 0.18), ('MX', 0.16), ('CO', 0.19), ('CL', 0.19), ('PE', 0.18), ('AR', 0.21),
        ('EC', 0.15), ('UY', 0.22), ('PY', 0.10), ('BO', 0.13), ('VE', 0.16), ('PA', 0.07),
        ('CR', 0.13), ('GT', 0.12), ('SV', 0.13), ('HN', 0.15), ('NI', 0.15)
      ) AS r(country, rate)
      WHERE p."tax_rate" = 0
        AND EXISTS (
          SELECT 1 FROM "organizations" o
          WHERE o."id" = p."organization_id" AND o."country" = r.country
        )
    `);
  }

  private async supplierColumns(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "country" character varying(2) DEFAULT 'DO'`,
    );
  }

  // ── Invoices ───────────────────────────────────────────────────────────────

  private async invoiceColumns(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoices_payment_method_enum" AS ENUM(
          'CASH','CHECK','CREDIT_CARD','DEBIT_CARD','CREDIT','BANK_TRANSFER','GIFT_CARD','SWAP','OTHER');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoices_modification_code_enum" AS ENUM('1','2','3','4','5');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    // `DEBIT_NOTE` and `QUOTE` are added by `InvoicingEnumValues1788490000000`: PostgreSQL refuses
    // to USE an enum value in the transaction that created it, and this migration uses both.

    const columns: Array<[string, string]> = [
      ['fiscal_document_type', 'character varying(8)'],
      ['ncf_expires_at', 'date'],
      ['customer_tax_id', 'character varying'],
      ['issued_at', 'timestamptz'],
      ['discount_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['taxed_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['exempt_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['goods_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['services_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['service_charge', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['tax_withheld', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['income_tax_withheld', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['net_receivable', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['credited_total', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['cost_of_sale', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['payment_method', '"public"."invoices_payment_method_enum" NOT NULL DEFAULT \'CASH\''],
      ['modification_code', '"public"."invoices_modification_code_enum"'],
      ['journal_entry_id', 'uuid'],
      ['cost_journal_entry_id', 'uuid'],
      ['voided_at', 'timestamptz'],
      ['void_reason', 'text'],
    ];
    for (const [name, definition] of columns) {
      await q.query(`ALTER TABLE "invoices" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`);
    }

    // Widen the money columns before anything writes an amount that would not fit.
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "subtotal" TYPE numeric(18,2)`);
    await q.query(
      `COMMENT ON COLUMN "invoices"."subtotal" IS 'Subtotal in transaction currency, net of line discounts'`,
    );
    await q.query(
      `COMMENT ON COLUMN "invoices"."tax" IS 'Consumption tax (ITBIS/IVA) in transaction currency'`,
    );
    await q.query(`COMMENT ON COLUMN "invoices"."total" IS 'Document total in transaction currency'`);
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "tax" TYPE numeric(18,2)`);
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "total" TYPE numeric(18,2)`);
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "balance" TYPE numeric(18,2)`);

    // Auditable timestamps carry their zone.
    await q.query(
      `ALTER TABLE "invoices" ALTER COLUMN "created_at" TYPE timestamptz USING "created_at" AT TIME ZONE 'UTC'`,
    );
    await q.query(
      `ALTER TABLE "invoices" ALTER COLUMN "updated_at" TYPE timestamptz USING "updated_at" AT TIME ZONE 'UTC'`,
    );

    // `original_invoice_id` was a bare varchar with no foreign key: a credit note could reference an
    // invoice that did not exist. Cast what is castable, null what is not, then constrain.
    await q.query(`
      ALTER TABLE "invoices"
      ALTER COLUMN "original_invoice_id" TYPE uuid
      USING (CASE
        WHEN "original_invoice_id" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        THEN "original_invoice_id"::uuid ELSE NULL END)
    `);
    await q.query(`
      UPDATE "invoices" SET "original_invoice_id" = NULL
      WHERE "original_invoice_id" IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM "invoices" o WHERE o."id" = "invoices"."original_invoice_id")
    `);

    // The duplicate customer column: copy anything `customer_id` is missing, then drop it.
    const duplicate = await q.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'invoices' AND column_name = 'customerId'
    `);
    if (duplicate.length > 0) {
      await q.query(`
        UPDATE "invoices" SET "customer_id" = "customerId"::uuid
        WHERE "customer_id" IS NULL
          AND "customerId" ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      `);
      await q.query(`ALTER TABLE "invoices" DROP COLUMN "customerId"`);
    }

    // Freeze the buyer's fiscal identifier on the document, as the printed representation requires.
    await q.query(`
      UPDATE "invoices" i SET "customer_tax_id" = c."taxId"
      FROM "customers" c
      WHERE c."id" = i."customer_id" AND i."customer_tax_id" IS NULL
    `);

    // A document that already carries a fiscal number was issued.
    await q.query(`
      UPDATE "invoices" SET "issued_at" = "created_at"
      WHERE "issued_at" IS NULL AND "status" <> 'Draft'
    `);
  }

  private async invoiceLineColumns(q: QueryRunner): Promise<void> {
    await q.query(`
      DO $$ BEGIN
        CREATE TYPE "public"."invoice_line_item_tax_treatment_enum" AS ENUM('TAXED','ZERO_RATED','EXEMPT');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "unit_of_measure" character varying(16)`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "discount_rate" numeric(9,6) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "discount_amount" numeric(18,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "line_subtotal" numeric(18,2) NOT NULL DEFAULT 0`);
    await q.query(
      `ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "tax_treatment" "public"."invoice_line_item_tax_treatment_enum" NOT NULL DEFAULT 'TAXED'`,
    );
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "is_service" boolean NOT NULL DEFAULT false`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "excise_amount" numeric(18,2) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "unit_cost" numeric(18,6) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "credited_quantity" numeric(18,6) NOT NULL DEFAULT 0`);
    await q.query(`ALTER TABLE "invoice_line_item" ADD COLUMN IF NOT EXISTS "source_line_id" uuid`);

    // Quantity becomes fractional IN PLACE. The generated migration wanted to drop and re-add the
    // column, which would have erased the quantity of every historical invoice line.
    await q.query(
      `ALTER TABLE "invoice_line_item" ALTER COLUMN "quantity" TYPE numeric(18,6) USING "quantity"::numeric`,
    );
    await q.query(`ALTER TABLE "invoice_line_item" ALTER COLUMN "price" TYPE numeric(18,6)`);
    await q.query(`ALTER TABLE "invoice_line_item" ALTER COLUMN "taxRate" TYPE numeric(9,6)`);
    await q.query(`ALTER TABLE "invoice_line_item" ALTER COLUMN "taxAmount" TYPE numeric(18,2)`);

    // Derive the new per-line figures from what the line already holds.
    await q.query(`
      UPDATE "invoice_line_item"
      SET "line_subtotal" = ROUND("quantity" * "price", 2)
      WHERE "line_subtotal" = 0
    `);
    await q.query(`
      UPDATE "invoice_line_item" l
      SET "tax_treatment" = 'EXEMPT'
      WHERE l."taxRate" = 0
    `);
    await q.query(`
      UPDATE "invoice_line_item" l
      SET "unit_cost" = p."cost", "is_service" = (p."kind" = 'SERVICE'),
          "unit_of_measure" = COALESCE(l."unit_of_measure", p."unit_of_measure")
      FROM "products" p
      WHERE p."id" = l."productId"
    `);
  }

  private async vendorBillColumns(q: QueryRunner): Promise<void> {
    const columns: Array<[string, string]> = [
      ['ncf_modified', 'character varying'],
      ['paid_at', 'date'],
      ['services_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['goods_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['tax_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['tax_withheld', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['income_tax_withheld', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['tax_to_cost', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['tax_proportional', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['excise_amount', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['other_taxes', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['service_charge', 'numeric(18,2) NOT NULL DEFAULT 0'],
      ['purchase_category', "character varying(2) NOT NULL DEFAULT '06'"],
      ['isr_retention_type', 'character varying(2)'],
      ['payment_form', "character varying(2) NOT NULL DEFAULT '01'"],
    ];
    for (const [name, definition] of columns) {
      await q.query(`ALTER TABLE "vendor_bills" ADD COLUMN IF NOT EXISTS "${name}" ${definition}`);
    }

    // Existing bills hold only an inclusive total. Reversing the standard rate out of it is the
    // same approximation the old 606 made — the difference is that it happens ONCE, here, on
    // historical rows, and is visible and correctable, rather than being recomputed on every
    // report as though it were a measurement.
    await q.query(`
      UPDATE "vendor_bills" b
      SET "goods_amount" = ROUND(b."total" / 1.18, 2),
          "tax_amount" = ROUND(b."total" - (b."total" / 1.18), 2)
      WHERE b."goods_amount" = 0 AND b."tax_amount" = 0 AND b."total" > 0
        AND EXISTS (SELECT 1 FROM "organizations" o WHERE o."id" = b."organization_id" AND o."country" = 'DO')
    `);
  }

  private async fiscalSequenceColumns(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ncf_sequences" ADD COLUMN IF NOT EXISTS "expires_at" date`);
    await q.query(
      `ALTER TABLE "ncf_sequences" ADD COLUMN IF NOT EXISTS "authorization_code" character varying(64)`,
    );

    // One active range per type. Retire duplicates, keeping the one furthest along, before the
    // unique index makes the situation impossible.
    await q.query(`
      UPDATE "ncf_sequences" s SET "is_active" = false
      WHERE s."is_active" = true
        AND EXISTS (
          SELECT 1 FROM "ncf_sequences" t
          WHERE t."organization_id" = s."organization_id"
            AND t."type" = s."type" AND t."is_active" = true
            AND (t."current_sequence" > s."current_sequence"
                 OR (t."current_sequence" = s."current_sequence" AND t."id" > s."id"))
        )
    `);
    // Superseded by the unique index below: the old one allowed two active ranges of the same type,
    // and `getNextNcf` picked between them without an ORDER BY.
    await q.query(`DROP INDEX IF EXISTS "IDX_de083cc1f2b194245cd177d4b6"`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ncf_sequences_active_type"
       ON "ncf_sequences" ("organization_id", "type") WHERE "is_active" = true`,
    );
  }

  /** Align the e-CF tables with their entities — the drift the CI gate reports. */
  private async ecfTimestamps(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "ecf_submissions" ALTER COLUMN "version" SET DEFAULT 1`);
    // The submission's link to its invoice had no foreign key at all: a row could reference a
    // document that did not exist, and deleting a draft left the submission behind.
    await q
      .query(
        `ALTER TABLE "ecf_submissions" ADD CONSTRAINT "FK_f7a0736756f048aeb8653eb226e"
         FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE`,
      )
      .catch(() => undefined);
  }

  /**
   * One type for one fact: `organization_id` becomes `uuid` everywhere, with a foreign key.
   *
   * Twenty tables held it as `character varying` while `organizations.id` is a uuid, so a join
   * between them was a type error the database refused — which is why the provisioning below could
   * not be written as a single statement, and why an orphaned row referencing a deleted tenant was
   * storable in any of them. The tables listed here are the ones the invoicing and accounting paths
   * traverse; converting them is what makes the tenant scoping enforceable rather than conventional.
   */
  private async normalizeTenantColumnTypes(q: QueryRunner): Promise<void> {
    const tables = [
      'journals',
      'accounting_periods',
      'ncf_sequences',
      'ecf_submissions',
      'ecf_certificates',
      'quotes',
      'fiscal_years',
      'ledger_mapping_rules',
    ];

    for (const table of tables) {
      const [column] = await q.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = $1 AND column_name = 'organization_id'`,
        [table],
      );
      if (!column || column.data_type === 'uuid') continue;

      // A value that is not a uuid cannot belong to any tenant; deleting it is the only honest
      // option, and there is no such row in a database this product wrote.
      await q.query(
        `DELETE FROM "${table}"
         WHERE "organization_id" IS NULL
            OR "organization_id" !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            OR NOT EXISTS (SELECT 1 FROM "organizations" o WHERE o."id"::text = "${table}"."organization_id")`,
      );
      await q.query(
        `ALTER TABLE "${table}" ALTER COLUMN "organization_id" TYPE uuid USING "organization_id"::uuid`,
      );
      // TypeORM derives a constraint name from a hash of the relation; using the same name is what
      // keeps `check:schema-drift` — a CI gate — from proposing to drop and recreate every one of
      // these on the next build.
      const constraint = TENANT_FK_NAMES[table];
      if (constraint) {
        await q
          .query(
            `ALTER TABLE "${table}" ADD CONSTRAINT "${constraint}"
             FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE`,
          )
          .catch(() => undefined);
      }
    }
  }

  // ── Backfill of document totals ────────────────────────────────────────────

  /**
   * Give every historical invoice the breakdown the new model and the fiscal reports depend on,
   * derived from the lines it already has.
   */
  private async backfillInvoiceTotals(q: QueryRunner): Promise<void> {
    await q.query(`
      WITH totals AS (
        SELECT l."invoiceId" AS invoice_id,
               SUM(CASE WHEN l."taxRate" > 0 THEN l."line_subtotal" ELSE 0 END) AS taxed,
               SUM(CASE WHEN l."taxRate" = 0 THEN l."line_subtotal" ELSE 0 END) AS exempt,
               SUM(CASE WHEN l."is_service" THEN l."line_subtotal" ELSE 0 END) AS services,
               SUM(CASE WHEN l."is_service" THEN 0 ELSE l."line_subtotal" END) AS goods,
               SUM(l."quantity" * l."unit_cost") AS cost
        FROM "invoice_line_item" l
        GROUP BY l."invoiceId"
      )
      UPDATE "invoices" i
      SET "taxed_total" = ROUND(ABS(t.taxed), 2),
          "exempt_total" = ROUND(ABS(t.exempt), 2),
          "services_total" = ROUND(ABS(t.services), 2),
          "goods_total" = ROUND(ABS(t.goods), 2),
          "cost_of_sale" = ROUND(ABS(COALESCE(t.cost, 0)), 2)
      FROM totals t
      WHERE t.invoice_id = i."id" AND i."taxed_total" = 0 AND i."exempt_total" = 0
    `);

    // Amounts were stored negative on credit notes, so every report that summed a column had to
    // know which sign to expect. Direction now lives in `type`, and the amounts are positive.
    await q.query(`
      UPDATE "invoices"
      SET "subtotal" = ABS("subtotal"), "tax" = ABS("tax"), "total" = ABS("total"),
          "total_in_base_currency" = ABS("total_in_base_currency")
      WHERE "type" = 'CREDIT_NOTE'
    `);

    await q.query(`
      UPDATE "invoices" SET "net_receivable" = "total"
      WHERE "net_receivable" = 0 AND "total" <> 0
    `);
    await q.query(`
      UPDATE "invoices" SET "payment_method" = 'CREDIT'
      WHERE "dueDate" > "issueDate"
    `);
  }

  // ── Constraints and indexes ────────────────────────────────────────────────

  private async constraintsAndIndexes(q: QueryRunner): Promise<void> {
    // A duplicate fiscal number cannot be created any more, but one may already exist from before
    // the range-overlap check. Report rather than destroy: the operator must decide which document
    // is real, and silently renumbering a comprobante is worse than a failed migration.
    const duplicates = await q.query(`
      SELECT "organization_id", "ncf_number", COUNT(*)::int AS n
      FROM "invoices" WHERE "ncf_number" IS NOT NULL
      GROUP BY 1, 2 HAVING COUNT(*) > 1
    `);
    if (duplicates.length > 0) {
      const detail = duplicates
        .map((row: { ncf_number: string; n: number }) => `${row.ncf_number} (${row.n})`)
        .join(', ');
      throw new Error(
        `No se puede aplicar la unicidad de NCF: existen comprobantes fiscales duplicados que deben ` +
          `resolverse manualmente antes de migrar: ${detail}.`,
      );
    }

    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoices_org_ncf"
       ON "invoices" ("organization_id", "ncf_number") WHERE "ncf_number" IS NOT NULL`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoices_org_number"
       ON "invoices" ("organization_id", "invoiceNumber")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_org_issue_date" ON "invoices" ("organization_id", "issueDate")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_org_status" ON "invoices" ("organization_id", "status")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoices_org_customer" ON "invoices" ("organization_id", "customer_id")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoice_line_item_invoice" ON "invoice_line_item" ("invoiceId")`,
    );

    // Every invoice belongs to a customer; the column was nullable because the relation's join
    // column was added separately from the duplicate one this migration removed.
    await q.query(`DELETE FROM "invoices" WHERE "customer_id" IS NULL`);
    await q.query(`ALTER TABLE "invoices" ALTER COLUMN "customer_id" SET NOT NULL`);

    await q
      .query(
        `ALTER TABLE "invoices" ADD CONSTRAINT "FK_d62030b9ec51c654fb037d4cc26"
         FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT`,
      )
      .catch(() => undefined);
    await q.query(`ALTER TABLE "invoice_line_item" DROP CONSTRAINT IF EXISTS "FK_b09242561f9c47a3288dc66c186"`);
    await q
      .query(
        `ALTER TABLE "invoice_line_item" ADD CONSTRAINT "FK_b09242561f9c47a3288dc66c186"
         FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE`,
      )
      .catch(() => undefined);
    await q.query(`ALTER TABLE "invoice_line_item" DROP CONSTRAINT IF EXISTS "FK_bd4af6952f6cafdce00bcd5ebb4"`);
    await q
      .query(
        `ALTER TABLE "invoice_line_item" ADD CONSTRAINT "FK_bd4af6952f6cafdce00bcd5ebb4"
         FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT`,
      )
      .catch(() => undefined);
    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_65e3145f317bd655481d3f96c74"`);
    await q
      .query(
        `ALTER TABLE "invoices" ADD CONSTRAINT "FK_65e3145f317bd655481d3f96c74"
         FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT`,
      )
      .catch(() => undefined);
  }

  // ── Provisioning of existing tenants ───────────────────────────────────────

  /**
   * Every organization that predates this migration has a chart of accounts and nothing else, which
   * is why none of them could issue an invoice. This gives them the rest, derived from the chart
   * they already have.
   */
  private async provisionExistingTenants(q: QueryRunner): Promise<void> {
    // 1. Settings, with the accounts resolved from the roles backfilled above.
    await q.query(`
      INSERT INTO "organization_settings" ("organization_id", "base_currency")
      SELECT o."id", COALESCE(c.currency, 'USD')
      FROM "organizations" o
      LEFT JOIN (VALUES
        ('DO','DOP'),('US','USD'),('MX','MXN'),('CO','COP'),('CL','CLP'),('PE','PEN'),('AR','ARS'),
        ('BR','BRL'),('EC','USD'),('UY','UYU'),('PY','PYG'),('BO','BOB'),('VE','VES'),('PA','PAB'),
        ('CR','CRC'),('GT','GTQ'),('SV','USD'),('HN','HNL'),('NI','NIO')
      ) AS c(country, currency) ON c.country = o."country"
      WHERE NOT EXISTS (SELECT 1 FROM "organization_settings" s WHERE s."organization_id" = o."id")
    `);

    const roleToColumn: Array<[string, string]> = [
      ['ACCOUNTS_RECEIVABLE', 'default_accounts_receivable_id'],
      ['ACCOUNTS_PAYABLE', 'default_accounts_payable_id'],
      ['SALES_REVENUE', 'default_sales_revenue_id'],
      ['SERVICE_REVENUE', 'default_service_revenue_id'],
      ['TAX_PAYABLE', 'default_sales_tax_id'],
      ['TAX_RECEIVABLE', 'default_purchase_tax_id'],
      ['INVENTORY', 'default_inventory_id'],
      ['COST_OF_GOODS_SOLD', 'default_cost_of_goods_sold_id'],
      ['SALES_DISCOUNTS', 'default_sales_discounts_id'],
      ['WITHHOLDING_RECEIVABLE', 'default_tax_withheld_receivable_id'],
      ['WITHHOLDING_PAYABLE', 'default_tax_withheld_payable_id'],
      ['CASH', 'default_cash_id'],
      ['BANK', 'default_bank_id'],
      ['RETAINED_EARNINGS', 'default_retained_earnings_account_id'],
      ['ACCUMULATED_DEPRECIATION', 'default_accumulated_depreciation_account_id'],
      ['DEPRECIATION_EXPENSE', 'default_depreciation_expense_account_id'],
    ];
    for (const [role, column] of roleToColumn) {
      await q.query(
        `UPDATE "organization_settings" s SET "${column}" = a."id"
         FROM "accounts" a
         WHERE a."organization_id" = s."organization_id" AND a."system_role" = '${role}'
           AND s."${column}" IS NULL`,
      );
    }

    // 2. Default ledger.
    await q.query(`
      INSERT INTO "ledgers" ("organization_id", "name", "description", "currency", "is_default", "isActive")
      SELECT o."id", 'Libro Principal',
             'Libro contable principal, en la moneda funcional de la organización.',
             COALESCE(s."base_currency", 'USD'), true, true
      FROM "organizations" o
      LEFT JOIN "organization_settings" s ON s."organization_id" = o."id"
      WHERE NOT EXISTS (
        SELECT 1 FROM "ledgers" l WHERE l."organization_id" = o."id" AND l."is_default" = true
      )
    `);

    // 3. Journals. `COBROS` is the one the payment path looks up by code and fails without.
    const journals: Array<[string, string, string]> = [
      ['VENTAS', 'Diario de Ventas', 'SALES'],
      ['COMPRAS', 'Diario de Compras', 'PURCHASES'],
      ['COBROS', 'Diario de Cobros', 'BANK'],
      ['PAGOS', 'Diario de Pagos', 'BANK'],
      ['CAJA', 'Diario de Caja', 'CASH'],
      ['GENERAL', 'Diario General', 'GENERAL'],
    ];
    // Values are inlined rather than parameterised: PostgreSQL deduces one type per placeholder
    // across the whole statement, and the same literal is used in both the SELECT list and the
    // NOT EXISTS predicate. Every value here is a compile-time constant of this migration.
    for (const [code, name, type] of journals) {
      await q.query(
        `INSERT INTO "journals" ("organization_id", "code", "name", "type")
         SELECT o."id", '${code}', '${name}', '${type}' FROM "organizations" o
         WHERE NOT EXISTS (
           SELECT 1 FROM "journals" j WHERE j."organization_id" = o."id" AND j."code" = '${code}'
         )`,
      );
    }

    // 4. Document sequences. Existing invoices already carry numbers, so the counter starts after
    //    the highest one already issued rather than at 1.
    const sequences: Array<[string, string]> = [
      ['CUSTOMER_INVOICE', 'FAC-'],
      ['QUOTE', 'COT-'],
      ['CREDIT_NOTE', 'NC-'],
      ['VENDOR_BILL', 'FP-'],
      ['JOURNAL_ENTRY', 'AS-'],
    ];
    for (const [type, prefix] of sequences) {
      await q.query(
        `INSERT INTO "document_sequences" ("organization_id", "type", "prefix", "nextNumber", "isElectronic")
         SELECT o."id", '${type}'::"public"."document_sequences_type_enum", '${prefix}', 1, false
         FROM "organizations" o
         WHERE NOT EXISTS (
           SELECT 1 FROM "document_sequences" d
           WHERE d."organization_id" = o."id" AND d."type"::text = '${type}'
         )`,
      );
    }
    await q.query(`
      UPDATE "document_sequences" d
      SET "nextNumber" = GREATEST(d."nextNumber", COALESCE(m.max_number, 0) + 1)
      FROM (
        SELECT i."organization_id",
               MAX(NULLIF(regexp_replace(i."invoiceNumber", '\\D', '', 'g'), '')::bigint) AS max_number
        FROM "invoices" i
        WHERE i."type" = 'INVOICE'
        GROUP BY i."organization_id"
      ) m
      WHERE m."organization_id" = d."organization_id" AND d."type" = 'CUSTOMER_INVOICE'
    `);

    // 5. Twelve open periods for the current year, so period control is real from the first
    //    document instead of being permissive because the table is empty.
    await q.query(`
      INSERT INTO "accounting_periods"
        ("organization_id", "name", "start_date", "end_date", "status", "gl_status", "ap_status", "ar_status", "inv_status")
      SELECT o."id",
             to_char(make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m, 1), 'TMMonth YYYY'),
             make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m, 1),
             (make_date(EXTRACT(YEAR FROM CURRENT_DATE)::int, m, 1) + INTERVAL '1 month - 1 day')::date,
             'OPEN', 'OPEN', 'OPEN', 'OPEN', 'OPEN'
      FROM "organizations" o
      CROSS JOIN generate_series(1, 12) AS m
      WHERE NOT EXISTS (
        SELECT 1 FROM "accounting_periods" p
        WHERE p."organization_id" = o."id"
          AND EXTRACT(YEAR FROM p."start_date") = EXTRACT(YEAR FROM CURRENT_DATE)
      )
    `);
  }

  // ── Down ───────────────────────────────────────────────────────────────────

  /**
   * Reverses the structural changes. It deliberately does NOT delete the settings, ledgers,
   * journals, sequences or periods provisioned above: those are a tenant's operating configuration,
   * they are referenced by journal entries, and removing them would break books that are already
   * posted. Rolling back the code does not un-issue the documents.
   */
  public async down(q: QueryRunner): Promise<void> {
    for (const [table, constraint] of Object.entries(TENANT_FK_NAMES)) {
      await q.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${constraint}"`);
    }
    await q.query(`ALTER TABLE "invoices" DROP CONSTRAINT IF EXISTS "FK_invoices_original_invoice"`);
    await q.query(`ALTER TABLE "ecf_submissions" DROP CONSTRAINT IF EXISTS "FK_f7a0736756f048aeb8653eb226e"`);

    for (const index of [
      'UQ_invoices_org_ncf',
      'UQ_invoices_org_number',
      'IDX_invoices_org_issue_date',
      'IDX_invoices_org_status',
      'IDX_invoices_org_customer',
      'IDX_invoice_line_item_invoice',
      'UQ_ncf_sequences_active_type',
      'UQ_accounts_org_system_role',
    ]) {
      await q.query(`DROP INDEX IF EXISTS "${index}"`);
    }

    for (const column of [
      'fiscal_document_type', 'ncf_expires_at', 'customer_tax_id', 'issued_at', 'discount_total',
      'taxed_total', 'exempt_total', 'goods_total', 'services_total', 'service_charge',
      'tax_withheld', 'income_tax_withheld', 'net_receivable', 'credited_total', 'cost_of_sale',
      'payment_method', 'modification_code', 'journal_entry_id', 'cost_journal_entry_id',
      'voided_at', 'void_reason',
    ]) {
      await q.query(`ALTER TABLE "invoices" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of [
      'sort_order', 'unit_of_measure', 'discount_rate', 'discount_amount', 'line_subtotal',
      'tax_treatment', 'is_service', 'excise_amount', 'unit_cost', 'credited_quantity',
      'source_line_id',
    ]) {
      await q.query(`ALTER TABLE "invoice_line_item" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of [
      'ncf_modified', 'paid_at', 'services_amount', 'goods_amount', 'tax_amount', 'tax_withheld',
      'income_tax_withheld', 'tax_to_cost', 'tax_proportional', 'excise_amount', 'other_taxes',
      'service_charge', 'purchase_category', 'isr_retention_type', 'payment_form',
    ]) {
      await q.query(`ALTER TABLE "vendor_bills" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of ['kind', 'unit_of_measure', 'tax_treatment', 'tax_rate', 'excise_rate', 'fiscal_item_code']) {
      await q.query(`ALTER TABLE "products" DROP COLUMN IF EXISTS "${column}"`);
    }
    for (const column of [
      'default_purchase_tax_id', 'default_service_revenue_id', 'default_cost_of_goods_sold_id',
      'default_sales_discounts_id', 'default_service_charge_payable_id',
      'default_tax_withheld_receivable_id', 'default_tax_withheld_payable_id',
      'default_cash_id', 'default_bank_id',
    ]) {
      await q.query(`ALTER TABLE "organization_settings" DROP COLUMN IF EXISTS "${column}"`);
    }
    await q.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "commercial_name"`);
    await q.query(`ALTER TABLE "organizations" DROP COLUMN IF EXISTS "email"`);
    await q.query(`ALTER TABLE "suppliers" DROP COLUMN IF EXISTS "country"`);
    await q.query(`ALTER TABLE "ncf_sequences" DROP COLUMN IF EXISTS "authorization_code"`);
    await q.query(`ALTER TABLE "accounts" DROP COLUMN IF EXISTS "system_role"`);

    await q.query(`DROP TYPE IF EXISTS "public"."invoice_line_item_tax_treatment_enum"`);
    await q.query(`DROP TYPE IF EXISTS "public"."invoices_modification_code_enum"`);
    await q.query(`DROP TYPE IF EXISTS "public"."invoices_payment_method_enum"`);
    await q.query(`DROP TYPE IF EXISTS "public"."products_kind_enum"`);
    // PostgreSQL cannot drop an individual enum value; DEBIT_NOTE stays on invoices_type_enum.
  }
}

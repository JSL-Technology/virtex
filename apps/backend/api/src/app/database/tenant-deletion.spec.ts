import { DataSource } from 'typeorm';

/**
 * A tenant with a full history can be deleted.
 *
 * ## Why this has to be a real delete of a real tenant
 *
 * The failure is a foreign key whose action is wrong, and PostgreSQL only reveals it when it
 * actually walks the cascade — the order in which it clears children is not specified, so reading
 * the schema tells you a constraint *may* block the delete, never that it will. Nothing short of
 * inserting a tenant with every kind of row it can own and deleting it proves the thing works.
 *
 * `TenantDeletionFinance1788700600000` repointed the general ledger's constraints. It did not
 * establish that the delete then succeeded, and it did not: twelve `RESTRICT`/`NO ACTION` edges
 * remained between tables that both descend from `organizations`, so a tenant with a bank account,
 * an invoice for a stocked product, a collection, a quote or an audit adjustment still could not be
 * removed. The consequence is not academic — offboarding a customer, honouring an erasure request
 * under Brazil's LGPD or a state privacy statute, and cleaning up trial tenants all failed with a
 * foreign-key error and the data still in place.
 *
 * Raw SQL rather than the services, deliberately: the question is what the *schema* permits, and
 * routing through the services would make the answer depend on their validation instead.
 */
const DB_AVAILABLE = Boolean(process.env['DB_HOST'] && process.env['DB_NAME']);
const describeWithDb = DB_AVAILABLE ? describe : describe.skip;

describeWithDb('tenant deletion', () => {
  jest.setTimeout(120_000);

  let dataSource: DataSource;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env['DB_HOST'],
      port: Number(process.env['DB_PORT'] ?? 5432),
      username: process.env['DB_USERNAME'],
      password: process.env['DB_PASSWORD'] || undefined,
      database: process.env['DB_NAME'],
      synchronize: false,
      logging: false,
      entities: [`${__dirname}/../**/*.entity.{js,ts}`],
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  /**
   * One tenant carrying every kind of row that has ever blocked its own deletion.
   *
   * Ids are generated per run so the suite can run beside itself, and everything is created inside
   * the caller's transaction so a failure leaves nothing behind.
   */
  async function seedTenant(query: (sql: string, params?: unknown[]) => Promise<unknown>) {
    const ids = await dataSource.query<{ id: string }[]>(
      `SELECT gen_random_uuid() AS id FROM generate_series(1, 16)`,
    );
    const [
      org, customer, product, invoice, creditNote, line, creditLine,
      glAccount, bankA, bankB, transfer, payment, batch, fiscalYear, adjustment, journal,
    ] = ids.map((row) => row.id);

    await query(
      `INSERT INTO organizations (id, legal_name, timezone) VALUES ($1, $2, 'America/Santo_Domingo')`,
      [org, `Inquilino borrable ${Date.now()}`],
    );
    await query(
      `INSERT INTO customers (id, organization_id, "companyName", email) VALUES ($1, $2, 'Cliente', $3)`,
      [customer, org, `cliente-${customer}@ejemplo.test`],
    );
    await query(
      `INSERT INTO products (id, organization_id, name, price) VALUES ($1, $2, $3, 100)`,
      [product, org, `Producto ${product}`],
    );

    // ── Chart of accounts, a journal and a bank account ──────────────────────
    await query(
      `INSERT INTO accounts (id, organization_id, code, name, type, category, nature, "isPostable", version)
       VALUES ($1, $2, '1101', '{"es":"Efectivo"}'::jsonb, 'ASSET', 'CURRENT_ASSET', 'DEBIT', true, 1)`,
      [glAccount, org],
    );
    await query(
      `INSERT INTO journals (id, organization_id, code, name, type)
       VALUES ($1, $2, 'GENERAL', 'Diario general', 'GENERAL')`,
      [journal, org],
    );
    for (const [id, name] of [[bankA, 'Cuenta A'], [bankB, 'Cuenta B']] as const) {
      await query(
        `INSERT INTO bank_accounts (id, organization_id, gl_account_id, name, currency_code)
         VALUES ($1, $2, $3, $4, 'DOP')`,
        [id, org, glAccount, name],
      );
    }
    await query(
      `INSERT INTO bank_transfers (id, organization_id, from_bank_account_id, to_bank_account_id, amount, amount_received, date, description)
       VALUES ($1, $2, $3, $4, 100, 100, '2026-01-05', 'Traspaso')`,
      [transfer, org, bankA, bankB],
    );

    // ── An invoice for a stocked product, and the credit note that corrects it ─
    const invoiceColumns =
      `(id, organization_id, "invoiceNumber", "customerName", "issueDate", "dueDate",
        subtotal, tax, total, balance, total_in_base_currency, version, customer_id)`;
    await query(
      `INSERT INTO invoices ${invoiceColumns}
       VALUES ($1, $2, $3, 'Cliente', '2026-01-10', '2026-02-10', 100, 0, 100, 0, 100, 1, $4)`,
      [invoice, org, `F-${invoice.slice(0, 8)}`, customer],
    );
    await query(
      `INSERT INTO invoices ${invoiceColumns.slice(0, -1)}, original_invoice_id)
       VALUES ($1, $2, $3, 'Cliente', '2026-01-20', '2026-02-20', -100, 0, -100, 0, -100, 1, $4, $5)`,
      [creditNote, org, `NC-${creditNote.slice(0, 8)}`, customer, invoice],
    );
    for (const [id, parent] of [[line, invoice], [creditLine, creditNote]] as const) {
      await query(
        `INSERT INTO invoice_line_item (id, "invoiceId", "productId", description, quantity, price, line_subtotal)
         VALUES ($1, $2, $3, 'Producto facturado', 1, 100, 100)`,
        [id, parent, product],
      );
    }

    // ── A collection into a bank account, and a payment batch out of one ──────
    await query(
      `INSERT INTO customer_payments (id, organization_id, customer_id, bank_account_id, total_amount, payment_date)
       VALUES ($1, $2, $3, $4, 100, '2026-01-15')`,
      [payment, org, customer, bankA],
    );
    await query(
      `INSERT INTO payment_batches (id, organization_id, bank_account_id, payment_date)
       VALUES ($1, $2, $3, '2026-01-16')`,
      [batch, org, bankA],
    );

    // ── A fiscal year with a proposed audit adjustment against it ─────────────
    await query(
      `INSERT INTO fiscal_years (id, organization_id, start_date, end_date)
       VALUES ($1, $2, '2026-01-01', '2026-12-31')`,
      [fiscalYear, org],
    );
    await query(
      `INSERT INTO proposed_audit_adjustments (id, organization_id, fiscal_year_id, journal_id, date, description, lines)
       VALUES ($1, $2, $3, $4, '2026-06-30', 'Ajuste de auditoría', '[]'::jsonb)`,
      [adjustment, org, fiscalYear, journal],
    );

    return org;
  }

  /**
   * The whole point.
   *
   * Wrapped in a transaction that rolls back, so the suite leaves the database exactly as it found
   * it while still exercising a real `DELETE` against real constraints.
   */
  it('removes a tenant that has traded, banked, invoiced, collected and been audited', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const query = (sql: string, params?: unknown[]) => runner.query(sql, params as never[]);
      const org = await seedTenant(query);

      await expect(
        runner.query(`DELETE FROM organizations WHERE id = $1`, [org]),
      ).resolves.toBeDefined();

      const remaining = (await runner.query(
        `SELECT COUNT(*)::text AS count FROM organizations WHERE id = $1`,
        [org],
      )) as { count: string }[];
      expect(remaining[0].count).toBe('0');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });

  /**
   * Guards the guard.
   *
   * If the seed silently stopped inserting — a renamed column, a new NOT NULL — the delete above
   * would pass by deleting an empty tenant, which proves nothing at all.
   */
  it('seeds every table the delete has to walk through', async () => {
    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const query = (sql: string, params?: unknown[]) => runner.query(sql, params as never[]);
      const org = await seedTenant(query);

      for (const table of [
        'customers',
        'products',
        'accounts',
        'bank_accounts',
        'bank_transfers',
        'invoices',
        'customer_payments',
        'payment_batches',
        'fiscal_years',
        'proposed_audit_adjustments',
      ]) {
        const rows = (await runner.query(
          `SELECT COUNT(*)::text AS count FROM "${table}" WHERE organization_id = $1`,
          [org],
        )) as { count: string }[];
        expect({ table, count: rows[0].count }).not.toEqual({ table, count: '0' });
      }

      const lines = (await runner.query(
        `SELECT COUNT(*)::text AS count FROM invoice_line_item l
         JOIN invoices i ON i.id = l."invoiceId" WHERE i.organization_id = $1`,
        [org],
      )) as { count: string }[];
      expect(lines[0].count).toBe('2');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

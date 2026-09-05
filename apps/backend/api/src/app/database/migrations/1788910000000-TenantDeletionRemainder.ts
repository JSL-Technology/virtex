import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting a tenant still failed. Twelve foreign keys, and any one of them is enough.
 *
 * `TenantDeletionFinance1788700600000` repointed the general ledger's constraints and said so —
 * and stopped there, deliberately. What it did not establish is that the delete then *worked*, and
 * it does not: twelve `RESTRICT`/`NO ACTION` edges remain between tables that both descend from
 * `organizations` by cascade, and PostgreSQL does not promise to process the cascades in an order
 * that clears the child before it reaches the parent. Reproduced directly:
 *
 *     INSERT organizations, customers, products, invoices, invoice_line_item;
 *     DELETE FROM organizations WHERE id = …;
 *     ERROR: update or delete on table "products" violates foreign key constraint
 *            "FK_bd4af6952f6cafdce00bcd5ebb4" on table "invoice_line_item"
 *
 * A tenant that has issued one invoice for one stocked product cannot be removed. Nor can one with
 * a bank account, a transfer, a collection, a payment batch, a quote or an audit adjustment. That
 * is every real tenant, which makes offboarding, an LGPD or state-privacy erasure request, and
 * cleaning up trial accounts all impossible — and it fails as a foreign-key error with the data
 * still in place, so the operator cannot tell erasure from a bug.
 *
 * ## Which action, and why
 *
 * **CASCADE** where the child cannot exist without the parent and the column is `NOT NULL`: a bank
 * account without its general-ledger account, a transfer without the accounts it moves between, a
 * collection without the bank it landed in, an invoice without its customer, an adjustment without
 * its fiscal year. Deleting the parent on its own is refused by the services that own those rules —
 * an account with movements, a bank account with transactions — so this action only ever fires when
 * the whole tenant goes.
 *
 * **SET NULL** where the row is a record that must outlive what it points at, and the column is
 * already nullable:
 *
 * - `invoice_line_item.productId` — a line is part of a fiscal document. It carries its own
 *   description, price, quantity, unit of measure and unit cost, so it stays completely readable
 *   once the catalogue entry is gone. `RESTRICT` here was standing in for a business rule —
 *   "you may not delete a product you have sold" — that belongs in the product service, where it
 *   can say so, rather than in a constraint whose other effect is to make the tenant undeletable.
 * - `quote_lines.product_id` — the same, for a commercial document.
 * - `invoices.original_invoice_id` — deleting an invoice must never delete the credit note that
 *   corrects it; the correction is the more important of the two records.
 * - `reconciliation_rules.target_account_id` — a rule that has lost its account is a rule to
 *   review, not a reason to keep the account.
 *
 * ## Proving it
 *
 * `tenant-deletion.spec.ts` builds a tenant with a chart of accounts, a posted entry, a bank
 * account, a transfer, a customer, a product, an invoice with lines, a collection and an audit
 * adjustment, and deletes it. That is the only test that can prove this, because the failure is an
 * ordering-dependent constraint: nothing short of an actual delete of an actual tenant exercises it.
 */
export class TenantDeletionRemainder1788910000000 implements MigrationInterface {
  name = 'TenantDeletionRemainder1788910000000';

  /** `[constraint, table, column, referenced table, referenced column, action]` */
  private static readonly EDGES: [string, string, string, string, string, 'CASCADE' | 'SET NULL'][] =
    [
      // ── Treasury ───────────────────────────────────────────────────────────
      ['FK_de06f95dbf7464474b74268527d', 'bank_accounts', 'gl_account_id', 'accounts', 'id', 'CASCADE'],
      ['FK_5fa858ac77726a79056acab2961', 'bank_transfers', 'from_bank_account_id', 'bank_accounts', 'id', 'CASCADE'],
      ['FK_9d9293f1e8c20c255303163f65b', 'bank_transfers', 'to_bank_account_id', 'bank_accounts', 'id', 'CASCADE'],
      ['FK_b099ff465c3b0c21ba7e47540d2', 'customer_payments', 'bank_account_id', 'bank_accounts', 'id', 'CASCADE'],
      ['FK_8c5be41fb23d249f227278cb153', 'payment_batches', 'bank_account_id', 'bank_accounts', 'id', 'CASCADE'],

      // ── Reconciliation ─────────────────────────────────────────────────────
      ['FK_cd4cfbb69b12815cd0969c2ea53', 'reconciliation_rules', 'target_account_id', 'accounts', 'id', 'SET NULL'],

      // ── Receivables and sales ──────────────────────────────────────────────
      ['FK_65e3145f317bd655481d3f96c74', 'invoices', 'customer_id', 'customers', 'id', 'CASCADE'],
      ['FK_a11bdb4a739328d1009c0b47e83', 'quotes', 'customer_id', 'customers', 'id', 'CASCADE'],
      ['FK_d62030b9ec51c654fb037d4cc26', 'invoices', 'original_invoice_id', 'invoices', 'id', 'SET NULL'],
      ['FK_bd4af6952f6cafdce00bcd5ebb4', 'invoice_line_item', 'productId', 'products', 'id', 'SET NULL'],
      ['FK_d46678ba860b7704df2d822dc63', 'quote_lines', 'product_id', 'products', 'id', 'SET NULL'],

      // ── Accounting ─────────────────────────────────────────────────────────
      ['FK_5db83878f7e163970c97c869f33', 'proposed_audit_adjustments', 'fiscal_year_id', 'fiscal_years', 'id', 'CASCADE'],
    ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table, column, parent, parentColumn, action] of TenantDeletionRemainder1788910000000.EDGES) {
      // `IF EXISTS` because a constraint's generated name depends on the order the baseline created
      // it, and a database restored from a different lineage may carry a different hash. The
      // recreate below uses a stable, readable name so this never has to be guessed again.
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
      const stable = `FK_${table}_${column}`.toLowerCase();
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${stable}"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ` +
          `FOREIGN KEY ("${column}") REFERENCES "${parent}"("${parentColumn}") ON DELETE ${action}`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const [name, table, column, parent, parentColumn] of TenantDeletionRemainder1788910000000.EDGES) {
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "${name}"`);
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ` +
          `FOREIGN KEY ("${column}") REFERENCES "${parent}"("${parentColumn}") ON DELETE RESTRICT`,
      );
    }
  }
}

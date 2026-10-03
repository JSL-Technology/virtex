import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Master data that documents name can no longer be deleted out from under them (QA C-03).
 *
 * ## What happened
 *
 * Deleting a customer answered 200 and PostgreSQL did exactly what the schema said: it cascaded
 * into `invoices` — fiscal documents with issued e-NCF — and from there into `customer_payments`,
 * their lines and the e-CF submissions. The journal entries those documents had posted stayed in
 * the ledger, now pointing at nothing, and receivables no longer reconciled with it. The same
 * shape existed across the product: removing a bank account removed its receipts and transfers,
 * removing a GL account removed every journal line posted to it, removing a ledger or a journal
 * removed its entries, and removing a product set the product of every invoice line to NULL.
 *
 * ## What changes
 *
 * Every such reference becomes ON DELETE NO ACTION. Fiscal and accounting records are corrected
 * by voiding, crediting or reversing, never by deleting, and the master data they name follows
 * the same rule: it is deactivated. The services now check first and say what is in the way; this
 * is the guarantee underneath them, and the exception filter turns its violation into a 409.
 *
 * `employees.department_id` had no constraint at all and gains one. Rows pointing at departments
 * that no longer exist (the orphans the old delete produced) are cleared first, or the constraint
 * could not be created.
 *
 * ## Why NO ACTION DEFERRABLE INITIALLY DEFERRED, and not RESTRICT
 *
 * A tenant must remain deletable in one statement — offboarding and privacy erasure depend on it
 * (`TenantDeletionRemainder1788910000000`, `tenant-deletion.spec.ts`). That delete cascades from
 * `organizations` down every path at once, and PostgreSQL runs each cascade level as its own
 * trigger, in an order that is not ours to choose: a RESTRICT (checked at once) or plain NO ACTION
 * (checked per trigger) edge fails the moment the cascade reaches a ledger before the valuations
 * that name it arrive by the other path. That is why the previous design settled for CASCADE and
 * SET NULL here, and left the protection to the services alone.
 *
 * A DEFERRED check runs at COMMIT, after every cascade has finished. Deleting the tenant then
 * finds nothing dangling and succeeds; deleting the customer, product or ledger on its own still
 * leaves its invoices pointing at it and is refused — by the database, not only by the service
 * that remembered to check (`assertNoDependents`). Defence in depth without giving up erasure.
 *
 * Constraint names are kept, so the entities (which now declare `onDelete: 'NO ACTION'`) and the
 * database stay identical for `check:schema-drift`.
 */
const RESTRICTED: ReadonlyArray<{
  name: string;
  table: string;
  column: string;
  references: string;
  previous: 'CASCADE' | 'SET NULL';
}> = [
  { name: 'FK_65e3145f317bd655481d3f96c74', table: 'invoices', column: 'customer_id', references: 'customers', previous: 'CASCADE' },
  { name: 'FK_dcd8ce2a4a8587ee8a1d6985e8b', table: 'customer_payments', column: 'customer_id', references: 'customers', previous: 'CASCADE' },
  { name: 'FK_a11bdb4a739328d1009c0b47e83', table: 'quotes', column: 'customer_id', references: 'customers', previous: 'CASCADE' },
  { name: 'FK_6f4bf16a8536ae1bdf7f8ad6ed4', table: 'vendor_bills', column: 'vendor_id', references: 'suppliers', previous: 'CASCADE' },
  { name: 'FK_ef9d32e9fc160ea298a0d2f8369', table: 'customer_payment_lines', column: 'invoice_id', references: 'invoices', previous: 'CASCADE' },
  { name: 'FK_f7a0736756f048aeb8653eb226e', table: 'ecf_submissions', column: 'invoice_id', references: 'invoices', previous: 'CASCADE' },
  { name: 'FK_a26a568fe704e6934085ce55bf2', table: 'vendor_payment', column: 'vendor_bill_id', references: 'vendor_bills', previous: 'CASCADE' },
  { name: 'FK_b099ff465c3b0c21ba7e47540d2', table: 'customer_payments', column: 'bank_account_id', references: 'bank_accounts', previous: 'CASCADE' },
  { name: 'FK_8c5be41fb23d249f227278cb153', table: 'payment_batches', column: 'bank_account_id', references: 'bank_accounts', previous: 'CASCADE' },
  { name: 'FK_9d9293f1e8c20c255303163f65b', table: 'bank_transfers', column: 'to_bank_account_id', references: 'bank_accounts', previous: 'CASCADE' },
  { name: 'FK_5fa858ac77726a79056acab2961', table: 'bank_transfers', column: 'from_bank_account_id', references: 'bank_accounts', previous: 'CASCADE' },
  { name: 'FK_8effef620ff28585490eee69593', table: 'bank_statements', column: 'bank_account_id', references: 'bank_accounts', previous: 'CASCADE' },
  { name: 'FK_de06f95dbf7464474b74268527d', table: 'bank_accounts', column: 'gl_account_id', references: 'accounts', previous: 'CASCADE' },
  { name: 'FK_4a4fcd732e7b109880444ebc9c1', table: 'journal_entry_lines', column: 'account_id', references: 'accounts', previous: 'CASCADE' },
  { name: 'FK_ab9e9f1ceb877c6455bd62969ee', table: 'budget_lines', column: 'account_id', references: 'accounts', previous: 'CASCADE' },
  { name: 'FK_2b4f095a070c9eb5f6174485962', table: 'journal_entries', column: 'journal_id', references: 'journals', previous: 'CASCADE' },
  { name: 'FK_867d421cb5d172210679eedd7f9', table: 'journal_entries', column: 'ledger_id', references: 'ledgers', previous: 'CASCADE' },
  { name: 'FK_618c5038a2f2898909dca4984ec', table: 'journal_entry_line_valuations', column: 'ledger_id', references: 'ledgers', previous: 'CASCADE' },
  { name: 'FK_88d52be6cdd7194c8a0e4596d8c', table: 'reconciliation_match_lines', column: 'journal_entry_line_id', references: 'journal_entry_lines', previous: 'CASCADE' },
  { name: 'FK_bd4af6952f6cafdce00bcd5ebb4', table: 'invoice_line_item', column: 'productId', references: 'products', previous: 'SET NULL' },
  { name: 'FK_purchase_order_lines_product', table: 'purchase_order_lines', column: 'product_id', references: 'products', previous: 'SET NULL' },
  { name: 'FK_purchase_requisition_lines_product', table: 'purchase_requisition_lines', column: 'product_id', references: 'products', previous: 'SET NULL' },
  { name: 'FK_d46678ba860b7704df2d822dc63', table: 'quote_lines', column: 'product_id', references: 'products', previous: 'SET NULL' },
];

export class ProtectReferencedMasterData1789007600000 implements MigrationInterface {
  name = 'ProtectReferencedMasterData1789007600000';

  public async up(q: QueryRunner): Promise<void> {
    for (const fk of RESTRICTED) {
      await this.replace(q, fk, 'NO ACTION');
    }

    // Orphans left by the old unchecked department delete. Keeping them would make the constraint
    // impossible to create; the department they named is gone either way.
    await q.query(`
      UPDATE "employees" e
         SET "department_id" = NULL
       WHERE e."department_id" IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM "departments" d WHERE d."id" = e."department_id")
    `);
    await q.query(`
      ALTER TABLE "employees"
        ADD CONSTRAINT "FK_employees_department"
        FOREIGN KEY ("department_id") REFERENCES "departments"("id")
        ON DELETE NO ACTION ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "employees" DROP CONSTRAINT IF EXISTS "FK_employees_department"`);
    for (const fk of RESTRICTED) {
      await this.replace(q, fk, fk.previous);
    }
  }

  private async replace(
    q: QueryRunner,
    fk: (typeof RESTRICTED)[number],
    onDelete: 'NO ACTION' | 'CASCADE' | 'SET NULL',
  ): Promise<void> {
    await q.query(`ALTER TABLE "${fk.table}" DROP CONSTRAINT IF EXISTS "${fk.name}"`);
    await q.query(`
      ALTER TABLE "${fk.table}"
        ADD CONSTRAINT "${fk.name}"
        FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references}"("id")
        ON DELETE ${onDelete} ON UPDATE NO ACTION${onDelete === 'NO ACTION' ? ' DEFERRABLE INITIALLY DEFERRED' : ''}
    `);
  }
}

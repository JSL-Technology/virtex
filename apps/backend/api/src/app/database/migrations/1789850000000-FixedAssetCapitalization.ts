import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * How an asset's cost entered the ledger (audit 2026-11-07, FINB-15).
 *
 * Registering an asset posted nothing, and nothing said how its cost had reached the books: the
 * register carried 122 800 of cost while the asset account stood at zero, and no report put the
 * two side by side. Every asset now states its capitalization:
 *
 * - `VENDOR_BILL`: the posted supplier bill that bought it debited its asset account;
 * - `JOURNAL_ENTRY`: an entry already in the books did — an opening balance, a cash purchase;
 * - `POSTED`: the register posted the acquisition itself, against the account it names;
 * - `UNLINKED`: an asset registered before this rule. The reconciliation lists it until it is
 *   linked; no asset registered from now on can be.
 *
 * The bill an asset was capitalized from can no longer be deleted from under it: its key refuses
 * a delete instead of emptying the link.
 */
export class FixedAssetCapitalization1789850000000 implements MigrationInterface {
  name = 'FixedAssetCapitalization1789850000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "capitalization_method" character varying(20) NOT NULL DEFAULT 'UNLINKED'`);
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "capitalization_entry_id" uuid`);
    await q.query(`ALTER TABLE "fixed_asset" ADD COLUMN "capitalization_offset_account_id" uuid`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "FK_fixed_asset_capitalization_entry"
        FOREIGN KEY ("capitalization_entry_id") REFERENCES "journal_entries"("id") ON DELETE NO ACTION`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "FK_fixed_asset_capitalization_offset_account"
        FOREIGN KEY ("capitalization_offset_account_id") REFERENCES "accounts"("id") ON DELETE NO ACTION`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_capitalization_entry" ON "fixed_asset" ("capitalization_entry_id")`);
    await q.query(`CREATE INDEX "IDX_fixed_asset_vendor_bill" ON "fixed_asset" ("vendor_bill_id")`);

    // What was registered from a bill was capitalized from it; the rest, before the rule.
    await q.query(`UPDATE "fixed_asset" SET "capitalization_method" = 'VENDOR_BILL' WHERE "vendor_bill_id" IS NOT NULL`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "CHK_fixed_asset_capitalization" CHECK (
        "capitalization_method" IN ('VENDOR_BILL', 'JOURNAL_ENTRY', 'POSTED', 'UNLINKED')
        AND ("capitalization_method" <> 'VENDOR_BILL' OR "vendor_bill_id" IS NOT NULL)
        AND (("capitalization_method" IN ('JOURNAL_ENTRY', 'POSTED')) = ("capitalization_entry_id" IS NOT NULL))
        AND (("capitalization_method" = 'POSTED') = ("capitalization_offset_account_id" IS NOT NULL))
      )`);

    // A bill that capitalized an asset is not deleted from under it.
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_vendor_bill"`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "FK_fixed_asset_vendor_bill"
        FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE NO ACTION`);

    // The entry and the offset account belong to the asset's company.
    await q.query(`SELECT virtex_install_same_tenant_guards()`);
  }

  public async down(q: QueryRunner): Promise<void> {
    const dropGuard = async (constraint: string) =>
      q.query(`
        DO $$ BEGIN
          EXECUTE format('DROP TRIGGER IF EXISTS %I ON "fixed_asset"', 'tg_same_tenant_' || substr(md5('${constraint}'), 1, 24));
        END $$`);
    await dropGuard('FK_fixed_asset_capitalization_entry');
    await dropGuard('FK_fixed_asset_capitalization_offset_account');
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_vendor_bill"`);
    await q.query(`
      ALTER TABLE "fixed_asset" ADD CONSTRAINT "FK_fixed_asset_vendor_bill"
        FOREIGN KEY ("vendor_bill_id") REFERENCES "vendor_bills"("id") ON DELETE SET NULL`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "CHK_fixed_asset_capitalization"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_fixed_asset_vendor_bill"`);
    await q.query(`DROP INDEX IF EXISTS "IDX_fixed_asset_capitalization_entry"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_capitalization_offset_account"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP CONSTRAINT IF EXISTS "FK_fixed_asset_capitalization_entry"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "capitalization_offset_account_id"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "capitalization_entry_id"`);
    await q.query(`ALTER TABLE "fixed_asset" DROP COLUMN IF EXISTS "capitalization_method"`);
  }
}

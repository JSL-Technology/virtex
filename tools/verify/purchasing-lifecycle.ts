/**
 * Executable proof that buying keeps the inventory account and the kardex describing the same
 * value (audit 2026-10-31, AP-05).
 *
 * ## What this exists to stop from happening again
 *
 *  - A supplier bill was accepted and posted against a purchase order still awaiting approval:
 *    inventory debited, and stock raised by an after-commit handler for goods nobody had ordered.
 *  - That handler ran after the bill's transaction: when it failed, the entry stood and the stock
 *    never moved — a log line was the only trace.
 *  - An invoice priced the received goods differently from the order and the whole difference went
 *    to the inventory account, while the average cost of the stock never heard of it; when it
 *    priced them lower, "goods received not invoiced" kept a residue that nothing would clear.
 *
 * This drives the real services against a real database and then asks the ledger and the stock
 * what they hold. It runs in CI.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource, EntityManager } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { PurchaseOrdersService } from '../../apps/backend/api/src/app/procurement/purchase-orders.service';
import { AccountsPayableService } from '../../apps/backend/api/src/app/accounts-payable/accounts-payable.service';
import { InventoryService } from '../../apps/backend/api/src/app/inventory/inventory.service';
import { AccountingPostingPort } from '../../apps/backend/api/src/app/journal-entries/accounting-posting.port';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { Supplier } from '../../apps/backend/api/src/app/suppliers/entities/supplier.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { VendorBillStatus } from '../../apps/backend/api/src/app/accounts-payable/entities/vendor-bill.entity';

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
  await app.init();

  const ds = app.get(DataSource);
  const organizations = app.get(OrganizationsService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const orders = app.get(PurchaseOrdersService, { strict: false });
  const payables = app.get(AccountsPayableService, { strict: false });
  const inventory = app.get(InventoryService, { strict: false });
  const posting = app.get(AccountingPostingPort, { strict: false });

  const stamp = Date.now();
  const actor = '00000000-0000-4000-8000-000000000001';
  // A second person: whoever submits a bill the three-way match holds may not release it (CMP-01).
  const approver = '00000000-0000-4000-8000-000000000002';
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const org = await organizations.create({
    planId: plan?.id,
    subscriptionStatus: 'active',
    subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    legalName: `Sonda Compras ${stamp}`,
    country: 'DO',
    fiscalRegionId: region!.id,
    address: 'Av. 27 de Febrero 100',
    city: 'Santo Domingo',
    state: '01',
    phone: '8095550102',
    email: `compras${stamp}@example.com`,
  });
  await localization.applyFiscalPackage(org, ds.manager);
  const orgId = org.id;
  const [settings] = await ds.query(
    `SELECT default_inventory_id AS inventory, default_goods_received_not_invoiced_account_id AS grni,
            default_cost_of_goods_sold_id AS cogs
       FROM organization_settings WHERE organization_id = $1`,
    [orgId],
  );

  const supplier = await ds.getRepository(Supplier).save(
    ds.getRepository(Supplier).create({ organizationId: orgId, name: `Suplidor sonda ${stamp}`, country: 'DO' } as Partial<Supplier>),
  );
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      name: `Mercancía de compra ${stamp}`, price: 200, cost: 0, stock: 0, organizationId: orgId,
      kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );

  /** Balance of a ledger account, debit minus credit, over posted entries. */
  const balance = async (accountId: string): Promise<number> => {
    const [row] = await ds.query(
      `SELECT COALESCE(SUM(l.debit - l.credit), 0)::float AS b
         FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.journal_entry_id
        WHERE e.organization_id = $1 AND l.account_id = $2 AND e.status IN ('Posted', 'Modified')`,
      [orgId, accountId],
    );
    return Number(row.b);
  };
  const kardex = async (): Promise<{ stock: number; cost: number; value: number }> => {
    const [row] = await ds.query(`SELECT stock::float AS stock, cost::float AS cost FROM products WHERE id = $1`, [product.id]);
    return { stock: Number(row.stock), cost: Number(row.cost), value: Math.round(Number(row.stock) * Number(row.cost) * 100) / 100 };
  };
  const tiesOut = async (label: string) => {
    const k = await kardex();
    const gl = await balance(settings.inventory);
    check(`${label}: la cuenta de inventario es lo que vale el kárdex`, near(gl, k.value), `mayor ${gl}, kárdex ${k.stock} × ${k.cost} = ${k.value}`);
  };

  // ── An order, 10 units at 100 ───────────────────────────────────────────────
  const order = await orders.create(
    { supplierId: supplier.id, lines: [{ productId: product.id, description: 'Mercancía', quantity: 10, unitPrice: 100 }] } as never,
    orgId,
    null,
  );
  const orderLineId = order.lines[0].id;
  const billFor = (unitPrice: number, extra: Record<string, unknown> = {}) =>
    payables.create(
      {
        vendorId: supplier.id,
        date: new Date().toISOString().slice(0, 10),
        dueDate: new Date().toISOString().slice(0, 10),
        purchaseOrderId: order.id,
        supplierInvoiceNumber: `SONDA-${stamp}-${unitPrice}`,
        lines: [{ product: 'Mercancía', productId: product.id, purchaseOrderLineId: orderLineId, quantity: 10, unitPrice }],
        ...extra,
      } as never,
      orgId,
      actor,
    );

  // ── An order nobody has approved cannot be billed ───────────────────────────
  let draftRefused = '';
  try {
    await billFor(100);
  } catch (error) {
    draftRefused = (error as { messageKey?: string }).messageKey ?? (error as Error).message;
  }
  check('una orden en borrador no se puede facturar', draftRefused === 'accounts_payable.purchase_order_not_billable', draftRefused || 'se aceptó');

  await orders.submit(order.id, orgId, null);
  await orders.approve(order.id, orgId, actor);
  await orders.send(order.id, orgId);

  // ── Billing before anything arrives is held, not booked (CMP-01) ────────────
  const early = await billFor(100, { supplierInvoiceNumber: `SONDA-${stamp}-antes` });
  const held = await payables.submitForApproval(early.id, orgId, actor);
  check(
    'facturar lo no recibido queda retenido',
    held.status === VendorBillStatus.ON_HOLD && held.matchExceptions?.[0]?.kind === 'QUANTITY',
    `${held.status} ${JSON.stringify(held.matchExceptions)}`,
  );
  check('la retenida no toca el mayor', near(await balance(settings.grni), 0), String(await balance(settings.grni)));
  await payables.voidBill(early.id, orgId, { reason: 'Prueba de retención' } as never, actor);

  await orders.receive(order.id, {} as never, orgId, actor);
  check('recibir valora la mercancía en GRNI', near(await balance(settings.grni), -1000), String(await balance(settings.grni)));
  await tiesOut('tras recibir');

  // ── Four units sold, at the cost they stand at ──────────────────────────────
  await ds.transaction(async (manager: EntityManager) => {
    const { unitCost } = await inventory.decreaseStock(product.id, 4, manager, orgId, {
      reference: 'Venta de sonda', sourceType: 'verify_seed', sourceId: null,
    });
    const [ledger] = await manager.query(`SELECT id FROM ledgers WHERE organization_id = $1 AND is_default`, [orgId]);
    const [journal] = await manager.query(`SELECT id FROM journals WHERE organization_id = $1 AND code = 'GENERAL'`, [orgId]);
    const amount = Math.round(4 * unitCost * 100) / 100;
    await posting.createWithManager(
      manager,
      {
        date: new Date().toISOString(),
        description: 'Costo de la venta de sonda',
        journalId: journal.id,
        lines: [
          { accountId: settings.cogs, debit: amount, credit: 0, description: 'Costo', valuations: [{ ledgerId: ledger.id, debit: amount, credit: 0 }] },
          { accountId: settings.inventory, debit: 0, credit: amount, description: 'Salida', valuations: [{ ledgerId: ledger.id, debit: 0, credit: amount }] },
        ],
      } as never,
      orgId,
      { actorUserId: actor, systemReason: 'verify-sale-cost' } as never,
    );
  });
  await tiesOut('tras vender 4');
  const cogsBefore = await balance(settings.cogs);

  // ── The supplier invoices the 10 at 110 ─────────────────────────────────────
  // 10 % over the order is outside the 2 % tolerance: held (CMP-01), and only someone else releases it.
  const bill = await billFor(110);
  const heldPrice = await payables.submitForApproval(bill.id, orgId, actor);
  check(
    'un precio fuera de tolerancia queda retenido',
    heldPrice.status === VendorBillStatus.ON_HOLD && heldPrice.matchExceptions?.[0]?.kind === 'PRICE',
    `${heldPrice.status} ${JSON.stringify(heldPrice.matchExceptions)}`,
  );
  let selfRelease = '';
  try {
    await payables.releaseMatchHold(bill.id, orgId, actor, 'Me lo apruebo yo mismo');
  } catch (error) {
    selfRelease = (error as { messageKey?: string }).messageKey ?? '';
  }
  check('quien la envió no puede liberarla', selfRelease === 'accounts_payable.match_hold_release_requires_another_person', selfRelease || 'se liberó');
  const posted = await payables.releaseMatchHold(bill.id, orgId, approver, 'Compras aceptó el nuevo precio del proveedor (sonda)');
  check('liberada con motivo, la factura se contabiliza', posted.status === VendorBillStatus.OPEN && Boolean(posted.matchReleaseReason), posted.status);
  check('la factura salda GRNI por completo', near(await balance(settings.grni), 0), String(await balance(settings.grni)));
  const afterBill = await kardex();
  // 100 of difference over 10 units; 6 remain, so 60 revalue them (to 110) and 40 is cost of sales.
  check('la diferencia sobre lo que queda revaloriza el costo promedio', near(afterBill.cost, 110), String(afterBill.cost));
  check('la diferencia sobre lo ya vendido va al costo de ventas', near((await balance(settings.cogs)) - cogsBefore, 40), String((await balance(settings.cogs)) - cogsBefore));
  check('la factura no recibe dos veces lo ya recibido', near(afterBill.stock, 6), String(afterBill.stock));
  await tiesOut('tras facturar a otro precio');

  // ── Voiding gives it all back ───────────────────────────────────────────────
  await payables.voidBill(bill.id, orgId, { reason: 'Prueba de anulación' } as never, actor);
  const afterVoid = await kardex();
  check('anular devuelve el costo promedio', near(afterVoid.cost, 100), String(afterVoid.cost));
  check('anular devuelve la mercancía a GRNI', near(await balance(settings.grni), -1000), String(await balance(settings.grni)));
  await tiesOut('tras anular');

  // ── A cheaper invoice clears GRNI too ───────────────────────────────────────
  const cheaper = await billFor(90, { supplierInvoiceNumber: `SONDA-${stamp}-90b` });
  const cheaperHeld = await payables.submitForApproval(cheaper.id, orgId, actor);
  check('un precio 10 % menor también se retiene', cheaperHeld.status === VendorBillStatus.ON_HOLD, cheaperHeld.status);
  await payables.releaseMatchHold(cheaper.id, orgId, approver, 'Descuento del proveedor aceptado (sonda)');
  check('una factura más barata también salda GRNI', near(await balance(settings.grni), 0), String(await balance(settings.grni)));
  check('y rebaja el costo de lo que queda', near((await kardex()).cost, 90), String((await kardex()).cost));
  await tiesOut('tras facturar más barato');

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log('\nCOMPRAR MANTIENE EL MAYOR Y EL KÁRDEX DE ACUERDO');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

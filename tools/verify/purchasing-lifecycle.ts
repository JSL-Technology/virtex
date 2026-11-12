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
import { LandedCostsService } from '../../apps/backend/api/src/app/procurement/landed-costs.service';
import { GoodsReceiptsService } from '../../apps/backend/api/src/app/procurement/goods-receipts.service';
import { PurchaseOrderStatus } from '../../apps/backend/api/src/app/procurement/entities/purchase-order.entity';
import { RfqsService } from '../../apps/backend/api/src/app/procurement/rfqs.service';
import { PurchaseAgreementsService } from '../../apps/backend/api/src/app/procurement/purchase-agreements.service';

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
  const landedCosts = app.get(LandedCostsService, { strict: false });
  const goodsReceipts = app.get(GoodsReceiptsService, { strict: false });
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

  // ── A freight bill revalues what is left, and only that (CMP-21) ────────────
  // 100 of freight over the receipt of 10 units: 6 are still on the shelf, so 60 raise their
  // average cost (90 → 100) and the 40 that belong to the 4 already sold are cost of sales.
  const [freightAccount] = await ds.query(
    `SELECT id FROM accounts WHERE organization_id = $1 AND system_role = 'ACCOUNTS_PAYABLE' LIMIT 1`,
    [orgId],
  );
  const [freight] = await ds.query(
    `INSERT INTO landed_costs (organization_id, name, "allocationMethod", gl_account_id) VALUES ($1, 'Flete de sonda', 'VALUE', $2) RETURNING id`,
    [orgId, freightAccount.id],
  );
  const [receipt] = await ds.query(`SELECT id FROM purchase_order_receipts WHERE order_id = $1 LIMIT 1`, [order.id]);
  const cogsBeforeFreight = await balance(settings.cogs);
  const applied = await landedCosts.apply({ landedCostId: freight.id, receiptIds: [receipt.id], amount: 100, reference: `SONDA-${stamp}-flete` }, orgId, actor);
  check('el flete revaloriza lo que queda en almacén', near((await kardex()).cost, 100), String((await kardex()).cost));
  check('la parte de lo vendido va al costo de ventas', near((await balance(settings.cogs)) - cogsBeforeFreight, 40), String((await balance(settings.cogs)) - cogsBeforeFreight));
  await tiesOut('tras aplicar el flete');
  await landedCosts.void(applied.id, 'Anulación de sonda', orgId, actor);
  check('anular el flete devuelve el costo promedio', near((await kardex()).cost, 90), String((await kardex()).cost));
  await tiesOut('tras anular el flete');

  // ── Part of a delivery goes back; the rest of the order is closed short (CMP-15) ──
  const second = await orders.create(
    { supplierId: supplier.id, lines: [{ productId: product.id, description: 'Mercancía', quantity: 10, unitPrice: 90 }] } as never,
    orgId,
    null,
  );
  await orders.submit(second.id, orgId, null);
  await orders.approve(second.id, orgId, actor);
  await orders.send(second.id, orgId);
  const stockBefore = (await kardex()).stock;
  const { receipt: partial } = await orders.receiveDocument(second.id, { lines: [{ lineId: second.lines[0].id, quantity: 6 }] } as never, orgId, actor);
  const returned = await goodsReceipts.returnToSupplier(partial.id, { lines: [{ lineId: second.lines[0].id, quantity: 2 }], reason: 'Llegaron dañadas (sonda)' }, orgId, actor);
  check('la devolución saca del almacén solo lo devuelto', near((await kardex()).stock - stockBefore, 4), String((await kardex()).stock - stockBefore));
  check('y queda como documento numerado', /^DEV-/.test(returned.number), returned.number);
  await tiesOut('tras devolver parte de la recepción');
  const closed = await orders.close(second.id, orgId, 'El proveedor no entregará el resto (sonda)');
  check('la orden se cierra con saldo pendiente', closed.status === PurchaseOrderStatus.CLOSED, closed.status);
  let refused = '';
  try {
    await orders.receiveDocument(second.id, { lines: [{ lineId: second.lines[0].id, quantity: 1 }] } as never, orgId, actor);
  } catch (error) {
    refused = (error as { messageKey?: string }).messageKey ?? '';
  }
  check('una orden cerrada ya no recibe', refused === 'procurement.order_not_receivable', refused || 'se recibió');

  // ── Over-delivery: refused at 0 %, accepted within the company's tolerance, enforced by the table ──
  const third = await orders.create(
    { supplierId: supplier.id, lines: [{ productId: product.id, description: 'Mercancía', quantity: 10, unitPrice: 90 }] } as never,
    orgId,
    null,
  );
  await orders.submit(third.id, orgId, null);
  await orders.approve(third.id, orgId, actor);
  await orders.send(third.id, orgId);
  let over = '';
  try {
    await orders.receiveDocument(third.id, { lines: [{ lineId: third.lines[0].id, quantity: 10.5 }] } as never, orgId, actor);
  } catch (error) {
    over = (error as { messageKey?: string }).messageKey ?? 'rechazada';
  }
  check('sin tolerancia, recibir de más se rechaza', over !== '', over || 'se recibió');
  await ds.query(`UPDATE organization_settings SET po_receipt_over_tolerance_bps = 500 WHERE organization_id = $1`, [orgId]);
  const { order: overReceived } = await orders.receiveDocument(third.id, { lines: [{ lineId: third.lines[0].id, quantity: 10.5 }] } as never, orgId, actor);
  check('con 5 % de tolerancia, 10,5 de 10 se acepta', overReceived.status === PurchaseOrderStatus.RECEIVED, overReceived.status);
  let tableRefused = '';
  try {
    await ds.query(`UPDATE purchase_order_lines SET received_quantity = 11 WHERE id = $1`, [third.lines[0].id]);
  } catch (error) {
    tableRefused = (error as { constraint?: string }).constraint ?? 'rechazada';
  }
  check('la tabla impide pasar la tolerancia aunque se salte el servicio', tableRefused === 'CHK_purchase_order_lines_received_within_ordered', tableRefused || 'se escribió');
  await tiesOut('tras recibir dentro de la tolerancia');

  // ── Requests for quotation: compared, awarded once, at the quoted price (CMP-15) ──
  const rfqs = app.get(RfqsService, { strict: false });
  const agreementsService = app.get(PurchaseAgreementsService, { strict: false });
  const rival = await ds.getRepository(Supplier).save(
    ds.getRepository(Supplier).create({ organizationId: orgId, name: `Suplidor rival ${stamp}`, country: 'DO' } as Partial<Supplier>),
  );
  const rfq = await rfqs.create(
    { title: 'Cotización de sonda', supplierIds: [supplier.id, rival.id], lines: [{ productId: product.id, description: 'Mercancía', quantity: 10 }] } as never,
    orgId,
    actor,
  );
  await rfqs.send(rfq.id, orgId);
  const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const cheap = await rfqs.recordQuote(rfq.id, { supplierId: supplier.id, validUntil: in30, lines: [{ rfqLineId: rfq.lines[0].id, unitPrice: 88 }] } as never, orgId);
  const dear = await rfqs.recordQuote(rfq.id, { supplierId: rival.id, validUntil: in30, leadTimeDays: 1, lines: [{ rfqLineId: rfq.lines[0].id, unitPrice: 95 }] } as never, orgId);
  const comparison = await rfqs.comparison(rfq.id, orgId);
  check('la comparación marca la más baja', comparison.quotes.find((q) => q.cheapest)?.quoteId === cheap.id);
  let dearRefused = '';
  try {
    await rfqs.award(rfq.id, { quoteId: dear.id } as never, orgId, actor);
  } catch (error) {
    dearRefused = (error as { messageKey?: string }).messageKey ?? '';
  }
  check('adjudicar la más cara sin motivo se rechaza', dearRefused === 'procurement.award_not_cheapest_needs_reason', dearRefused || 'adjudicada');
  const awardedOrder = await rfqs.award(rfq.id, { quoteId: cheap.id } as never, orgId, actor);
  check('la adjudicación crea la orden al precio cotizado', Number(awardedOrder.lines[0].unitPrice) === 88 && awardedOrder.supplierQuoteId === cheap.id, `${awardedOrder.number} a ${awardedOrder.lines[0].unitPrice}`);
  let twice = '';
  try {
    await rfqs.award(rfq.id, { quoteId: dear.id, reason: 'otra vez' } as never, orgId, actor);
  } catch (error) {
    twice = (error as { messageKey?: string }).messageKey ?? '';
  }
  check('una solicitud se adjudica una sola vez', twice === 'procurement.rfq_not_open_for_quotes', twice || 'dos veces');

  // ── An agreement: releases at its price, within its ceiling, read from the orders ──
  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const agreement = await agreementsService.create(
    { title: 'Acuerdo de sonda', supplierId: supplier.id, validFrom: twoDaysAgo, validTo: in30, lines: [{ productId: product.id, description: 'Mercancía', unitPrice: 85, maxQuantity: 10 }] } as never,
    orgId,
    actor,
  );
  await agreementsService.activate(agreement.id, orgId, actor);
  const [releasedA, releasedB] = await Promise.allSettled([
    agreementsService.release(agreement.id, { lines: [{ agreementLineId: agreement.lines[0].id, quantity: 7 }] } as never, orgId, actor),
    agreementsService.release(agreement.id, { lines: [{ agreementLineId: agreement.lines[0].id, quantity: 7 }] } as never, orgId, actor),
  ]);
  const won = [releasedA, releasedB].filter((r) => r.status === 'fulfilled');
  const refusedRelease = [releasedA, releasedB].find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
  check('dos entregas a la vez no pasan el tope', won.length === 1 && refusedRelease?.reason?.messageKey === 'procurement.agreement_line_exhausted', `${won.length} aceptada(s) · ${refusedRelease?.reason?.messageKey ?? '—'}`);
  const release = (won[0] as PromiseFulfilledResult<{ id: string; lines: Array<{ unitPrice: number }> }>).value;
  check('la entrega va al precio pactado', Number(release.lines[0].unitPrice) === 85, String(release.lines[0].unitPrice));
  await orders.cancel(release.id, orgId, 'Sonda: anular la entrega');
  const afterCancel = await agreementsService.findOne(agreement.id, orgId);
  check('anular la entrega devuelve sus unidades al acuerdo', afterCancel.usage[0].usedQuantity === 0 && afterCancel.usage[0].remainingQuantity === 10, JSON.stringify(afterCancel.usage[0]));

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

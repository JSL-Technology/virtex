/**
 * Executable proof of the distributor's cycle and of recurring invoicing, against a real database.
 *
 * Order → conduces → invoice:
 *  - an order of goods and a service is priced by the invoice engine;
 *  - a partial conduce moves the stock out of the warehouse, and the order shows it partially
 *    delivered; delivering more than remains is refused;
 *  - invoicing bills the delivered goods and the service as an E31, WITHOUT moving the stock a
 *    second time, and marks the conduce invoiced;
 *  - a conduce voided before invoicing brings the goods back;
 *  - delivering and invoicing the rest closes the order; a delivered order cannot be cancelled;
 *  - an accepted quote becomes an order once.
 *
 * Recurring invoices:
 *  - a monthly template started three months ago issues the three missed months on its first run,
 *    dated each month, and leaves the next date in the future;
 *  - running again issues nothing: one invoice per template and date;
 *  - a template on the 31st bills on the last day of shorter months.
 */
import 'reflect-metadata';

process.env['ECF_ALLOW_TEST_CERTIFICATES'] = 'true';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { ComplianceService } from '../../apps/backend/api/src/app/compliance/compliance.service';
import { CustomersService } from '../../apps/backend/api/src/app/customers/customers.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { StockLedgerService } from '../../apps/backend/api/src/app/inventory/stock-ledger.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { NcfType } from '../../apps/backend/api/src/app/compliance/entities/ncf-sequence.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { EcfCertificateService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-certificate.service';
import { SalesOrdersService } from '../../apps/backend/api/src/app/sales/services/sales-orders.service';
import { QuotesService } from '../../apps/backend/api/src/app/sales/services/quotes.service';
import { RecurringInvoicesService } from '../../apps/backend/api/src/app/invoices/recurring-invoices.service';
import { RecurringFrequency } from '../../apps/backend/api/src/app/invoices/entities/recurring-invoice.entity';
import { runAsTenantJob } from '../../apps/backend/api/src/app/shared/tenancy/tenant-job';
import { makeTestCertificate } from './support/test-certificate';

function dominicanRnc(prefix: string): string {
  const weights = [7, 9, 8, 6, 5, 4, 3, 2];
  const base = prefix.padStart(8, '0').slice(0, 8);
  const sum = base.split('').reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const remainder = sum % 11;
  const digit = remainder === 0 ? 2 : remainder === 1 ? 1 : 11 - remainder;
  return `${base}${digit}`;
}

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

async function refused(work: () => Promise<unknown>): Promise<boolean> {
  try {
    await work();
    return false;
  } catch {
    return true;
  }
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
  await app.init();
  const ds = app.get(DataSource);
  const compliance = app.get(ComplianceService, { strict: false });
  const customers = app.get(CustomersService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });
  const ledger = app.get(StockLedgerService, { strict: false });
  const certificates = app.get(EcfCertificateService, { strict: false });
  const orders = app.get(SalesOrdersService, { strict: false });
  const quotes = app.get(QuotesService, { strict: false });
  const recurring = app.get(RecurringInvoicesService, { strict: false });

  const stamp = Date.now();
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const org = await organizations.create({
    planId: plan?.id, subscriptionStatus: 'active', subscriptionPeriodEnd: new Date(Date.now() + 30 * 864e5),
    legalName: `Distribuidora Sonda ${stamp}`, taxId: dominicanRnc(String(13700000 + (stamp % 300000))), country: 'DO',
    fiscalRegionId: region!.id, address: 'Autopista Duarte km 10', city: 'Santo Domingo Oeste', state: '32',
    phone: '8095550144', email: `dist${stamp}@example.com`,
  });
  await localization.applyFiscalPackage(org, ds.manager);
  const orgId = org.id;
  const expiresAt = `${new Date().getFullYear() + 1}-12-31`;
  for (const type of [NcfType.E31, NcfType.E32, NcfType.E34]) {
    await compliance.provisionNcfSequence(orgId, { type, prefix: type, startsAt: 1, endsAt: 500, expiresAt });
  }
  const cert = makeTestCertificate('DISTRIBUIDORA SONDA', 30, org.taxId as string);
  await runAsTenantJob(ds, orgId, () => certificates.upload(orgId, { pfx: cert.pfx, password: cert.password, alias: 'Sonda' }));

  const products = ds.getRepository(Product);
  const goods = await products.save(products.create({
    name: `Caja de agua ${stamp}`, price: 100, cost: 60, stock: 0, organizationId: orgId,
    kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'CJ',
  } as Partial<Product>));
  const service = await products.save(products.create({
    name: `Flete ${stamp}`, price: 500, cost: 0, stock: 0, organizationId: orgId,
    kind: ProductKind.SERVICE, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
  } as Partial<Product>));
  await ds.transaction(async (manager) =>
    ledger.move(manager, orgId, {
      productId: goods.id, warehouseId: await ledger.resolveWarehouse(manager, orgId, {}), quantity: 100,
      unitCost: 60, type: 'OPENING', reference: 'Saldo inicial', sourceType: 'verify_seed', sourceId: null,
    }),
  );
  const customer: { id: string } = await customers.create({
    companyName: 'Colmado Sonda SRL', email: `colmado${stamp}@example.com`, phone: '8095550145',
    taxId: dominicanRnc(String(10300000 + (stamp % 500000))), identityDocumentTypeCode: 'RNC', address: 'Calle 3, Los Mina', country: 'DO',
  } as never, orgId);
  const [actor] = await ds.query(`SELECT id FROM "users" ORDER BY "created_at" LIMIT 1`);
  const actorId: string = actor?.id ?? '00000000-0000-4000-8000-000000000000';

  const stockOut = async () => {
    const [row] = await ds.query(
      `SELECT coalesce(sum(-quantity), 0)::numeric AS out FROM stock_movements WHERE organization_id = $1 AND product_id = $2 AND type IN ('SALE_DISPATCH', 'SALE_RETURN')`,
      [orgId, goods.id],
    );
    return Number(row.out);
  };

  // ── Order → conduces → invoice ─────────────────────────────────────────────
  const order = await runAsTenantJob(ds, orgId, () =>
    orders.create({
      customerId: customer.id, customerReference: 'OC-777',
      lines: [
        { productId: goods.id, description: 'Caja de agua', quantity: 10 },
        { productId: service.id, description: 'Flete', quantity: 1 },
      ],
    }, orgId, actorId),
  );
  check('el pedido se numera y se valora con el motor de facturación', order.orderNumber.startsWith('PED-') && Number(order.total) === 1770, `${order.orderNumber} ${order.total}`);
  const goodsLine = order.lines.find((l) => l.productId === goods.id)!;
  const serviceLine = order.lines.find((l) => l.productId === service.id)!;
  check('la mercancía se marca como inventariable y el flete no', goodsLine.isStocked && !serviceLine.isStocked);

  const first = await runAsTenantJob(ds, orgId, () =>
    orders.deliver(orgId, order.id, { lines: [{ orderLineId: goodsLine.id, quantity: 4 }], driverName: 'Juan Pérez', vehiclePlate: 'l123456' }, actorId),
  );
  check('el conduce se numera', first.number.startsWith('CON-'), first.number);
  check('el conduce saca la mercancía del almacén', (await stockOut()) === 4, `${await stockOut()} salidas`);
  let view = await runAsTenantJob(ds, orgId, () => orders.get(orgId, order.id));
  check('el pedido queda parcialmente entregado', view.status === 'PARTIALLY_DELIVERED', view.status);
  check('no se puede entregar más de lo pendiente', await refused(() =>
    runAsTenantJob(ds, orgId, () => orders.deliver(orgId, order.id, { lines: [{ orderLineId: goodsLine.id, quantity: 7 }] }, actorId))));

  const invoice1 = await runAsTenantJob(ds, orgId, () => orders.invoice(orgId, order.id, actorId));
  check('se factura lo entregado y el servicio como E31', Boolean(invoice1.fiscalNumber?.startsWith('E31')) && Number(invoice1.total) === 1062, `${invoice1.fiscalNumber} ${invoice1.total}`);
  check('facturar no vuelve a mover el inventario', (await stockOut()) === 4, `${await stockOut()} salidas`);
  const [firstNote] = await ds.query(`SELECT status, invoice_id FROM delivery_notes WHERE id = $1`, [first.id]);
  check('el conduce queda facturado y enlazado', firstNote?.status === 'INVOICED' && firstNote?.invoice_id === invoice1.id);
  check('no hay nada más que facturar hasta la próxima entrega', await refused(() => runAsTenantJob(ds, orgId, () => orders.invoice(orgId, order.id, actorId))));

  const second = await runAsTenantJob(ds, orgId, () => orders.deliver(orgId, order.id, { lines: [{ orderLineId: goodsLine.id, quantity: 6 }] }, actorId));
  view = await runAsTenantJob(ds, orgId, () => orders.get(orgId, order.id));
  check('con todo despachado, el pedido queda entregado', view.status === 'DELIVERED', view.status);
  check('un pedido con entregas no se puede cancelar', await refused(() => runAsTenantJob(ds, orgId, () => orders.cancel(orgId, order.id, 'cliente desistió'))));

  await runAsTenantJob(ds, orgId, () => orders.voidDelivery(orgId, second.id, 'Mercancía devuelta en puerta'));
  view = await runAsTenantJob(ds, orgId, () => orders.get(orgId, order.id));
  check('anular un conduce devuelve la mercancía', (await stockOut()) === 4 && view.status === 'PARTIALLY_DELIVERED', `${await stockOut()} · ${view.status}`);

  await runAsTenantJob(ds, orgId, () => orders.deliver(orgId, order.id, { lines: [{ orderLineId: goodsLine.id, quantity: 6 }] }, actorId));
  const invoice2 = await runAsTenantJob(ds, orgId, () => orders.invoice(orgId, order.id, actorId));
  view = await runAsTenantJob(ds, orgId, () => orders.get(orgId, order.id));
  check('el resto se factura y el pedido se cierra', Number(invoice2.total) === 708 && view.status === 'CLOSED', `${invoice2.total} · ${view.status}`);
  check('en total salieron exactamente las 10 cajas', (await stockOut()) === 10, `${await stockOut()}`);

  // ── From a quote ───────────────────────────────────────────────────────────
  if (actor?.id) {
    const today = new Date().toISOString().slice(0, 10);
    const quote = await runAsTenantJob(ds, orgId, () =>
      quotes.create({
        customerId: customer.id, issueDate: today, expiryDate: today,
        lines: [{ productId: goods.id, description: 'Caja de agua', quantity: 3 }],
      } as never, orgId, { id: actorId }),
    );
    await runAsTenantJob(ds, orgId, () => quotes.markSent(quote.id, orgId));
    await runAsTenantJob(ds, orgId, () => quotes.accept(quote.id, orgId));
    const fromQuote = await runAsTenantJob(ds, orgId, () => orders.fromQuote(quote.id, orgId, actorId));
    check('una cotización aceptada se convierte en pedido', fromQuote.quoteId === quote.id && Number(fromQuote.lines[0].quantity) === 3);
    check('la misma cotización no se convierte dos veces', await refused(() => runAsTenantJob(ds, orgId, () => orders.fromQuote(quote.id, orgId, actorId))));
  }

  // ── Recurring invoices ─────────────────────────────────────────────────────
  const now = new Date();
  const threeMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1)).toISOString().slice(0, 10);
  const template = await runAsTenantJob(ds, orgId, () =>
    recurring.create({
      customerId: customer.id, name: 'Iguala de mantenimiento', frequency: RecurringFrequency.MONTHLY,
      startDate: threeMonthsAgo, paymentTermDays: 15, autoIssue: true,
      lines: [{ productId: service.id, description: 'Mantenimiento mensual', quantity: 1, unitPrice: 2500 }],
    }, orgId, actorId),
  );
  const createdFirst = await runAsTenantJob(ds, orgId, () => recurring.runDue(orgId));
  const runs = await runAsTenantJob(ds, orgId, () => recurring.runs(orgId, template.id));
  check('el primer ciclo emite los tres meses pendientes', createdFirst === 3 && runs.length === 3, `${createdFirst} facturas`);
  const [issued] = await ds.query(
    `SELECT count(*)::int AS n, min(fiscal_number) AS ncf FROM invoices WHERE organization_id = $1 AND notes LIKE 'Iguala de mantenimiento%'`,
    [orgId],
  );
  check('cada mes es un comprobante emitido', issued?.n === 3 && String(issued?.ncf ?? '').startsWith('E31'), `${issued?.n} · ${issued?.ncf}`);
  const after = await runAsTenantJob(ds, orgId, () => recurring.get(orgId, template.id));
  check('la próxima fecha queda en el futuro', Boolean(after.nextRunDate && after.nextRunDate > now.toISOString().slice(0, 10)), after.nextRunDate ?? 'null');
  const createdAgain = await runAsTenantJob(ds, orgId, () => recurring.runDue(orgId));
  check('volver a ejecutar no factura dos veces el mismo mes', createdAgain === 0, `${createdAgain}`);
  check('una plantilla del 31 factura el último día de febrero', RecurringInvoicesService.advance('2026-01-31', '2026-01-31', RecurringFrequency.MONTHLY) === '2026-02-28');

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nEl ciclo pedido → conduce → factura y la facturación recurrente funcionan.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Executable proof that a Dominican till sale is a fiscal document.
 *
 * ## What this exists to stop from happening again
 *
 * The point of sale rang a sale, moved stock and printed a ticket — and nothing else. No e-NCF was
 * drawn, nothing was posted to the ledger, nothing reached the 607 and nothing was transmitted to
 * the DGII. In the Dominican Republic that is a sale without a comprobante, and it was the path most
 * of the product's target customers (colmados, tiendas, restaurantes) would sell through.
 *
 * This drives the real services against a real database and asks the database what happened:
 *
 *  - an unidentified sale is an E32 to the company's «Consumidor final»;
 *  - a sale to a buyer who gives an RNC is an E31 naming them, with the customer created on the spot;
 *  - each sale is posted (revenue, ITBIS, cost of sale) and settled by receipts into the till's cash
 *    account, net of change, so the receivable it created is closed;
 *  - each document is registered for transmission and signed (security code and QR exist);
 *  - an invalid RNC is refused before anything is consumed;
 *  - a void issues a credit note (E34) against the sale and reverses its receipts.
 */
import 'reflect-metadata';

process.env['ECF_ALLOW_TEST_CERTIFICATES'] = 'true';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { randomUUID } from 'node:crypto';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { ComplianceService } from '../../apps/backend/api/src/app/compliance/compliance.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { StockLedgerService } from '../../apps/backend/api/src/app/inventory/stock-ledger.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { NcfType } from '../../apps/backend/api/src/app/compliance/entities/ncf-sequence.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { EcfCertificateService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-certificate.service';
import { EcfSubmissionService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-submission.service';
import { PosService } from '../../apps/backend/api/src/app/pos/pos.service';
import { runAsTenantJob } from '../../apps/backend/api/src/app/shared/tenancy/tenant-job';
import { makeTestCertificate } from './support/test-certificate';

/** Dominican RNC check digit: weights 7-9-8-6-5-4-3-2, modulo 11. */
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

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
  await app.init();

  const ds = app.get(DataSource);
  const compliance = app.get(ComplianceService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });
  const ledger = app.get(StockLedgerService, { strict: false });
  const certificates = app.get(EcfCertificateService, { strict: false });
  const submissions = app.get(EcfSubmissionService, { strict: false });
  const pos = app.get(PosService, { strict: false });

  const stamp = Date.now();
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const org = await organizations.create({
    planId: plan?.id,
    subscriptionStatus: 'active',
    subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    legalName: `Sonda Caja ${stamp}`,
    taxId: dominicanRnc(String(13200000 + (stamp % 700000))),
    country: 'DO',
    fiscalRegionId: region!.id,
    address: 'Calle El Conde 101',
    city: 'Santo Domingo',
    state: '01',
    phone: '8095550199',
    email: `caja${stamp}@example.com`,
  });
  await localization.applyFiscalPackage(org, ds.manager);
  const orgId = org.id;
  const expiresAt = `${new Date().getFullYear() + 1}-12-31`;
  for (const type of [NcfType.E31, NcfType.E32, NcfType.E34]) {
    await compliance.provisionNcfSequence(orgId, { type, prefix: type, startsAt: 1, endsAt: 100, expiresAt });
  }
  const certificate = makeTestCertificate('SONDA CAJA', 30, org.taxId as string);
  await runAsTenantJob(ds, orgId, () =>
    certificates.upload(orgId, { pfx: certificate.pfx, password: certificate.password, alias: 'Caja' }),
  );

  const productRepo = ds.getRepository(Product);
  const good = await productRepo.save(
    productRepo.create({
      name: `Arroz ${stamp}`, price: 100, cost: 60, stock: 0, organizationId: orgId,
      kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );
  await ds.transaction(async (manager) =>
    ledger.move(manager, orgId, {
      productId: good.id,
      warehouseId: await ledger.resolveWarehouse(manager, orgId, {}),
      quantity: 50,
      unitCost: 60,
      type: 'OPENING',
      reference: 'Saldo inicial',
      sourceType: 'verify_seed',
      sourceId: null,
    }),
  );

  // A cashier who can also void: the till's principal, as the guard would hand it over.
  const [anyUser] = await ds.query(`SELECT id FROM "users" ORDER BY "created_at" LIMIT 1`);
  const cashier = {
    id: anyUser?.id ?? randomUUID(),
    organizationId: orgId,
    permissions: ['pos:view', 'pos:operate', 'pos:manage_shifts'],
  } as never;

  const context = await runAsTenantJob(ds, orgId, () => pos.context(orgId));
  check('la caja de una empresa dominicana emite comprobante por venta', context.issuesFiscalDocuments === true);

  const terminalId = `CAJA-${stamp}`;
  await runAsTenantJob(ds, orgId, () =>
    pos.openShift(orgId, (cashier as { id: string }).id, { terminalId, openingBalance: 1000 } as never),
  );

  // ── Consumo: an unidentified sale ─────────────────────────────────────────
  const consumo = await runAsTenantJob(ds, orgId, () =>
    pos.processSale(orgId, cashier, {
      terminalId,
      items: [{ productId: good.id, price: 100, quantity: 2 }],
      subtotal: 200,
      tax: 36,
      total: 236,
      payments: [{ method: 'cash', amount: 300 }],
    } as never),
  );
  check('una venta sin identificar sale como E32', Boolean(consumo.fiscalNumber?.startsWith('E32')), consumo.fiscalNumber ?? 'sin e-NCF');
  check('la venta queda enlazada a su factura', Boolean(consumo.invoiceId));

  const [invoice] = await ds.query(
    `SELECT i."status", i."balance"::numeric AS balance, i."journal_entry_id" AS je, c."is_final_consumer" AS fc
       FROM invoices i JOIN customers c ON c.id = i."customer_id" WHERE i.id = $1`,
    [consumo.invoiceId],
  );
  check('la factura de consumo va al «Consumidor final»', invoice?.fc === true);
  check('la factura se contabiliza', Boolean(invoice?.je));
  check('el cobro salda la factura', Number(invoice?.balance) === 0 && invoice?.status === 'Paid', `${invoice?.status} ${invoice?.balance}`);

  const [receipt] = await ds.query(
    `SELECT p."total_amount"::numeric AS total, b."account_type" AS kind
       FROM customer_payments p JOIN bank_accounts b ON b.id = p."bank_account_id"
      WHERE p.id = $1`,
    [consumo.receiptIds[0]],
  );
  check('el efectivo entra en la caja, neto del cambio', Number(receipt?.total) === 236 && receipt?.kind === 'CASH', `${receipt?.total} en ${receipt?.kind}`);

  const [movement] = await ds.query(
    `SELECT count(*)::int AS n FROM stock_movements WHERE "organization_id" = $1 AND "product_id" = $2 AND "type" = 'SALE_DISPATCH'`,
    [orgId, good.id],
  );
  check('el inventario sale una sola vez (por la caja, no otra vez por la factura)', movement?.n === 1, `${movement?.n} salidas`);

  // The transmission runs after the commit; drive it here and wait for the signature.
  await runAsTenantJob(ds, orgId, () => submissions.submitInvoice(consumo.invoiceId as string, orgId)).catch(() => null);
  const fiscal = await runAsTenantJob(ds, orgId, () => pos.fiscalStatus(orgId, consumo.id));
  check('el comprobante se firma: hay código de seguridad', Boolean(fiscal.securityCode), fiscal.status ?? 'sin envío');
  check('el ticket tiene la URL del QR de timbre', Boolean(fiscal.qrUrl?.includes(String(fiscal.securityCode ?? '')).valueOf()));

  // ── Crédito fiscal: a buyer who gives an RNC ───────────────────────────────
  const buyerRnc = dominicanRnc(String(10200000 + (stamp % 600000)));
  const credito = await runAsTenantJob(ds, orgId, () =>
    pos.processSale(orgId, cashier, {
      terminalId,
      items: [{ productId: good.id, price: 100, quantity: 1 }],
      subtotal: 100,
      tax: 18,
      total: 118,
      customerTaxId: buyerRnc,
      customerName: 'Ferretería Sonda SRL',
      payments: [{ method: 'card', amount: 118, reference: '4242' }],
    } as never),
  );
  check('una venta con RNC sale como E31', Boolean(credito.fiscalNumber?.startsWith('E31')), credito.fiscalNumber ?? 'sin e-NCF');
  const [buyer] = await ds.query(`SELECT "companyName" AS name, "taxId" FROM customers WHERE id = $1`, [credito.customerId]);
  check('el comprador se crea con su RNC', buyer?.taxId === buyerRnc && buyer?.name === 'Ferretería Sonda SRL');

  let invalidRefused = false;
  const sequenceBefore = await ds.query(
    `SELECT "current_sequence" AS n FROM ncf_sequences WHERE "organization_id" = $1 AND "type" = 'E31'`,
    [orgId],
  ).catch(() => [] as Array<{ n: number }>);
  try {
    await runAsTenantJob(ds, orgId, () =>
      pos.processSale(orgId, cashier, {
        terminalId,
        items: [{ productId: good.id, price: 100, quantity: 1 }],
        subtotal: 100,
        tax: 18,
        total: 118,
        customerTaxId: '101000002',
        customerName: 'RNC inválido',
        payments: [{ method: 'cash', amount: 118 }],
      } as never),
    );
  } catch (error) {
    invalidRefused = (error as { messageKey?: string }).messageKey === 'pos.buyer_tax_id_invalid' || /buyer_tax_id_invalid/.test(String((error as Error).message));
  }
  check('un RNC con dígito verificador inválido se rechaza', invalidRefused);
  const sequenceAfter = await ds.query(
    `SELECT "current_sequence" AS n FROM ncf_sequences WHERE "organization_id" = $1 AND "type" = 'E31'`,
    [orgId],
  ).catch(() => [] as Array<{ n: number }>);
  check('el rechazo no consume numeración', JSON.stringify(sequenceBefore) === JSON.stringify(sequenceAfter));

  // ── Void: a credit note against the sale ───────────────────────────────────
  const voided = await runAsTenantJob(ds, orgId, () =>
    pos.voidSale(orgId, consumo.id, { reason: 'Cobro duplicado' } as never, cashier),
  );
  check('anular la venta emite una nota de crédito', Boolean(voided.creditNoteId));
  const [note] = await ds.query(`SELECT "fiscal_number" AS ncf FROM invoices WHERE id = $1`, [voided.creditNoteId]);
  check('la nota de crédito es un E34', Boolean(note?.ncf?.startsWith('E34')), note?.ncf ?? 'sin e-NCF');
  const [reversed] = await ds.query(`SELECT "status" FROM customer_payments WHERE id = $1`, [consumo.receiptIds[0]]);
  check('el cobro de la venta anulada se revierte', reversed?.status === 'VOID', reversed?.status);
  const [restock] = await ds.query(
    `SELECT count(*)::int AS n FROM stock_movements WHERE "organization_id" = $1 AND "product_id" = $2 AND "type" = 'SALE_RETURN'`,
    [orgId, good.id],
  );
  check('la mercancía vuelve una sola vez', restock?.n === 1, `${restock?.n} entradas`);

  // ── The IT-1 reconciles with what the till issued ──────────────────────────
  // E32 (ITBIS 36) + E31 (18) − E34 cancelling the E32 (36) = 18 charged in the month.
  const now = new Date();
  const it1 = await runAsTenantJob(ds, orgId, () => compliance.it1(orgId, now.getFullYear(), now.getMonth() + 1));
  const charged = it1.lines.find((l) => l.code === 'it1.tax.charged')?.amount;
  check('el IT-1 del mes cuadra con las ventas de caja y su nota de crédito', charged === 18, `ITBIS cobrado ${charged}`);

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nLa venta de caja es un comprobante fiscal.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

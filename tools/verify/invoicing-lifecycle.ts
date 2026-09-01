/**
 * Executable proof that a freshly provisioned tenant can issue a compliant fiscal document, that
 * issuing it moves the ledger, and that crediting it cannot be done twice.
 *
 * ## What this exists to stop from happening again
 *
 * A paid signup produced a tenant with a chart of accounts and nothing else: no accounting
 * settings, no ledger, no journals, no document sequences, no periods, and an empty `currency`
 * table its own foreign key pointed at. `POST /invoices` therefore failed for EVERY customer, on
 * the first attempt, with "La configuración de cuentas automáticas para esta organización es
 * incompleta" — and the whole test suite was green, because nothing ever drove an invoice end to
 * end.
 *
 * Issuing also posted nothing: `invoice.created` had no listener anywhere in the repository, so a
 * sale never reached the ledger while collecting a payment credited a receivable that had never
 * been debited.
 *
 * This drives the real services against a real database and then asks the database what happened.
 * It runs in CI.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { InvoicesService } from '../../apps/backend/api/src/app/invoices/invoices.service';
import { ComplianceService } from '../../apps/backend/api/src/app/compliance/compliance.service';
import { CustomersService } from '../../apps/backend/api/src/app/customers/customers.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { NcfType } from '../../apps/backend/api/src/app/compliance/entities/ncf-sequence.entity';
import { InvoiceStatus } from '../../apps/backend/api/src/app/invoices/entities/invoice.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';

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
  const invoices = app.get(InvoicesService);
  const compliance = app.get(ComplianceService, { strict: false });
  const customers = app.get(CustomersService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });

  const stamp = Date.now();
  const region = await localization.findRegionByCountryCode('DO');
  // A plan, because every metered operation refuses an organization without one — correctly: an
  // unplanned tenant is a provisioning fault, not a licence to consume without limit.
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const org = await organizations.create({
    planId: plan?.id,
    subscriptionStatus: 'active',
    subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
    legalName: `Sonda Facturación ${stamp}`,
    taxId: dominicanRnc(String(13100000 + (stamp % 800000))),
    country: 'DO',
    fiscalRegionId: region!.id,
    address: 'Av. Winston Churchill 1099',
    city: 'Santo Domingo Este',
    state: '32',
    phone: '8095550100',
    email: `sonda${stamp}@example.com`,
  });
  await localization.applyFiscalPackage(org, ds.manager);
  const orgId = org.id;

  // ── The tenant is ready the moment it exists ────────────────────────────────
  const readiness = await invoices.invoicingContext(orgId);
  check('un inquilino recién creado está listo para facturar', readiness.ready, readiness.missing.join('; '));

  // ── Fiscal numbering, with its authorization window ─────────────────────────
  await compliance.provisionNcfSequence(orgId, {
    type: NcfType.E31, prefix: 'E31', startsAt: 1, endsAt: 100,
    expiresAt: `${new Date().getFullYear() + 1}-12-31`,
  });
  await compliance.provisionNcfSequence(orgId, {
    type: NcfType.E32, prefix: 'E32', startsAt: 1, endsAt: 100,
    expiresAt: `${new Date().getFullYear() + 1}-12-31`,
  });
  await compliance.provisionNcfSequence(orgId, {
    type: NcfType.E34, prefix: 'E34', startsAt: 1, endsAt: 100,
    expiresAt: `${new Date().getFullYear() + 1}-12-31`,
  });

  let overlapRejected = false;
  try {
    await compliance.provisionNcfSequence(orgId, {
      type: NcfType.E31, prefix: 'E31', startsAt: 50, endsAt: 150,
    });
  } catch {
    overlapRejected = true;
  }
  check('un rango de e-NCF solapado es rechazado', overlapRejected);

  // ── Catalogue ───────────────────────────────────────────────────────────────
  const productRepo = ds.getRepository(Product);
  const good = await productRepo.save(
    productRepo.create({
      name: `Mercancía ${stamp}`, price: 1000, cost: 600, stock: 100, organizationId: orgId,
      kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );
  const service = await productRepo.save(
    productRepo.create({
      name: `Servicio ${stamp}`, price: 500, cost: 0, stock: 0, organizationId: orgId,
      kind: ProductKind.SERVICE, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'HR',
    } as Partial<Product>),
  );

  const customer: { id: string } = await customers.create(
    {
      companyName: 'Cliente Crédito Fiscal', email: `cliente${stamp}@example.com`,
      phone: '8095550101', taxId: dominicanRnc(String(10100000 + (stamp % 700000))),
      address: 'Calle 1', country: 'DO',
    } as never,
    orgId,
  );

  const today = new Date().toISOString().split('T')[0];

  // ── A draft consumes no fiscal numbering ────────────────────────────────────
  const draft = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      issue: false,
      lineItems: [{ productId: good.id, quantity: 2 }],
    } as never,
    orgId,
  );
  check('un borrador no consume numeración fiscal', draft.status === InvoiceStatus.DRAFT && !draft.ncfNumber);
  check('un borrador no se contabiliza', !draft.journalEntryId);

  // ── Issuing ─────────────────────────────────────────────────────────────────
  const issued = await invoices.issue(draft.id, orgId);
  check('al emitir se asigna un e-NCF', Boolean(issued.ncfNumber?.startsWith('E31')), issued.ncfNumber ?? 'sin e-NCF');
  check('el e-NCF lleva su fecha de vencimiento', Boolean(issued.ncfExpiresAt), issued.ncfExpiresAt ?? 'sin vencimiento');
  check('la emisión genera un asiento contable', Boolean(issued.journalEntryId));
  check('la emisión contabiliza el costo de la venta', Boolean(issued.costJournalEntryId));

  // ── Fractional quantities, discounts, services and withholding ──────────────
  const complex = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      documentDiscountRate: 0.05, serviceChargeRate: 0.1, taxWithholdingRate: 0.3,
      lineItems: [
        { productId: good.id, quantity: 1.5, discountRate: 0.1 },
        { productId: service.id, quantity: 2.25 },
        { description: 'Concepto libre sin catálogo', quantity: 1, unitPrice: 250, taxTreatment: TaxTreatment.EXEMPT },
      ],
    } as never,
    orgId,
  );
  check('acepta cantidades fraccionadas', complex.lineItems.some((l) => l.quantity === 1.5));
  check('acepta una línea sin producto de catálogo', complex.lineItems.some((l) => !l.productId));
  check('separa bienes de servicios', complex.goodsTotal > 0 && complex.servicesTotal > 0,
    `bienes ${complex.goodsTotal}, servicios ${complex.servicesTotal}`);
  check('separa gravado de exento', complex.exemptTotal === 250, `exento ${complex.exemptTotal}`);
  check('aplica propina legal', complex.serviceCharge > 0, String(complex.serviceCharge));
  check('descuenta la retención del importe a cobrar', complex.netReceivable < complex.total,
    `total ${complex.total}, neto ${complex.netReceivable}`);

  // The document must add up exactly as printed.
  const expected = round2(complex.subtotal - complex.discountTotal + complex.tax + complex.serviceCharge);
  check('el total cuadra con sus componentes', Math.abs(expected - complex.total) < 0.005,
    `esperado ${expected}, almacenado ${complex.total}`);

  // ── The ledger balances ─────────────────────────────────────────────────────
  const [balance] = await ds.query(
    `SELECT COALESCE(SUM(l."debit"), 0)::numeric AS debit, COALESCE(SUM(l."credit"), 0)::numeric AS credit
     FROM "journal_entry_lines" l
     JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
     WHERE e."organization_id" = $1`,
    [orgId],
  );
  check('el mayor cuadra: débitos = créditos',
    Math.abs(Number(balance.debit) - Number(balance.credit)) < 0.01,
    `débitos ${Number(balance.debit).toFixed(2)}, créditos ${Number(balance.credit).toFixed(2)}`);

  const [receivable] = await ds.query(
    `SELECT COALESCE(SUM(l."debit" - l."credit"), 0)::numeric AS balance
     FROM "journal_entry_lines" l
     JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
     JOIN "organization_settings" s ON s."organization_id" = e."organization_id"
     WHERE e."organization_id" = $1 AND l."account_id" = s."default_accounts_receivable_id"`,
    [orgId],
  );
  check('la cuenta por cobrar queda deudora tras facturar', Number(receivable.balance) > 0,
    `saldo ${Number(receivable.balance).toFixed(2)}`);

  // ── Credit notes accumulate ─────────────────────────────────────────────────
  const firstLine = issued.lineItems[0];
  const partial = await invoices.createCreditNote(
    { invoiceId: issued.id, items: [{ lineId: firstLine.id, quantity: 1 }], reason: 'Devolución parcial' } as never,
    orgId,
  );
  check('la nota de crédito parcial se emite con su propio e-NCF', Boolean(partial.ncfNumber?.startsWith('E34')),
    partial.ncfNumber ?? 'sin e-NCF');

  const afterPartial = await invoices.findOne(issued.id, orgId);
  check('la nota parcial reduce el saldo de la factura', afterPartial.balance < issued.netReceivable,
    `antes ${issued.netReceivable}, después ${afterPartial.balance}`);

  let overCreditRejected = false;
  try {
    await invoices.createCreditNote(
      { invoiceId: issued.id, items: [{ lineId: firstLine.id, quantity: 2 }] } as never,
      orgId,
    );
  } catch {
    overCreditRejected = true;
  }
  check('no se puede acreditar más de lo facturado', overCreditRejected);

  // ── Fiscal type is selectable ───────────────────────────────────────────────
  const consumo = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      fiscalDocumentType: NcfType.E32,
      lineItems: [{ productId: good.id, quantity: 1 }],
    } as never,
    orgId,
  );
  check('el tipo de comprobante es seleccionable', consumo.ncfNumber?.startsWith('E32') === true,
    consumo.ncfNumber ?? 'sin e-NCF');

  // ── Fiscal numbers are unique ───────────────────────────────────────────────
  const [dupes] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "ncf_number" FROM "invoices"
       WHERE "organization_id" = $1 AND "ncf_number" IS NOT NULL
       GROUP BY 1 HAVING COUNT(*) > 1
     ) d`,
    [orgId],
  );
  check('no existen comprobantes con e-NCF duplicado', dupes.n === 0, `${dupes.n} duplicado(s)`);

  console.log(
    failures.length
      ? `\nFAILURES:\n${failures.map((f) => `  - ${f}`).join('\n')}`
      : '\nUN INQUILINO NUEVO EMITE, CONTABILIZA Y ACREDITA CORRECTAMENTE',
  );
  await app.close();
  process.exit(failures.length ? 1 : 0);
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

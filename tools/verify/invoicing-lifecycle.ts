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

// The probe signs with a self-signed certificate it makes on the spot; the API accepts one only in
// a development or test process that opts in (see `CertificateVaultService.testCertificatesAllowed`).
process.env['ECF_ALLOW_TEST_CERTIFICATES'] = 'true';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { InvoicesService } from '../../apps/backend/api/src/app/invoices/invoices.service';
import { ReturnsService } from '../../apps/backend/api/src/app/compliance/returns/returns.service';
import { CustomersService } from '../../apps/backend/api/src/app/customers/customers.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { StockLedgerService } from '../../apps/backend/api/src/app/inventory/stock-ledger.service';
import { InventoryService } from '../../apps/backend/api/src/app/inventory/inventory.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { FiscalRegimeSettingsService } from '../../apps/backend/api/src/app/einvoicing/services/fiscal-regime-settings.service';
import { InvoiceStatus } from '../../apps/backend/api/src/app/invoices/entities/invoice.entity';
import { adjustmentCodeFor } from '../../apps/backend/api/src/app/markets';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { EcfCertificateService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-certificate.service';
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

/** A Colombian NIT with its DIAN check digit (módulo 11 with the DIAN's prime weights). */
function colombianNit(base: string): string {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = base.split('').reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
  const remainder = sum % 11;
  const dv = remainder > 1 ? 11 - remainder : remainder;
  return `${base}-${dv}`;
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
  const returns = app.get(ReturnsService, { strict: false });
  // The ranges of every market, the Dominican NCF among them, through the settings endpoint's service.
  const fiscalRanges = app.get(FiscalRegimeSettingsService, { strict: false });
  const rangeExpiry = `${new Date().getFullYear() + 1}-12-31`;
  const customers = app.get(CustomersService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });
  const ledger = app.get(StockLedgerService, { strict: false });
  const certificates = app.get(EcfCertificateService, { strict: false });
  const inventory = app.get(InventoryService, { strict: false });

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

  // ── The tenant is ready the moment it exists, save its fiscal numbering ─────
  // A market that numbers its documents cannot issue until the tax authority's range is loaded,
  // and readiness says so (`invoices.gaps.fiscal_sequence`) instead of answering `ready` and
  // letting the first POST fail. So a fresh tenant must be missing that and nothing else.
  const readiness = await invoices.invoicingContext(orgId);
  // Only the range: until the company holds one, nothing says whether it will issue traditional
  // NCF (no certificate needed) or e-CF, so asking for a certificate as well would be premature.
  check(
    'un inquilino recién creado solo espera un rango de comprobantes para facturar',
    !readiness.ready &&
      readiness.missing.length === 1 &&
      readiness.missing[0] === 'invoices.gaps.fiscal_sequence',
    readiness.missing.join('; '),
  );
  check('un inquilino nuevo emite ambas series', readiness.emissionMode === 'BOTH');

  // ── Fiscal numbering, with its authorization window ─────────────────────────
  await fiscalRanges.registerRange(orgId, { documentType: 'E31', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  await fiscalRanges.registerRange(orgId, { documentType: 'E32', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  await fiscalRanges.registerRange(orgId, { documentType: 'E34', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });

  let overlapRejected = false;
  try {
    await fiscalRanges.registerRange(orgId, { documentType: 'E31', startsAt: 50, endsAt: 150, validUntil: rangeExpiry });
  } catch {
    overlapRejected = true;
  }
  check('un rango solapado es rechazado, como en cualquier mercado', overlapRejected);

  // An electronic document must also be signed. With ranges but no certificate the tenant is not
  // ready, and says exactly that: issuing would consume an e-NCF the DGII never receives.
  const withRangesNoCertificate = await invoices.invoicingContext(orgId);
  check(
    'con rangos pero sin certificado, el inquilino espera solo su certificado de firma',
    !withRangesNoCertificate.ready &&
      withRangesNoCertificate.missing.length === 1 &&
      withRangesNoCertificate.missing[0] === 'invoices.gaps.signing_certificate',
    withRangesNoCertificate.missing.join('; '),
  );

  // ── Catalogue ───────────────────────────────────────────────────────────────
  const productRepo = ds.getRepository(Product);
  const good = await productRepo.save(
    productRepo.create({
      name: `Mercancía ${stamp}`, price: 1000, cost: 600, stock: 0, organizationId: orgId,
      kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );
  // Stock is held somewhere: an opening movement into the company's default warehouse, through the
  // one writer of the stock register, exactly as a product created with opening stock gets it.
  // Writing `products.stock` directly put 100 units in no warehouse, and the sale found none.
  await ds.transaction(async (manager) =>
    ledger.move(manager, orgId, {
      productId: good.id,
      warehouseId: await ledger.resolveWarehouse(manager, orgId, {}),
      quantity: 100,
      unitCost: 600,
      type: 'OPENING',
      reference: 'Saldo inicial',
      sourceType: 'verify_seed',
      sourceId: null,
    }),
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
      // The document type is chosen, not guessed: without it the country's default (the Cédula)
      // applies, and a nine-digit RNC is not a valid Cédula. The customer form always sends it.
      identityDocumentTypeCode: 'RNC',
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
  check('un borrador no consume numeración fiscal', draft.status === InvoiceStatus.DRAFT && !draft.fiscalNumber);
  check('un borrador no se contabiliza', !draft.journalEntryId);

  // ── Previewing, which must change nothing ───────────────────────────────────
  //
  // The preview runs the REAL transition and rolls it back, so the only way to trust it is to check
  // both halves: that it leaves no trace, and that what it showed is what issuing then does. A
  // preview that is merely plausible is worse than none — it is a confident statement about money.
  // Without a certificate the preview blocks, names the reason and points at the screen that fixes it.
  const blocked = await invoices.previewIssue(draft.id, orgId);
  const certificateCondition = blocked.preconditions.find(
    (p) => p.code === 'einvoicing.certificate.none_active',
  );
  check('sin certificado, la emisión se bloquea', !blocked.canExecute && Boolean(certificateCondition));
  check(
    'el bloqueo lleva a cargar el certificado',
    certificateCondition?.remedy?.route === '/overview#settings/fiscal',
    certificateCondition?.remedy?.route ?? 'sin remedio',
  );
  const afterBlocked = await invoices.findOne(draft.id, orgId);
  check('un intento bloqueado no consume numeración', !afterBlocked.fiscalNumber);

  // ── Traditional NCF (serie B): numbered and printed, no certificate, nothing transmitted ────
  //
  // A company that issues serie B was told it could not invoice until it loaded a signing
  // certificate it does not need. With a live B range it is ready, and an invoice with no type
  // chosen is drawn from it.
  await fiscalRanges.registerRange(orgId, { documentType: 'B01', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  await fiscalRanges.registerRange(orgId, { documentType: 'B02', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  const traditionalReady = await invoices.invoicingContext(orgId);
  check(
    'con un rango B y sin certificado, el inquilino puede facturar',
    traditionalReady.ready && traditionalReady.automaticKind === 'TRADITIONAL',
    `${traditionalReady.missing.join('; ')} · tipo ${traditionalReady.automaticKind}`,
  );
  const e31Option = traditionalReady.fiscalDocumentTypes.find((t) => t.code === 'E31');
  check(
    'el E31 se ofrece, pero bloqueado por el certificado',
    e31Option?.available === true && e31Option.issuable === false && e31Option.blockedBy === 'invoices.type_blocked.no_certificate',
  );
  const traditional = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      lineItems: [{ productId: service.id, quantity: 1 }],
    } as never,
    orgId,
  );
  check('sin elegir tipo, sale un B01 al contribuyente', Boolean(traditional.fiscalNumber?.startsWith('B01')), traditional.fiscalNumber ?? 'sin NCF');
  const [traditionalSubmission] = await ds.query(
    `SELECT count(*)::int AS n FROM fiscal_submissions WHERE invoice_id = $1`, [traditional.id],
  );
  check('un NCF tradicional no se transmite a la DGII', traditionalSubmission.n === 0);
  check('un NCF tradicional se contabiliza igual', Boolean(traditional.journalEntryId));

  // ── A fixed tax is an amount per unit, not a rate (FAC-TX-01) ───────────────
  const [fixedTax] = await ds.query(
    `INSERT INTO taxes (name, rate, type, organization_id) VALUES ('Selectivo específico (sonda)', 50, 'Fijo', $1) RETURNING id`,
    [orgId],
  );
  const [percentTax] = await ds.query(
    `SELECT id FROM taxes WHERE organization_id = $1 AND type = 'Porcentaje' LIMIT 1`, [orgId],
  );
  // A product of its own, so the sales below do not move the stock and cost the later checks read.
  const bottle = await productRepo.save(
    productRepo.create({
      name: `Licor ${stamp}`, price: 1000, cost: 400, stock: 0, organizationId: orgId,
      kind: ProductKind.GOOD, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );
  await ds.transaction(async (manager) =>
    ledger.move(manager, orgId, {
      productId: bottle.id,
      warehouseId: await ledger.resolveWarehouse(manager, orgId, {}),
      quantity: 20,
      unitCost: 400,
      type: 'OPENING',
      reference: 'Saldo inicial',
      sourceType: 'verify_seed',
      sourceId: null,
    }),
  );
  let percentRefused = '';
  try {
    await inventory.update(bottle.id, { exciseTaxId: percentTax.id } as never, orgId);
  } catch (error) {
    percentRefused = (error as { messageKey?: string }).messageKey ?? 'rechazado';
  }
  check('un producto no puede llevar un impuesto porcentual como fijo', percentRefused === 'inventory.excise_tax_must_be_fixed', percentRefused || 'aceptado');
  await inventory.update(bottle.id, { exciseTaxId: fixedTax.id } as never, orgId);
  const withFixed = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      lineItems: [{ productId: bottle.id, quantity: 6 }],
    } as never,
    orgId,
  );
  const fixedLine = withFixed.lineItems[0];
  check('el impuesto fijo se cobra por unidad: 6 × 50', Number(withFixed.excise) === 300 && Number(fixedLine.exciseUnitAmount) === 50, `selectivo ${withFixed.excise}, por unidad ${fixedLine.exciseUnitAmount}`);
  check('y entra en la base del ITBIS: (6.000 + 300) × 18 %', Number(withFixed.tax) === 1134, String(withFixed.tax));
  check('el total suma el selectivo', Number(withFixed.total) === 7434, String(withFixed.total));
  await ds.query(`UPDATE taxes SET effective_to = '2000-12-31' WHERE id = $1`, [fixedTax.id]);
  let staleRefused = '';
  try {
    await invoices.create(
      { customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP', issue: false, lineItems: [{ productId: bottle.id, quantity: 1 }] } as never,
      orgId,
    );
  } catch (error) {
    staleRefused = (error as { messageKey?: string }).messageKey ?? 'rechazado';
  }
  check('un impuesto fijo no vigente no se cobra ni se omite: se rechaza', staleRefused === 'invoices.fixed_tax_not_in_force', staleRefused || 'emitida');
  await inventory.update(bottle.id, { exciseTaxId: null } as never, orgId);

  // A company that issues only electronic comprobantes cannot be handed a B by mistake.
  await ds.query(
    `UPDATE organization_settings SET fiscal_emission_mode = 'ELECTRONIC' WHERE organization_id = $1`, [orgId],
  );
  let traditionalRefused = false;
  try {
    await invoices.create(
      {
        customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
        fiscalDocumentType: 'B02', lineItems: [{ productId: service.id, quantity: 1 }],
      } as never,
      orgId,
    );
  } catch {
    traditionalRefused = true;
  }
  check('en modalidad electrónica, un B02 se rechaza', traditionalRefused);
  await ds.query(
    `UPDATE organization_settings SET fiscal_emission_mode = 'BOTH' WHERE organization_id = $1`, [orgId],
  );

  const certificate = makeTestCertificate('SONDA FACTURACION', 30, org.taxId as string);
  await runAsTenantJob(ds, orgId, () =>
    certificates.upload(orgId, { pfx: certificate.pfx, password: certificate.password, alias: 'Sonda' }),
  );
  const readyWithRanges = await invoices.invoicingContext(orgId);
  check(
    'con rangos y certificado, el inquilino está listo para facturar',
    readyWithRanges.ready,
    readyWithRanges.missing.join('; '),
  );

  const preview = await invoices.previewIssue(draft.id, orgId);
  check('la previsualización dice que se puede emitir', preview.canExecute);

  const previewLedger = preview.effects.find((e) => e.kind === 'ledger');
  check('la previsualización muestra el asiento', Boolean(previewLedger));
  if (previewLedger && previewLedger.kind === 'ledger') {
    check(
      'el asiento previsualizado cuadra',
      Math.abs(previewLedger.totalDebit - previewLedger.totalCredit) < 0.005,
      `debe ${previewLedger.totalDebit} / haber ${previewLedger.totalCredit}`,
    );
  }

  const previewSequence = preview.effects.find((e) => e.kind === 'sequence');
  check('la previsualización dice qué número fiscal consumiría', Boolean(previewSequence));

  const afterPreview = await invoices.findOne(draft.id, orgId);
  check('previsualizar no emite el documento', afterPreview.status === InvoiceStatus.DRAFT);
  check('previsualizar no contabiliza', !afterPreview.journalEntryId && !afterPreview.costJournalEntryId);
  check('previsualizar no consume numeración', !afterPreview.fiscalNumber);

  const entriesBefore = await ds.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE organization_id = $1`, [orgId],
  );

  // ── The cost of a sale is the stock's cost when it leaves, not when it was drafted (INV-01) ──
  //
  // The draft was written while the goods stood at 600. A receipt at 900 before it is issued
  // re-averages the 100 units on hand to 750, and issuing must relieve the 2 units at 750: the
  // cost of sale used to be frozen at the draft's 600 while the stock register let them go at
  // 750, so the inventory account and the stock it describes drifted apart with every such sale.
  await ds.transaction((manager) =>
    inventory.receiveGoods(manager, orgId, {
      reference: 'Recepción de sonda',
      sourceType: 'verify_seed',
      sourceId: null,
      date: today,
      lines: [{ productId: good.id, quantity: 100, unitCost: 900 }],
      post: false,
    } as never, null),
  );

  // ── Issuing ─────────────────────────────────────────────────────────────────
  const issued = await invoices.issue(draft.id, orgId);
  check(
    'el costo de la venta es el del inventario al salir, no el del borrador',
    Math.abs(Number(issued.costOfSale) - 1500) < 0.005,
    `costo ${issued.costOfSale}, esperado 1500`,
  );
  const [costPosted] = await ds.query(
    `SELECT COALESCE(SUM(debit), 0)::float AS debit FROM journal_entry_lines WHERE journal_entry_id = $1`,
    [issued.costJournalEntryId],
  );
  check(
    'el asiento de costo contabiliza lo que salió del kárdex',
    Math.abs(Number(costPosted?.debit) - 1500) < 0.005,
    `contabilizado ${costPosted?.debit}`,
  );
  check('al emitir se asigna un e-NCF', Boolean(issued.fiscalNumber?.startsWith('E31')), issued.fiscalNumber ?? 'sin e-NCF');
  check('el e-NCF lleva su fecha de vencimiento', Boolean(issued.fiscalNumberExpiresAt), issued.fiscalNumberExpiresAt ?? 'sin vencimiento');
  check('la emisión genera un asiento contable', Boolean(issued.journalEntryId));
  check('la emisión contabiliza el costo de la venta', Boolean(issued.costJournalEntryId));

  // The transmission the document owes commits with it: an e-NCF never exists without a record of
  // whether the DGII has it. Whatever the immediate attempt did, the row is there.
  const [submission] = await ds.query(
    `SELECT status, country_code, regime, document_type FROM fiscal_submissions WHERE invoice_id = $1 AND organization_id = $2`,
    [issued.id, orgId],
  );
  check('el e-CF emitido tiene su registro de envío', Boolean(submission?.status), submission?.status ?? 'sin registro');
  // One outbox for every market: the Dominican e-CF is a submission of the DGII regime in it.
  check(
    'el envío queda en el buzón único, como régimen de su mercado',
    submission?.country_code === 'DO' && submission?.regime === 'DGII e-CF' && submission?.document_type === 'E31',
    `${submission?.country_code ?? '—'} / ${submission?.regime ?? '—'} / ${submission?.document_type ?? '—'}`,
  );

  // The claim the preview made, checked against what actually happened.
  if (previewSequence && previewSequence.kind === 'sequence') {
    check(
      'el número que previsualizó es el que se emitió',
      previewSequence.value === issued.fiscalNumber,
      `previsto ${previewSequence.value}, emitido ${issued.fiscalNumber}`,
    );
  }
  if (previewLedger && previewLedger.kind === 'ledger') {
    const posted = await ds.query(
      `SELECT COALESCE(SUM(debit), 0)::float AS debit FROM journal_entry_lines WHERE journal_entry_id = $1`,
      [issued.journalEntryId],
    );
    check(
      'el importe que previsualizó es el que se contabilizó',
      Math.abs(Number(posted[0].debit) - previewLedger.totalDebit) < 0.005,
      `previsto ${previewLedger.totalDebit}, contabilizado ${posted[0].debit}`,
    );
  }
  const entriesAfter = await ds.query(
    `SELECT count(*)::int AS n FROM journal_entries WHERE organization_id = $1`, [orgId],
  );
  check(
    'la previsualización no dejó asientos huérfanos',
    entriesAfter[0].n - entriesBefore[0].n <= 2,
    `antes ${entriesBefore[0].n}, después ${entriesAfter[0].n}`,
  );

  // ── Debit notes and cancellation, as the market allows (FAC-INV-05) ─────────
  await fiscalRanges.registerRange(orgId, { documentType: 'B03', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  await fiscalRanges.registerRange(orgId, { documentType: 'E33', startsAt: 1, endsAt: 100, validUntil: rangeExpiry });
  const interest = { description: 'Intereses por mora', quantity: 1, unitPrice: 500, taxTreatment: TaxTreatment.TAXED, isService: true };
  const traditionalDebit = await invoices.createDebitNote(
    traditional.id,
    { reason: 'LATE_PAYMENT_INTEREST', description: 'Intereses por pago tardío', lines: [interest] } as never,
    orgId,
  );
  check('la nota de débito de un B01 sale como B03, con su motivo canónico', Boolean(traditionalDebit.fiscalNumber?.startsWith('B03')) && traditionalDebit.type === 'DEBIT_NOTE' && traditionalDebit.adjustmentReason === 'LATE_PAYMENT_INTEREST', `${traditionalDebit.fiscalNumber} · ${traditionalDebit.adjustmentReason}`);
  check('y cobra lo que suma: 500 + 18 % = 590, pendiente de cobro', Number(traditionalDebit.total) === 590 && Number(traditionalDebit.balance) === 590 && traditionalDebit.status === 'Pending', `${traditionalDebit.total} / ${traditionalDebit.balance} / ${traditionalDebit.status}`);
  const [debitPosted] = await ds.query(
    `SELECT COALESCE(SUM(debit), 0)::float AS debit FROM journal_entry_lines WHERE journal_entry_id = $1`, [traditionalDebit.journalEntryId],
  );
  check('la nota de débito se contabiliza como una venta', Math.abs(Number(debitPosted?.debit) - 590) < 0.005, `debe ${debitPosted?.debit}`);
  const exemptCharge = await invoices.createDebitNote(
    traditional.id,
    { reason: 'ADDITIONAL_CHARGES', description: 'Gastos de cobranza', lines: [{ ...interest, description: 'Gastos', unitPrice: 100, taxTreatment: TaxTreatment.EXEMPT }] } as never,
    orgId,
  );
  check('el tratamiento fiscal de cada cargo es el que se indica, no uno supuesto', Number(exemptCharge.tax) === 0 && Number(exemptCharge.total) === 100, `ITBIS ${exemptCharge.tax}`);
  const electronicDebit = await invoices.createDebitNote(
    issued.id,
    { reason: 'ADDITIONAL_CHARGES', description: 'Flete facturado después', lines: [{ ...interest, description: 'Flete', unitPrice: 200 }] } as never,
    orgId,
  );
  const [electronicDebitSubmission] = await ds.query(`SELECT status FROM fiscal_submissions WHERE invoice_id = $1`, [electronicDebit.id]);
  check('la de un E31 sale como E33 y queda por transmitir', Boolean(electronicDebit.fiscalNumber?.startsWith('E33')) && Boolean(electronicDebitSubmission), `${electronicDebit.fiscalNumber} · ${electronicDebitSubmission?.status ?? 'sin envío'}`);

  const refusalOf = async (run: () => Promise<unknown>) => run().then(() => 'aceptado', (error) => (error as { messageKey?: string }).messageKey ?? String(error));
  const electronicOptions = await invoices.cancellationOptions(issued.id, orgId);
  check('un e-CF no se anula: la ruta es la nota de crédito', electronicOptions.route === 'CREDIT_NOTE_ONLY' && !electronicOptions.cancellable, `${electronicOptions.route} · ${electronicOptions.blockedBy}`);
  check('y si se intenta, se rechaza diciendo por qué', (await refusalOf(() => invoices.cancel(issued.id, { reason: 'Error' } as never, orgId))) === 'invoices.cancellation_credit_note_only');
  check('una factura con nota de débito no se anula', (await refusalOf(() => invoices.cancel(traditional.id, { reason: 'Error', reasonCode: '04' } as never, orgId))) === 'invoices.cancellation_only_untouched');

  const stockBeforeSale = Number((await ds.query(`SELECT stock FROM products WHERE id = $1`, [bottle.id]))[0].stock);
  const toCancel = await invoices.create(
    { customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP', fiscalDocumentType: 'B01', lineItems: [{ productId: bottle.id, quantity: 2 }] } as never,
    orgId,
  );
  const traditionalOptions = await invoices.cancellationOptions(toCancel.id, orgId);
  check('un B01 se anula y se reporta, con los motivos de la DGII', traditionalOptions.route === 'REPORT' && traditionalOptions.cancellable && traditionalOptions.reasons.length === 10, `${traditionalOptions.route} · ${traditionalOptions.reasons.length} motivos`);
  check('sin motivo del catálogo, la anulación se rechaza', (await refusalOf(() => invoices.cancel(toCancel.id, { reason: 'Error en la información' } as never, orgId))) === 'invoices.cancellation_reason_code_required');
  check('un motivo fuera del catálogo, también', (await refusalOf(() => invoices.cancel(toCancel.id, { reason: 'Error', reasonCode: '99' } as never, orgId))) === 'invoices.cancellation_reason_code_not_in_catalogue');
  const cancelled = await invoices.cancel(toCancel.id, { reason: 'Error en la información del cliente', reasonCode: '04' } as never, orgId);
  const stockAfterCancel = Number((await ds.query(`SELECT stock FROM products WHERE id = $1`, [bottle.id]))[0].stock);
  check('la anulación deja la factura anulada y reportada, con su código', cancelled.status === 'Void' && cancelled.cancellationMode === 'REPORTED' && cancelled.cancellationReasonCode === '04', `${cancelled.status} · ${cancelled.cancellationMode} · ${cancelled.cancellationReasonCode}`);
  check('y devuelve la mercancía al almacén', stockAfterCancel === stockBeforeSale, `antes ${stockBeforeSale}, después ${stockAfterCancel}`);
  const [reversal] = await ds.query(
    `SELECT
       (SELECT COALESCE(SUM(debit - credit), 0)::float FROM journal_entry_lines WHERE journal_entry_id = ANY($1::uuid[]) AND account_id = (SELECT default_accounts_receivable_id FROM organization_settings WHERE organization_id = $3)) AS receivable,
       (SELECT count(*)::int FROM journal_entries WHERE id = ANY($2::uuid[])) AS entries`,
    [[toCancel.journalEntryId, cancelled.cancellationJournalEntryId], [cancelled.cancellationJournalEntryId, cancelled.cancellationCostJournalEntryId], orgId],
  );
  check('los asientos de anulación revierten la cuenta por cobrar y el costo', Math.abs(Number(reversal.receivable)) < 0.005 && reversal.entries === 2, `CxC neta ${reversal.receivable} · ${reversal.entries} asientos`);
  const report608 = (
    await returns.generate(orgId, '608', { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) })
  ).body;
  check('el 608 la declara con el código elegido', report608.split('\n').some((row) => row.startsWith(`${cancelled.fiscalNumber}|`) && row.endsWith('|04')), report608.split('\n').find((row) => row.startsWith(cancelled.fiscalNumber ?? '-')) ?? 'no está');

  // ── A withholding rate the buyer's regime does not justify is refused ───────
  //
  // `WithholdingResolverService` derives the rate from the buyer's fiscal classification and
  // refuses a stated rate that disagrees with it unless the operator says why. This customer is an
  // ordinary company, which withholds nothing, so 30 % is a claim about the transaction that has
  // to be justified — and an unjustified one used to be accepted and posted.
  let unjustifiedRefused = false;
  let unjustifiedDetail = '';
  try {
    await invoices.create(
      {
        customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
        taxWithholdingRate: 0.3,
        lineItems: [{ productId: good.id, quantity: 1 }],
      } as never,
      orgId,
    );
  } catch (e) {
    const key = (e as { messageKey?: string }).messageKey ?? (e as Error).message;
    unjustifiedRefused = key === 'invoices.withholding_stated_stated_not_what_applicable';
    unjustifiedDetail = key;
  }
  check(
    'una retención que el régimen del comprador no justifica se rechaza',
    unjustifiedRefused,
    unjustifiedRefused ? '' : unjustifiedDetail || 'fue aceptada',
  );

  // ── Fractional quantities, discounts, services and withholding ──────────────
  const complex = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      documentDiscountRate: 0.05, serviceChargeRate: 0.1, taxWithholdingRate: 0.3,
      // The same 30 %, this time with the reason the resolver demands — the override path, which
      // is what an operator uses when the buyer withholds under an arrangement the catalogue does
      // not model. The reason is stored on the invoice and shows up in the audit trail.
      withholdingOverrideReason: 'Comprador designado agente de retención por la DGII',
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
  // 250 de base exenta, menos su parte del 5 % de descuento global = 237.50.
  //
  // Un descuento de documento se prorratea entre TODAS las líneas, incluidas las exentas: el
  // comprador paga un 5 % menos también por lo exento, así que su base baja igual. La comprobación
  // esperaba 250, es decir, que el descuento no tocara la línea exenta — y el motor, que sí la
  // toca, tenía razón. Se expresa la regla en lugar de la cifra.
  const exentoEsperado = round2(250 * (1 - 0.05));
  check(
    'separa gravado de exento, con el descuento global prorrateado',
    Math.abs(complex.exemptTotal - exentoEsperado) < 0.005,
    `exento ${complex.exemptTotal}, esperado ${exentoEsperado}`,
  );
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
    {
      invoiceId: issued.id,
      items: [{ lineId: firstLine.id, quantity: 1 }],
      reason: 'Devolución parcial',
      adjustmentReason: 'GOODS_RETURN',
    } as never,
    orgId,
  );
  check('la nota de crédito parcial se emite con su propio e-NCF', Boolean(partial.fiscalNumber?.startsWith('E34')),
    partial.fiscalNumber ?? 'sin e-NCF');
  // El motivo se guarda en los términos del producto; el código de la autoridad lo escribe el mercado.
  check('la nota de crédito guarda el motivo canónico que se le indicó',
    partial.adjustmentReason === 'GOODS_RETURN' && adjustmentCodeFor('DO', partial.adjustmentReason, 'CREDIT_NOTE') === '3',
    `${partial.adjustmentReason} → ${adjustmentCodeFor('DO', partial.adjustmentReason, 'CREDIT_NOTE')}`);

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

  // Sin indicar motivo, acreditar el resto anula la operación, y eso es lo que se guarda: la DGII
  // lo lee como su código 1. Antes el producto guardaba ese 1 en la factura de cualquier mercado.
  const annulling = await invoices.createCreditNote({ invoiceId: issued.id, reason: 'Operación anulada' } as never, orgId);
  check('acreditar el total anula la operación y lo dice en términos del producto',
    annulling.adjustmentReason === 'ANNULMENT' && adjustmentCodeFor('DO', annulling.adjustmentReason, 'CREDIT_NOTE') === '1',
    `${annulling.adjustmentReason} → ${adjustmentCodeFor('DO', annulling.adjustmentReason, 'CREDIT_NOTE')}`);
  const annulled = await invoices.findOne(issued.id, orgId);
  check('y la factura queda anulada por la nota de crédito',
    annulled.status === 'Void' && annulled.cancellationMode === 'CREDIT_NOTE',
    `${annulled.status} · ${annulled.cancellationMode}`);

  // ── Fiscal type is selectable ───────────────────────────────────────────────
  const consumo = await invoices.create(
    {
      customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP',
      fiscalDocumentType: 'E32',
      lineItems: [{ productId: good.id, quantity: 1 }],
    } as never,
    orgId,
  );
  check('el tipo de comprobante es seleccionable', consumo.fiscalNumber?.startsWith('E32') === true,
    consumo.fiscalNumber ?? 'sin e-NCF');

  // ── Fiscal numbers are unique ───────────────────────────────────────────────
  const [dupes] = await ds.query(
    `SELECT COUNT(*)::int AS n FROM (
       SELECT "fiscal_number" FROM "invoices"
       WHERE "organization_id" = $1 AND "fiscal_number" IS NOT NULL
       GROUP BY 1 HAVING COUNT(*) > 1
     ) d`,
    [orgId],
  );
  check('no existen comprobantes con e-NCF duplicado', dupes.n === 0, `${dupes.n} duplicado(s)`);

  // ── Another market: the same rules, its own regime ─────────────────────────────
  // Nothing above is Dominican by construction: a Colombian company uploads its certificate to the
  // DIAN regime, is told it needs one before an electronic document, and has no emission mode to
  // pick because every Colombian type is electronic.
  const coRegion = await localization.findRegionByCountryCode('CO');
  if (coRegion) {
    const nitBase = String(900000000 + (stamp % 99_000_000));
    const coOrg = await organizations.create({
      planId: plan?.id,
      subscriptionStatus: 'active',
      subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
      legalName: `Sonda Facturación Colombia ${stamp}`,
      taxId: colombianNit(nitBase),
      country: 'CO',
      fiscalRegionId: coRegion.id,
      address: 'Carrera 7 # 71-21',
      city: 'Bogotá',
      phone: '6015550100',
      email: `sonda-co${stamp}@example.com`,
    });
    await localization.applyFiscalPackage(coOrg, ds.manager);
    const coContext = await invoices.invoicingContext(coOrg.id);
    check('en Colombia, los comprobantes electrónicos piden certificado', coContext.certificateRequired === true);
    check('en Colombia no hay modalidad que elegir: todo es electrónico', coContext.emissionModeApplies === false);
    check(
      'en Colombia, cada tipo ofrecido se marca como electrónico desde el catálogo',
      coContext.fiscalDocumentTypes.length > 0 && coContext.fiscalDocumentTypes.every((t) => t.electronic === true),
      coContext.fiscalDocumentTypes.map((t) => `${t.code}:${t.electronic}`).join(', '),
    );

    let dominicanRefused = false;
    try {
      await runAsTenantJob(ds, coOrg.id, () =>
        certificates.upload(coOrg.id, { pfx: certificate.pfx, password: certificate.password, alias: 'RD' }),
      );
    } catch {
      dominicanRefused = true;
    }
    check('un certificado de una empresa dominicana se rechaza para la colombiana', dominicanRefused);

    const coCertificate = makeTestCertificate('SONDA COLOMBIA', 30, nitBase);
    const stored = await runAsTenantJob(ds, coOrg.id, () =>
      certificates.upload(coOrg.id, { pfx: coCertificate.pfx, password: coCertificate.password, alias: 'Sonda CO' }),
    );
    check('el certificado colombiano se guarda para el régimen de la DIAN', stored.regime === 'DIAN', stored.regime);
    check('y queda ligado al NIT de la empresa', stored.holderKind === 'company', `${stored.holderTaxId}`);
  } else {
    check('la región fiscal de Colombia existe', false);
  }

  // ── A market whose authority never sees the document: a commercial void (FAC-INV-05) ──
  const usRegion = await localization.findRegionByCountryCode('US');
  if (usRegion) {
    const usOrg = await organizations.create({
      planId: plan?.id,
      subscriptionStatus: 'active',
      subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
      legalName: `Probe Invoicing US ${stamp}`,
      // An EIN carries no check digit: an IRS-assigned prefix (12) and seven digits unique to the run,
      // so the probe can run again without colliding with the last one.
      taxId: `12-${String(stamp % 10_000_000).padStart(7, '0')}`,
      country: 'US',
      fiscalRegionId: usRegion.id,
      address: '100 Main St',
      city: 'Austin',
      phone: '5125550100',
      email: `probe-us${stamp}@example.com`,
    });
    await localization.applyFiscalPackage(usOrg, ds.manager);
    const usCustomer: { id: string } = await customers.create(
      { companyName: 'Probe Customer LLC', email: `customer-us${stamp}@example.com`, phone: '5125550101', address: '1 Elm St', country: 'US' } as never,
      usOrg.id,
    );
    const usToday = new Date().toISOString().slice(0, 10);
    const usInvoice = await invoices.create(
      { customerId: usCustomer.id, issueDate: usToday, dueDate: usToday, currencyCode: 'USD', lineItems: [{ description: 'Consulting', quantity: 2, unitPrice: 150, isService: true }] } as never,
      usOrg.id,
    );
    check('en EE. UU. la factura se numera en el idioma de sus libros', usInvoice.invoiceNumber.startsWith('INV-') && !usInvoice.fiscalNumber, `${usInvoice.invoiceNumber} · ${usInvoice.fiscalNumber ?? 'sin número fiscal'}`);
    const usOptions = await invoices.cancellationOptions(usInvoice.id, usOrg.id);
    check('y se anula como documento comercial, sin catálogo de motivos', usOptions.route === 'VOID' && usOptions.cancellable && usOptions.reasons.length === 0, `${usOptions.route} · ${usOptions.reasons.length}`);
    const usRefusal = await invoices.cancel(usInvoice.id, { reason: 'Billed twice', reasonCode: '04' } as never, usOrg.id).then(() => 'aceptado', (error) => (error as { messageKey?: string }).messageKey ?? String(error));
    check('un código de motivo de otro país no cabe ahí', usRefusal === 'invoices.cancellation_reason_code_not_applicable', usRefusal);
    const usVoided = await invoices.cancel(usInvoice.id, { reason: 'Billed twice' } as never, usOrg.id);
    check('la anulación comercial revierte la factura', usVoided.status === 'Void' && usVoided.cancellationMode === 'VOID' && Boolean(usVoided.cancellationJournalEntryId), `${usVoided.status} · ${usVoided.cancellationMode}`);
    const usDebit = await invoices.createDebitNote(
      (await invoices.create({ customerId: usCustomer.id, issueDate: usToday, dueDate: usToday, currencyCode: 'USD', lineItems: [{ description: 'Consulting', quantity: 1, unitPrice: 150, isService: true }] } as never, usOrg.id)).id,
      { reason: 'LATE_PAYMENT_INTEREST', description: 'Late fee', lines: [{ description: 'Late fee', quantity: 1, unitPrice: 25, taxTreatment: TaxTreatment.EXEMPT, isService: true }] } as never,
      usOrg.id,
    );
    check('y una nota de débito es un documento comercial con su serie', usDebit.invoiceNumber.startsWith('DN-') && !usDebit.fiscalNumber && Number(usDebit.total) === 25, `${usDebit.invoiceNumber} · ${usDebit.total}`);
  } else {
    check('la región fiscal de EE. UU. existe', false);
  }

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

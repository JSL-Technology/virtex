/**
 * Executable proof that the platform documents what it charges.
 *
 * A subscription charge collected through the local acquirer is a sale of the platform company to
 * the customer company, and in the Dominican Republic it needs its comprobante. This sets up a
 * platform tenant (RNC, certificate, e-NCF ranges, a service product) and a customer company, puts
 * an approved charge in `billing_payment_intents`, and runs the job that hands charges to Sales:
 *
 *  - the charge becomes an E31 of the platform to the customer's RNC, for the amount charged;
 *  - the charge records the invoice, and a second run invoices nothing again;
 *  - unconfigured (no platform tenant), the charge is left for the next run rather than lost.
 */
import 'reflect-metadata';

process.env['ECF_ALLOW_TEST_CERTIFICATES'] = 'true';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { ComplianceService } from '../../apps/backend/api/src/app/compliance/compliance.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { NcfType } from '../../apps/backend/api/src/app/compliance/entities/ncf-sequence.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { EcfCertificateService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-certificate.service';
import { AzulRenewalService } from '../../apps/backend/api/src/app/payment/azul/azul-renewal.service';
import { BillingPaymentIntent, BillingIntentStatus } from '../../apps/backend/api/src/app/payment/entities/billing-payment-intent.entity';
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

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
  await app.init();
  const ds = app.get(DataSource);
  const config = app.get(ConfigService);
  const compliance = app.get(ComplianceService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });
  const certificates = app.get(EcfCertificateService, { strict: false });
  const renewals = app.get(AzulRenewalService, { strict: false });

  const stamp = Date.now();
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id, slug FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const makeOrg = async (name: string, seed: number) => {
    const org = await organizations.create({
      planId: plan?.id, subscriptionStatus: 'active', subscriptionPeriodEnd: new Date(Date.now() + 30 * 864e5),
      legalName: `${name} ${stamp}`, taxId: dominicanRnc(String(seed + (stamp % 400000))), country: 'DO',
      fiscalRegionId: region!.id, address: 'Av. Lope de Vega 1', city: 'Santo Domingo', state: '01',
      phone: '8095550133', email: `${name.toLowerCase().replace(/\W/g, '')}${stamp}@example.com`,
    });
    await localization.applyFiscalPackage(org, ds.manager);
    return org;
  };
  const platform = await makeOrg('Virteex Plataforma', 13500000);
  const customer = await makeOrg('Cliente SaaS', 13600000);

  const expiresAt = `${new Date().getFullYear() + 1}-12-31`;
  for (const type of [NcfType.E31, NcfType.E32]) {
    await compliance.provisionNcfSequence(platform.id, { type, prefix: type, startsAt: 1, endsAt: 100, expiresAt });
  }
  const cert = makeTestCertificate('VIRTEEX', 30, platform.taxId as string);
  await runAsTenantJob(ds, platform.id, () => certificates.upload(platform.id, { pfx: cert.pfx, password: cert.password, alias: 'Plataforma' }));
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      name: 'Suscripción Virteex', price: 1, cost: 0, stock: 0, organizationId: platform.id,
      kind: ProductKind.SERVICE, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );

  const intents = ds.getRepository(BillingPaymentIntent);
  const charge = await intents.save(intents.create({
    provider: 'azul', kind: 'organization', orderNumber: `VXT${stamp.toString(36)}`.slice(0, 15).toUpperCase(),
    organizationId: customer.id, planSlug: plan?.slug ?? 'pro', billingPeriod: 'monthly', currency: 'DOP',
    amountMinor: 177000, taxMinor: 27000, status: BillingIntentStatus.APPROVED, periodEnd: new Date(Date.now() + 30 * 864e5),
  }));

  // Unconfigured: nothing is invoiced and the charge waits.
  const internal = (config as unknown as { internalConfig: Record<string, unknown> }).internalConfig;
  const set = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
    if (internal) { if (value === undefined) delete internal[key]; else internal[key] = value; }
  };
  set('PLATFORM_BILLING_ORGANIZATION_ID', undefined);
  set('PLATFORM_BILLING_PRODUCT_ID', undefined);
  await renewals.invoicePending();
  const waiting = await intents.findOne({ where: { id: charge.id } });
  check('sin empresa plataforma configurada, el cobro espera (no se pierde)', waiting?.invoicedAt === null);

  set('PLATFORM_BILLING_ORGANIZATION_ID', platform.id);
  set('PLATFORM_BILLING_PRODUCT_ID', product.id);
  await renewals.invoicePending();
  const done = await intents.findOne({ where: { id: charge.id } });
  check('el cobro queda facturado', Boolean(done?.invoicedAt && done.platformInvoiceId));
  const [invoice] = await ds.query(
    `SELECT i."fiscal_number" AS ncf, i."total"::numeric AS total, i."tax"::numeric AS tax, c."taxId" AS rnc
       FROM invoices i JOIN customers c ON c.id = i."customer_id" WHERE i.id = $1`,
    [done?.platformInvoiceId],
  );
  check('la plataforma emite un E31 al RNC del cliente', Boolean(invoice?.ncf?.startsWith('E31')) && invoice?.rnc === customer.taxId, `${invoice?.ncf} → ${invoice?.rnc}`);
  check('por el monto cobrado, con su ITBIS', Number(invoice?.total) === 1770 && Number(invoice?.tax) === 270, `${invoice?.total} / ${invoice?.tax}`);

  await renewals.invoicePending();
  const [count] = await ds.query(`SELECT count(*)::int AS n FROM invoices WHERE organization_id = $1 AND notes LIKE $2`, [platform.id, `SaaS ${charge.id}%`]);
  check('una segunda pasada no factura dos veces', count?.n === 1, `${count?.n} facturas`);

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nLa plataforma documenta lo que cobra.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Executable proof that a tenant can RECEIVE e-CF the way the DGII specifies.
 *
 * Every electronic issuer must also be a receiver: its suppliers authenticate with a signed seed,
 * send their e-CF to its reception service and get a signed acknowledgement (ARECF) back; its own
 * customers send their commercial approval (ACECF) of what it issued. Being registered as a
 * receiver is part of the DGII certification. The product exposed none of these services.
 *
 * Two Dominican companies, A and B, both with certificates. A issues a crédito fiscal (E31) to B,
 * and the script drives B's public services over HTTP exactly as A's system would:
 *
 *  - seed → signed seed → bearer token, and a request without the token is refused;
 *  - the e-CF is received, stored in B's inbox, and answered with a SIGNED ARECF «recibido»;
 *  - the same e-CF again is «no recibido — envío duplicado» (3);
 *  - a tampered e-CF is «no recibido — error de firma» (2);
 *  - an e-CF addressed to somebody else is «no recibido — RNC comprador no corresponde» (4);
 *  - B's ACECF sent to A's service marks A's document as approved by its buyer;
 *  - B's inbox is B's alone: A cannot see what B received.
 */
import 'reflect-metadata';

process.env['ECF_ALLOW_TEST_CERTIFICATES'] = 'true';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { DataSource } from 'typeorm';
import { SignedXml } from 'xml-crypto';
import { DOMParser } from '@xmldom/xmldom';

import { AppModule } from '../../apps/backend/api/src/app/app.module';
import { InvoicesService } from '../../apps/backend/api/src/app/invoices/invoices.service';
import { ComplianceService } from '../../apps/backend/api/src/app/compliance/compliance.service';
import { CustomersService } from '../../apps/backend/api/src/app/customers/customers.service';
import { LocalizationService } from '../../apps/backend/api/src/app/localization/services/localization.service';
import { OrganizationsService } from '../../apps/backend/api/src/app/organizations/organizations.service';
import { Product, ProductKind } from '../../apps/backend/api/src/app/inventory/entities/product.entity';
import { NcfType } from '../../apps/backend/api/src/app/compliance/entities/ncf-sequence.entity';
import { TaxTreatment } from '../../apps/backend/api/src/app/invoices/entities/invoice-line-item.entity';
import { EcfCertificateService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-certificate.service';
import { EcfSubmissionService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-submission.service';
import { EcfSignerService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-signer.service';
import { EcfReceptorService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-receptor.service';
import { CertificateVaultService } from '../../apps/backend/api/src/app/einvoicing/services/certificate-vault.service';
import { EcfCertificate } from '../../apps/backend/api/src/app/einvoicing/entities/ecf-certificate.entity';
import { EcfLifecycleXmlBuilder } from '../../apps/backend/api/src/app/einvoicing/services/ecf-lifecycle-xml.builder';
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

function tag(xml: string, name: string): string | null {
  const node = new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName(name)[0];
  return node?.textContent ?? null;
}

function signatureVerifies(xml: string): boolean {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const signature = doc.getElementsByTagNameNS('http://www.w3.org/2000/09/xmldsig#', 'Signature')[0];
  if (!signature) return false;
  const verifier = new SignedXml({ getCertFromKeyInfo: SignedXml.getCertFromKeyInfo });
  verifier.loadSignature(signature as unknown as Node);
  return verifier.checkSignature(xml);
}

async function main(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), { logger: ['error'] });
  app
    .getHttpAdapter()
    .getInstance()
    .addContentTypeParser(['application/xml', 'text/xml'], { parseAs: 'string' }, (_req, body, done) => done(null, body));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const http = app.getHttpAdapter().getInstance();

  const ds = app.get(DataSource);
  const invoices = app.get(InvoicesService);
  const compliance = app.get(ComplianceService, { strict: false });
  const customers = app.get(CustomersService, { strict: false });
  const localization = app.get(LocalizationService, { strict: false });
  const organizations = app.get(OrganizationsService, { strict: false });
  const certificates = app.get(EcfCertificateService, { strict: false });
  const submissions = app.get(EcfSubmissionService, { strict: false });
  const signer = app.get(EcfSignerService, { strict: false });
  const vault = app.get(CertificateVaultService, { strict: false });
  const receptor = app.get(EcfReceptorService, { strict: false });
  const lifecycleXml = app.get(EcfLifecycleXmlBuilder, { strict: false });

  const stamp = Date.now();
  const region = await localization.findRegionByCountryCode('DO');
  const [plan] = await ds.query(`SELECT id FROM "saas_plans" ORDER BY "monthly_price" DESC NULLS LAST LIMIT 1`);
  const makeOrg = async (name: string, rncSeed: number) => {
    const org = await organizations.create({
      planId: plan?.id,
      subscriptionStatus: 'active',
      subscriptionPeriodEnd: new Date(Date.now() + 30 * 24 * 3600_000),
      legalName: `${name} ${stamp}`,
      taxId: dominicanRnc(String(rncSeed + (stamp % 500000))),
      country: 'DO',
      fiscalRegionId: region!.id,
      address: 'Av. 27 de Febrero 1',
      city: 'Santo Domingo',
      state: '01',
      phone: '8095550111',
      email: `${name.toLowerCase().replace(/\W/g, '')}${stamp}@example.com`,
    });
    await localization.applyFiscalPackage(org, ds.manager);
    const cert = makeTestCertificate(name.toUpperCase(), 30, org.taxId as string);
    await runAsTenantJob(ds, org.id, () =>
      certificates.upload(org.id, { pfx: cert.pfx, password: cert.password, alias: name }),
    );
    return org;
  };
  const supplier = await makeOrg('Proveedor A', 13300000);
  const buyer = await makeOrg('Comprador B', 13400000);
  const loaded = async (orgId: string) => {
    const row = await runAsTenantJob(ds, orgId, () =>
      ds.getRepository(EcfCertificate).findOne({ where: { organizationId: orgId, isActive: true } }),
    );
    return vault.load(row!);
  };

  // ── A issues an E31 to B ───────────────────────────────────────────────────
  const expiresAt = `${new Date().getFullYear() + 1}-12-31`;
  await compliance.provisionNcfSequence(supplier.id, { type: NcfType.E31, prefix: 'E31', startsAt: 1, endsAt: 100, expiresAt });
  const product = await ds.getRepository(Product).save(
    ds.getRepository(Product).create({
      name: `Servicio ${stamp}`, price: 1000, cost: 0, stock: 0, organizationId: supplier.id,
      kind: ProductKind.SERVICE, taxTreatment: TaxTreatment.TAXED, taxRate: 0.18, unitOfMeasure: 'UND',
    } as Partial<Product>),
  );
  const customer: { id: string } = await customers.create(
    {
      companyName: buyer.legalName, email: `b${stamp}@example.com`, phone: '8095550112',
      taxId: buyer.taxId, identityDocumentTypeCode: 'RNC', address: 'Calle 2', country: 'DO',
    } as never,
    supplier.id,
  );
  const today = new Date().toISOString().split('T')[0];
  const invoice = await invoices.create(
    { customerId: customer.id, issueDate: today, dueDate: today, currencyCode: 'DOP', lineItems: [{ productId: product.id, quantity: 1 }] } as never,
    supplier.id,
  );
  const submission = await runAsTenantJob(ds, supplier.id, () => submissions.submitInvoice(invoice.id, supplier.id));
  check('A firma su E31 a B', Boolean(submission.signedXml) && invoice.fiscalNumber?.startsWith('E31') === true, invoice.fiscalNumber ?? '');
  const ecfXml = submission.signedXml as string;

  // ── Authentication against B's receptor ────────────────────────────────────
  const base = `/dgii/${buyer.taxId}/fe`;
  const seed = await http.inject({ method: 'GET', url: `${base}/autenticacion/api/semilla` });
  check('B entrega una semilla XML', seed.statusCode === 200 && /<SemillaModel/.test(seed.body), String(seed.statusCode));
  const signedSeed = signer.sign(seed.body, await loaded(supplier.id), 'SemillaModel');
  const validated = await http.inject({
    method: 'POST', url: `${base}/autenticacion/api/validacioncertificado`,
    headers: { 'content-type': 'application/xml' }, payload: signedSeed,
  });
  const token = validated.statusCode === 200 ? (JSON.parse(validated.body) as { token: string }).token : '';
  check('la semilla firmada da un token', Boolean(token), String(validated.statusCode));

  const unsignedSeed = await http.inject({
    method: 'POST', url: `${base}/autenticacion/api/validacioncertificado`,
    headers: { 'content-type': 'application/xml' }, payload: seed.body,
  });
  check('una semilla sin firmar no da token', unsignedSeed.statusCode === 401, String(unsignedSeed.statusCode));

  const noToken = await http.inject({
    method: 'POST', url: `${base}/recepcion/api/ecf`, headers: { 'content-type': 'application/xml' }, payload: ecfXml,
  });
  check('la recepción sin token se rechaza', noToken.statusCode === 401, String(noToken.statusCode));

  const send = (xml: string, to = base) =>
    http.inject({
      method: 'POST', url: `${to}/recepcion/api/ecf`,
      headers: { 'content-type': 'application/xml', authorization: `Bearer ${token}` }, payload: xml,
    });

  // ── Reception ──────────────────────────────────────────────────────────────
  const first = await send(ecfXml);
  check('B recibe el e-CF y responde con un ARECF', first.statusCode === 200 && /<ARECF/.test(first.body), String(first.statusCode));
  check('el ARECF dice «recibido» (Estado 0)', tag(first.body, 'Estado') === '0', tag(first.body, 'Estado') ?? '');
  check('el ARECF va firmado y la firma verifica', signatureVerifies(first.body));
  check('el ARECF cita el e-NCF recibido', tag(first.body, 'eNCF') === invoice.fiscalNumber);

  const inbox = await runAsTenantJob(ds, buyer.id, () => receptor.listReceived(buyer.id));
  check('el comprobante aparece en la bandeja de B', inbox.some((d) => d.ncf === invoice.fiscalNumber && d.signatureValid));
  const stored = inbox.find((d) => d.ncf === invoice.fiscalNumber);
  check('se guarda su total e ITBIS', Number(stored?.total) === 1180 && Number(stored?.itbis) === 180, `${stored?.total} / ${stored?.itbis}`);

  const duplicate = await send(ecfXml);
  check('el mismo e-CF otra vez es «envío duplicado» (3)', tag(duplicate.body, 'Estado') === '1' && tag(duplicate.body, 'CodigoMotivoNoRecibido') === '3');

  const tampered = await send(ecfXml.replace(/<MontoTotal>[^<]+<\/MontoTotal>/, '<MontoTotal>1.00</MontoTotal>'));
  check('un e-CF alterado es «error de firma» (2)', tag(tampered.body, 'CodigoMotivoNoRecibido') === '2', tag(tampered.body, 'CodigoMotivoNoRecibido') ?? tampered.body.slice(0, 80));

  // To A's own receptor, which is not the buyer named on it — with a token A's receptor issued.
  const seedA = await http.inject({ method: 'GET', url: `/dgii/${supplier.taxId}/fe/autenticacion/api/semilla` });
  const tokenA = JSON.parse(
    (await http.inject({
      method: 'POST', url: `/dgii/${supplier.taxId}/fe/autenticacion/api/validacioncertificado`,
      headers: { 'content-type': 'application/xml' }, payload: signer.sign(seedA.body, await loaded(buyer.id), 'SemillaModel'),
    })).body,
  ).token as string;
  const wrongBuyer = await http.inject({
    method: 'POST', url: `/dgii/${supplier.taxId}/fe/recepcion/api/ecf`,
    headers: { 'content-type': 'application/xml', authorization: `Bearer ${tokenA}` }, payload: ecfXml,
  });
  check('un e-CF dirigido a otro es «RNC comprador no corresponde» (4)', tag(wrongBuyer.body, 'CodigoMotivoNoRecibido') === '4');

  const tokenForOther = await http.inject({
    method: 'POST', url: `/dgii/${supplier.taxId}/fe/recepcion/api/ecf`,
    headers: { 'content-type': 'application/xml', authorization: `Bearer ${token}` }, payload: ecfXml,
  });
  check('el token de un receptor no sirve en otro', tokenForOther.statusCode === 401, String(tokenForOther.statusCode));

  const aInbox = await runAsTenantJob(ds, supplier.id, () => receptor.listReceived(supplier.id));
  check('la bandeja de B no es visible para A', !aInbox.some((d) => d.ncf === invoice.fiscalNumber));

  // ── B's commercial approval reaches A ──────────────────────────────────────
  const acecf = signer.sign(
    lifecycleXml.buildCommercialApproval({
      rncEmisor: supplier.taxId as string,
      rncComprador: buyer.taxId as string,
      eNCF: invoice.fiscalNumber as string,
      fechaEmision: today.split('-').reverse().join('-'),
      montoTotal: 1180,
      estado: '1',
      fechaHoraAprobacion: '01-01-2026 10:00:00',
    }),
    await loaded(buyer.id),
    'ACECF',
  );
  const approval = await http.inject({
    method: 'POST', url: `/dgii/${supplier.taxId}/fe/aprobacioncomercial/api/ecf`,
    headers: { 'content-type': 'application/xml', authorization: `Bearer ${tokenA}` }, payload: acecf,
  });
  check('A recibe la aprobación comercial de B', approval.statusCode === 200, `${approval.statusCode} ${approval.body.slice(0, 120)}`);
  const [answered] = await ds.query(
    `SELECT commercial_status FROM ecf_submissions WHERE organization_id = $1 AND ncf = $2`,
    [supplier.id, invoice.fiscalNumber],
  );
  check('el documento de A queda aprobado por su comprador', answered?.commercial_status === 'APPROVED', answered?.commercial_status);

  const unknown = await http.inject({ method: 'GET', url: `/dgii/000000000/fe/autenticacion/api/semilla` });
  check('un RNC sin receptor responde 404', unknown.statusCode === 404, String(unknown.statusCode));

  await app.close();
  if (failures.length) {
    console.error(`\n${failures.length} comprobación(es) fallaron:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('\nEl receptor e-CF cumple el ciclo de la DGII.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

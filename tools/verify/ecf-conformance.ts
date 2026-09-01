/**
 * Executable proof that an e-CF is built, validated, signed and addressed correctly.
 *
 * ## What this exists to stop from happening again
 *
 * The comprobante the product transmitted carried eleven elements. Everything else the DGII's
 * schema marks mandatory was absent — the authorization expiry, the payment breakdown, the coded
 * municipality, the namespace itself — and nothing validated the document before spending an e-NCF
 * on it, so the first sign of a problem was a rejection with the number already consumed. The
 * printed QR quoted a total computed by different code from the one in the XML, so on a document
 * with enough lines the two could disagree by cents and the DGII's timbre lookup would not resolve.
 *
 * This drives the real builder, validator and signer with real certificate material and checks the
 * output. It needs no network: everything up to transmission is local, and transmission is the one
 * part a CI run cannot exercise.
 */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';

import {
  EcfXmlBuilderService,
  EcfBuildContext,
} from '../../apps/backend/api/src/app/einvoicing/services/ecf-xml-builder.service';
import { EcfValidatorService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-validator.service';
import { EcfSignerService } from '../../apps/backend/api/src/app/einvoicing/services/ecf-signer.service';
import { CertificateVaultService } from '../../apps/backend/api/src/app/einvoicing/services/certificate-vault.service';
import {
  municipalityCode,
  provinceCode,
  paymentFormCode,
  unitOfMeasureCode,
} from '../../apps/backend/api/src/app/einvoicing/config/dgii-catalogues';
import { PaymentMethod } from '../../apps/backend/api/src/app/invoices/entities/invoice.entity';
import { EcfLifecycleXmlBuilder } from '../../apps/backend/api/src/app/einvoicing/services/ecf-lifecycle-xml.builder';
import { dgiiTimestamp, fiscalDate, organizationTimeZone } from '../../apps/backend/api/src/app/shared/fiscal-clock';

const failures: string[] = [];
function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ''}`);
}

/** A throwaway PKCS#12, so the signature path is exercised for real rather than stubbed. */
function makeCertificate(dir: string): { pfx: Buffer; password: string; certPem: string } {
  const password = 'sonda-ecf';
  const key = join(dir, 'key.pem');
  const cert = join(dir, 'cert.pem');
  const p12 = join(dir, 'test.p12');
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-keyout', key, '-out', cert,
    '-days', '30', '-nodes', '-subj', '/CN=SONDA e-CF',
  ], { stdio: 'ignore' });
  try {
    execFileSync('openssl', [
      'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', cert, '-passout', `pass:${password}`, '-legacy',
    ], { stdio: 'ignore' });
  } catch {
    execFileSync('openssl', [
      'pkcs12', '-export', '-out', p12, '-inkey', key, '-in', cert, '-passout', `pass:${password}`,
    ], { stdio: 'ignore' });
  }
  return { pfx: readFileSync(p12), password, certPem: readFileSync(cert, 'utf8') };
}

function baseContext(): EcfBuildContext {
  return {
    tipoECF: '31',
    eNCF: 'E310000000001',
    fechaVencimientoSecuencia: '31-12-2027',
    tipoIngresos: '01',
    tipoPago: '1',
    formasPago: [{ forma: paymentFormCode(PaymentMethod.CASH), monto: 3540 }],
    fechaEmision: '31-08-2026',
    fechaHoraFirma: '31-08-2026 10:15:00',
    emisor: {
      rnc: '131190317',
      razonSocial: 'Sonda Comercial SRL',
      nombreComercial: 'Sonda',
      direccion: 'Av. Winston Churchill 1099',
      municipio: municipalityCode('32', 'Santo Domingo Este') ?? undefined,
      provincia: provinceCode('32') ?? undefined,
      telefono: '8095550100',
      correo: 'facturacion@sonda.example',
      numeroFacturaInterna: 'FAC-00000001',
    },
    comprador: { rnc: '101234563', razonSocial: 'Cliente Crédito Fiscal SRL' },
    items: [
      {
        nombre: 'Mercancía gravada', indicadorBienoServicio: '1', cantidad: 2,
        unidadMedida: unitOfMeasureCode('UND'), precioUnitario: 1000, itbisTasa: 0.18,
      },
      {
        nombre: 'Servicio profesional', indicadorBienoServicio: '2', cantidad: 1.5,
        unidadMedida: unitOfMeasureCode('HR'), precioUnitario: 400, itbisTasa: 0.18,
      },
      {
        nombre: 'Libro exento', indicadorBienoServicio: '1', cantidad: 1,
        precioUnitario: 300, itbisTasa: 0, exento: true,
      },
      {
        nombre: 'Exportación tasa cero', indicadorBienoServicio: '1', cantidad: 1,
        precioUnitario: 200, itbisTasa: 0, exento: false,
      },
    ],
  };
}

function main(): void {
  const builder = new EcfXmlBuilderService();
  const validator = new EcfValidatorService();
  const signer = new EcfSignerService();

  const ctx = baseContext();
  const montoTotal = builder.montoTotal(ctx);
  ctx.formasPago = [{ forma: '01', monto: montoTotal }];

  // ── Structure ───────────────────────────────────────────────────────────────
  const xml = builder.build(ctx);
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const text = (tag: string): string | null => {
    const node = doc.getElementsByTagName(tag)[0];
    return node ? (node.textContent ?? '').trim() : null;
  };

  check('el comprobante declara el espacio de nombres del esquema', xml.includes('xmlns:xsi'));
  check('IdDoc lleva la fecha de vencimiento de la secuencia',
    text('FechaVencimientoSecuencia') === '31-12-2027', text('FechaVencimientoSecuencia') ?? 'ausente');
  check('IdDoc lleva el indicador de envío diferido', text('IndicadorEnvioDiferido') !== null);
  check('una venta al contado declara su forma de pago', text('FormaPago') === '01', text('FormaPago') ?? 'ausente');
  check('el municipio es un código de cuatro dígitos', /^\d{4}$/.test(text('Municipio') ?? ''),
    text('Municipio') ?? 'ausente');
  check('la provincia es un código de dos dígitos', /^\d{2}$/.test(text('Provincia') ?? ''),
    text('Provincia') ?? 'ausente');
  check('el emisor declara su nombre comercial', text('NombreComercial') === 'Sonda');
  check('el comprador queda identificado', text('RNCComprador') === '101234563');

  // ── Tax buckets ─────────────────────────────────────────────────────────────
  check('separa el monto gravado del exento',
    text('MontoGravadoI1') === '2600.00' && text('MontoExento') === '300.00',
    `gravado ${text('MontoGravadoI1')}, exento ${text('MontoExento')}`);
  check('la tasa cero se declara aparte del exento',
    text('MontoGravadoI3') === '200.00', text('MontoGravadoI3') ?? 'ausente');

  const indicadores = Array.from({ length: doc.getElementsByTagName('IndicadorFacturacion').length })
    .map((_, i) => doc.getElementsByTagName('IndicadorFacturacion')[i].textContent);
  check('el indicador de facturación distingue exento (4) de tasa cero (3)',
    indicadores.includes('4') && indicadores.includes('3'), indicadores.join(','));

  const services = doc.getElementsByTagName('IndicadorBienoServicio');
  const kinds = Array.from({ length: services.length }).map((_, i) => services[i].textContent);
  check('cada línea declara si es bien o servicio', kinds.includes('1') && kinds.includes('2'), kinds.join(','));
  check('la línea de servicio lleva su unidad de medida', xml.includes('<UnidadMedida>47</UnidadMedida>'));

  // ── The total is one number ─────────────────────────────────────────────────
  check('el total del XML coincide con el que se firma en el QR',
    text('MontoTotal') === montoTotal.toFixed(2),
    `XML ${text('MontoTotal')}, QR ${montoTotal.toFixed(2)}`);

  // ── Validation ──────────────────────────────────────────────────────────────
  check('un comprobante completo pasa la validación previa',
    validator.validate(ctx, montoTotal).length === 0,
    validator.validate(ctx, montoTotal).map((i) => i.field).join(','));

  const noExpiry = { ...baseContext(), fechaVencimientoSecuencia: undefined };
  check('se rechaza un comprobante sin vencimiento de secuencia',
    validator.validate(noExpiry, montoTotal).some((i) => i.field === 'FechaVencimientoSecuencia'));

  const noBuyer = { ...baseContext(), comprador: undefined };
  check('se rechaza un crédito fiscal sin comprador identificado',
    validator.validate(noBuyer, montoTotal).some((i) => i.field === 'RNCComprador'));

  const bigConsumo = { ...baseContext(), tipoECF: '32', eNCF: 'E320000000001', comprador: undefined };
  check('se exige identificar al comprador en consumo sobre el umbral',
    validator.validate(bigConsumo, 300_000).some((i) => i.field === 'RNCComprador'));

  const mismatchedPayment = baseContext();
  mismatchedPayment.formasPago = [{ forma: '01', monto: 1 }];
  check('se rechaza un desglose de pago que no suma el total',
    validator.validate(mismatchedPayment, montoTotal).some((i) => i.field === 'TablaFormasPago'));

  const creditNote = { ...baseContext(), tipoECF: '34', eNCF: 'E340000000001' };
  check('se exige la referencia al comprobante modificado en una nota',
    validator.validate(creditNote, montoTotal).some((i) => i.field === 'InformacionReferencia'));

  // ── Foreign currency ────────────────────────────────────────────────────────
  const foreign = baseContext();
  foreign.otraMoneda = { tipoMoneda: 'USD', tipoCambio: 58.5, montoTotal: 60.51 };
  check('una factura en divisa declara su moneda y su tasa',
    builder.build(foreign).includes('<TipoMoneda>USD</TipoMoneda>'));

  // ── Signature ───────────────────────────────────────────────────────────────
  const dir = mkdtempSync(join(tmpdir(), 'ecf-'));
  try {
    const { pfx, password, certPem } = makeCertificate(dir);
    const vault = new CertificateVaultService({
      get: (key: string) => (key === 'ECF_CERT_ENCRYPTION_KEY' ? 'clave-de-prueba-para-certificados' : undefined),
    } as never);

    check('el certificado sobrevive el cifrado en reposo', vault.decrypt(vault.encrypt(pfx)).equals(pfx));

    const loaded = vault.parsePkcs12(pfx, password);
    const signed = signer.sign(xml, loaded, 'ECF');
    check('el comprobante se firma', signed.includes('SignatureValue'));

    const signedDoc = new DOMParser().parseFromString(signed, 'text/xml');
    const signatureNode = signedDoc.getElementsByTagName('Signature')[0];
    const verifier = new SignedXml({ publicCert: certPem });
    verifier.loadSignature(signatureNode as never);
    check('la firma verifica criptográficamente', verifier.checkSignature(signed));

    const code = signer.securityCode(signed);
    check('el código de seguridad son seis caracteres', code.length === 6, code);

    // ── The rest of the cycle: the two messages that are not comprobantes ─────
    //
    // Both had transport code and endpoints and nothing else — no builder, no signature, no route —
    // so a taxpayer could neither answer a supplier's comprobante nor declare numbers it would
    // never use. Both are obligations under Norma 01-2020, not conveniences.
    const lifecycle = new EcfLifecycleXmlBuilder();

    const approval = lifecycle.buildCommercialApproval({
      rncEmisor: '130862346',
      rncComprador: '101010101',
      eNCF: 'E310000000042',
      fechaEmision: '15-08-2026',
      montoTotal: 1180,
      estado: '2',
      detalleMotivoRechazo: 'La mercancía no fue recibida.',
      fechaHoraAprobacion: dgiiTimestamp('America/Santo_Domingo'),
    });
    check('la aprobación comercial identifica a ambas partes',
      approval.includes('<RNCEmisor>130862346</RNCEmisor>') &&
      approval.includes('<RNCComprador>101010101</RNCComprador>'));
    check('un rechazo comercial lleva su motivo',
      approval.includes('<Estado>2</Estado>') && approval.includes('<DetalleMotivoRechazo>'));

    const signedApproval = signer.sign(approval, loaded, 'ACECF');
    const approvalDoc = new DOMParser().parseFromString(signedApproval, 'text/xml');
    const approvalVerifier = new SignedXml({ publicCert: certPem });
    approvalVerifier.loadSignature(approvalDoc.getElementsByTagName('Signature')[0] as never);
    check('la aprobación comercial se firma y verifica', approvalVerifier.checkSignature(signedApproval));

    const annulment = lifecycle.buildSequenceVoid({
      rnc: '130862346',
      fechaHoraAnulacion: dgiiTimestamp('America/Santo_Domingo'),
      ranges: [{ tipoECF: '31', desde: 'E310000000042', hasta: 'E310000000050' }],
    });
    // 42 through 50 inclusive is nine numbers. An off-by-one here is a number the DGII still
    // expects to receive.
    check('la anulación cuenta los e-NCF de extremo a extremo',
      annulment.includes('<CantidadeNCFAnulados>9</CantidadeNCFAnulados>'));

    const signedAnnulment = signer.sign(annulment, loaded, 'ANECF');
    const annulmentDoc = new DOMParser().parseFromString(signedAnnulment, 'text/xml');
    const annulmentVerifier = new SignedXml({ publicCert: certPem });
    annulmentVerifier.loadSignature(annulmentDoc.getElementsByTagName('Signature')[0] as never);
    check('la anulación de rango se firma y verifica', annulmentVerifier.checkSignature(signedAnnulment));

    // ── Fiscal clock ─────────────────────────────────────────────────────────
    //
    // 2026-09-01T00:30Z is 2026-08-31 20:30 in Santo Domingo. Stamped from the server clock, this
    // comprobante was signed with a date LATER than its own emission date and reported a month
    // late; the DGII rejects the first and an auditor finds the second.
    const lateEvening = new Date('2026-09-01T00:30:00Z');
    const zone = organizationTimeZone({ country: 'DO', timezone: 'UTC' });
    check('la marca de tiempo fiscal usa la zona del contribuyente',
      dgiiTimestamp(zone, lateEvening) === '31-08-2026 20:30:00', dgiiTimestamp(zone, lateEvening));
    check('una venta de la noche del último día del mes no salta de período',
      fiscalDate(zone, lateEvening) === '2026-08-31', fiscalDate(zone, lateEvening));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  console.log(
    failures.length
      ? `\nFAILURES:\n${failures.map((f) => `  - ${f}`).join('\n')}`
      : '\nEL e-CF SE CONSTRUYE, VALIDA Y FIRMA CONFORME AL FORMATO DE LA DGII',
  );
  process.exit(failures.length ? 1 : 0);
}

main();

import * as xmlbuilder from 'xmlbuilder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';
import { fiscalConsecutive } from '../fiscal-number';

/**
 * Ecuador — comprobante electrónico, SRI.
 *
 * ## The clave de acceso
 *
 * Forty-nine digits that identify the document and are computed by the issuer, not assigned by the
 * authority: date, document type, RUC, environment, establishment and emission point, sequential,
 * a numeric code, the emission type, and a check digit over the other forty-eight by **modulus 11
 * with weights cycling 2..7 from the right**. The SRI recomputes it; a document whose key does not
 * reproduce is rejected on receipt.
 *
 * The two special cases in the check digit are the ones every implementation gets wrong: a
 * remainder of 0 gives a digit of 0, and a remainder of 1 gives a digit of 1 — not 11 and not 10.
 * They are rare enough to pass casual testing and to fail in production.
 *
 * *Verificar con contabilidad/legal*: the SRI's `ficha técnica` fixes the field order and the
 * catalogues (`01` factura, `04` nota de crédito, `1` producción / `2` pruebas). Before filing, the
 * key this produces should be checked against the SRI's own validator for one document.
 */
export interface SriBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** `1` pruebas, `2` producción. The SRI numbers them the opposite way round to Colombia. */
  environment: '1' | '2';
  /** Three digits each, assigned by the SRI: `001`, `001`. */
  establishment: string;
  emissionPoint: string;
  /** Eight digits the taxpayer chooses; part of the key so two documents cannot collide. */
  numericCode: string;
}

export class SriBuilder {
  build(input: SriBuildInput): { xml: string; accessKey: string } {
    this.assertIssuable(input);
    const accessKey = this.accessKey(input);
    return { xml: this.document(input, accessKey), accessKey };
  }

  /**
   * The forty-nine digit clave de acceso.
   *
   * `ddmmaaaa` + tipo(2) + ruc(13) + ambiente(1) + serie(6) + secuencial(9) + código(8) +
   * tipoEmisión(1) + verificador(1).
   */
  accessKey(input: SriBuildInput): string {
    const { invoice, organization } = input;
    const body = [
      this.ddmmyyyy(invoice.issueDate),
      this.documentType(invoice),
      (organization.taxId ?? '').replace(/\D/g, '').padStart(13, '0').slice(0, 13),
      input.environment,
      `${input.establishment}${input.emissionPoint}`,
      this.sequential(fiscalConsecutive(invoice)),
      input.numericCode.replace(/\D/g, '').padStart(8, '0').slice(0, 8),
      // `1` emisión normal. Contingency emission is `2` and is a different operational state.
      '1',
    ].join('');

    return `${body}${this.modulus11(body)}`;
  }

  /**
   * Modulus 11 with weights 2..7 cycling from the right.
   *
   * The two cases that matter: a remainder of 0 gives 0 and a remainder of 1 gives 1. Writing
   * `11 - remainder` unconditionally yields 11 and 10, which are not digits, and the bug survives
   * any test that does not happen to hit those two remainders.
   */
  modulus11(digits: string): string {
    let total = 0;
    let weight = 2;
    for (let index = digits.length - 1; index >= 0; index--) {
      total += Number(digits[index]) * weight;
      weight = weight === 7 ? 2 : weight + 1;
    }
    const remainder = total % 11;
    if (remainder === 0) return '0';
    if (remainder === 1) return '1';
    return String(11 - remainder);
  }

  private document(input: SriBuildInput, accessKey: string): string {
    const { invoice, organization, customer } = input;
    const currency = invoice.currencyCode ?? 'USD';
    const amount = (value: number) => roundToCurrency(value, currency).toFixed(2);

    const root = xmlbuilder
      .create('factura', { encoding: 'UTF-8' })
      .att('id', 'comprobante')
      .att('version', '2.1.0');

    const info = root.ele('infoTributaria');
    info.ele('ambiente', {}, input.environment);
    info.ele('tipoEmision', {}, '1');
    info.ele('razonSocial', {}, organization.legalName);
    info.ele('ruc', {}, (organization.taxId ?? '').replace(/\D/g, ''));
    info.ele('claveAcceso', {}, accessKey);
    info.ele('codDoc', {}, this.documentType(invoice));
    info.ele('estab', {}, input.establishment);
    info.ele('ptoEmi', {}, input.emissionPoint);
    info.ele('secuencial', {}, this.sequential(fiscalConsecutive(invoice)));
    info.ele('dirMatriz', {}, organization.address ?? '');

    const infoFactura = root.ele('infoFactura');
    infoFactura.ele('fechaEmision', {}, this.ddmmyyyySlashed(invoice.issueDate));
    infoFactura.ele('obligadoContabilidad', {}, 'SI');
    infoFactura.ele('tipoIdentificacionComprador', {}, this.buyerDocumentType(customer));
    infoFactura.ele('razonSocialComprador', {}, customer.companyName);
    infoFactura.ele('identificacionComprador', {}, (customer.taxId ?? '').replace(/\D/g, ''));
    infoFactura.ele('totalSinImpuestos', {}, amount(invoice.subtotal));
    infoFactura.ele('totalDescuento', {}, amount(invoice.discountTotal ?? 0));

    const totals = infoFactura.ele('totalConImpuestos');
    const totalTax = totals.ele('totalImpuesto');
    // Código `2` IVA; codigoPorcentaje `4` es 15 %, `2` 12 %, `0` 0 %.
    totalTax.ele('codigo', {}, '2');
    totalTax.ele('codigoPorcentaje', {}, this.ivaCode(invoice));
    totalTax.ele('baseImponible', {}, amount(invoice.taxedTotal ?? invoice.subtotal));
    totalTax.ele('valor', {}, amount(invoice.tax ?? 0));

    infoFactura.ele('propina', {}, amount(invoice.serviceCharge ?? 0));
    infoFactura.ele('importeTotal', {}, amount(invoice.total));
    infoFactura.ele('moneda', {}, 'DOLAR');

    const detalles = root.ele('detalles');
    for (const line of invoice.lineItems ?? []) {
      const detalle = detalles.ele('detalle');
      detalle.ele('codigoPrincipal', {}, line.fiscalCodes?.['codigoPrincipal'] ?? '');
      detalle.ele('descripcion', {}, line.description ?? '');
      detalle.ele('cantidad', {}, Number(line.quantity).toFixed(6));
      detalle.ele('precioUnitario', {}, Number(line.price ?? 0).toFixed(6));
      detalle.ele('descuento', {}, amount(line.discountAmount ?? 0));
      detalle.ele('precioTotalSinImpuesto', {}, amount(line.lineSubtotal ?? 0));

      const impuestos = detalle.ele('impuestos').ele('impuesto');
      impuestos.ele('codigo', {}, '2');
      impuestos.ele('codigoPorcentaje', {}, this.ivaCodeForRate(Number(line.taxRate ?? 0)));
      impuestos.ele('tarifa', {}, (Number(line.taxRate ?? 0) * 100).toFixed(2));
      impuestos.ele('baseImponible', {}, amount(line.taxableBase ?? line.lineSubtotal ?? 0));
      impuestos.ele('valor', {}, amount(line.taxAmount ?? 0));
    }

    return root.end({ pretty: false });
  }

  /** `01` factura, `04` nota de crédito. */
  /**
   * The authority's document-type code for this invoice.
   *
   * Public because the numbering adapter has to draw the number from the range authorised for
   * THIS type, and it must reach that answer the same way the builder does. Two copies of the
   * rule is how a document ends up numbered from the exenta range and built as an afecta.
   */
  documentType(invoice: Invoice): string {
    return invoice.type === InvoiceType.CREDIT_NOTE ? '04' : '01';
  }

  /** `04` RUC (13 digits), `05` cédula (10), `06` pasaporte, `07` consumidor final. */
  private buyerDocumentType(customer: Customer): string {
    const digits = (customer.taxId ?? '').replace(/\D/g, '');
    if (digits.length === 13) return '04';
    if (digits.length === 10) return '05';
    return '07';
  }

  /** The SRI's `codigoPorcentaje` for the document's predominant rate. */
  private ivaCode(invoice: Invoice): string {
    const rates = (invoice.lineItems ?? [])
      .filter((line) => Number(line.taxAmount ?? 0) > 0)
      .map((line) => Number(line.taxRate ?? 0));
    return this.ivaCodeForRate(rates[0] ?? 0);
  }

  private ivaCodeForRate(rate: number): string {
    const percent = Math.round(rate * 100);
    if (percent === 15) return '4';
    if (percent === 12) return '2';
    if (percent === 14) return '3';
    if (percent === 5) return '5';
    return '0';
  }

  private sequential(invoiceNumber: string): string {
    const digits = invoiceNumber.replace(/\D/g, '');
    return (digits || '1').padStart(9, '0').slice(-9);
  }

  private ddmmyyyy(value: Date | string): string {
    const iso = (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
    const [year, month, day] = iso.split('-');
    return `${day}${month}${year}`;
  }

  private ddmmyyyySlashed(value: Date | string): string {
    const iso = (typeof value === 'string' ? value : value.toISOString()).slice(0, 10);
    const [year, month, day] = iso.split('-');
    return `${day}/${month}/${year}`;
  }

  private assertIssuable(input: SriBuildInput): void {
    if (!(input.organization.taxId ?? '').replace(/\D/g, '')) {
      throw new BadRequestError('EINVOICING.SRI_EMISOR_SIN_RUC');
    }
    if (!input.establishment?.trim() || !input.emissionPoint?.trim()) {
      throw new BadRequestError('EINVOICING.SRI_SIN_ESTABLECIMIENTO');
    }
  }
}

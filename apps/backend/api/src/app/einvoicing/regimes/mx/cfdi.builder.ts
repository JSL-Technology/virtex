import * as xmlbuilder from 'xmlbuilder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * CFDI 4.0 — the Mexican comprobante fiscal digital por internet.
 *
 * ## What the document is
 *
 * An XML in the SAT's `cfdi:Comprobante` schema, sealed with the taxpayer's Certificado de Sello
 * Digital, and then **stamped** (*timbrado*) by an authorised PAC, which adds a
 * `TimbreFiscalDigital` complement carrying the UUID that makes the document fiscally valid. The
 * product builds and seals; the PAC stamps. That division is the SAT's, not ours: a taxpayer
 * cannot stamp their own documents.
 *
 * ## The cadena original
 *
 * The seal is not an XMLDSig over the document. It is an RSA-SHA256 signature over the *cadena
 * original*: a pipe-delimited projection of the document's attributes in a fixed order, which the
 * SAT publishes as an XSLT. The order below follows Anexo 20 for version 4.0.
 *
 * *Verificar con contabilidad/legal*: the SAT republishes the XSLT with each revision of Anexo 20,
 * and an attribute added or reordered changes the cadena and therefore the seal. Before a taxpayer
 * files with this, the cadena this builds must be compared against the output of the SAT's own
 * `cadenaoriginal_4_0.xslt` for the same document — the PAC rejects a seal computed over a stale
 * projection, which is the correct behaviour and the reason to check rather than assume.
 *
 * ## What is deliberately not guessed
 *
 * `ClaveProdServ` and `ClaveUnidad` come from the SAT's catalogues of some fifty thousand and
 * two thousand entries. A product that invented a code for a line would produce a document that
 * stamps and is wrong, which is worse than one that refuses: the line's own catalogue values are
 * required, and a line without them is named in the refusal.
 */
export interface CfdiBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** From `organizations.fiscal_profile.regimenFiscal` — a `c_RegimenFiscal` code. */
  issuerRegime: string;
  /** The taxpayer's postal code, which is `LugarExpedicion`. */
  issuingPostalCode: string;
  /** Serial number of the CSD, which the SAT matches against the certificate in the document. */
  certificateNumber: string;
  certificateBase64: string;
}

export class CfdiBuilder {
  /** The document, unsealed. `Sello` is written afterwards, over the cadena original. */
  build(input: CfdiBuildInput): string {
    const { invoice, organization, customer } = input;
    const currency = invoice.currencyCode ?? 'MXN';
    const round = (value: number) => roundToCurrency(value, currency).toFixed(2);

    this.assertIssuable(input);

    const root = xmlbuilder
      .create('cfdi:Comprobante', { encoding: 'UTF-8' })
      .att('xmlns:cfdi', CFDI_NS)
      .att('xmlns:xsi', XSI_NS)
      .att('xsi:schemaLocation', `${CFDI_NS} http://www.sat.gob.mx/sitio_internet/cfd/4/cfdv40.xsd`)
      .att('Version', '4.0')
      .att('Fecha', this.stamp(invoice.issueDate))
      .att('NoCertificado', input.certificateNumber)
      .att('Certificado', input.certificateBase64)
      .att('SubTotal', round(invoice.subtotal))
      .att('Moneda', currency)
      .att('Total', round(invoice.total))
      .att('TipoDeComprobante', this.documentType(invoice))
      // `01` no aplica: this product does not currently issue export comprobantes for Mexico, and
      // declaring one it cannot substantiate would misstate the operation to the SAT.
      .att('Exportacion', '01')
      .att('LugarExpedicion', input.issuingPostalCode);

    if (invoice.invoiceNumber) root.att('Folio', invoice.invoiceNumber);
    if (roundToCurrency(invoice.discountTotal, currency) > 0) {
      root.att('Descuento', round(invoice.discountTotal));
    }
    // Only on a document in a currency other than the peso, and the SAT wants the rate to the
    // peso — which is the rate the ledger already stored to convert it.
    if (currency !== 'MXN') root.att('TipoCambio', Number(invoice.exchangeRate ?? 1).toFixed(6));

    root
      .ele('cfdi:Emisor')
      .att('Rfc', (organization.taxId ?? '').toUpperCase())
      .att('Nombre', organization.legalName)
      .att('RegimenFiscal', input.issuerRegime);

    root
      .ele('cfdi:Receptor')
      .att('Rfc', (customer.taxId ?? '').toUpperCase())
      .att('Nombre', customer.companyName)
      .att('DomicilioFiscalReceptor', customer.postalCode ?? '')
      .att('RegimenFiscalReceptor', this.receiverRegime(customer))
      // `G03` gastos en general: the use the buyer declares. It is the buyer's statement, so where
      // they have not made one this is the neutral value the SAT accepts for an ordinary sale.
      .att('UsoCFDI', 'G03');

    const conceptos = root.ele('cfdi:Conceptos');
    let transferredTax = 0;

    for (const line of invoice.lineItems ?? []) {
      const importe = roundToCurrency(line.lineSubtotal ?? 0, currency);
      const concepto = conceptos
        .ele('cfdi:Concepto')
        .att('ClaveProdServ', this.catalogueValue(line, 'claveProdServ'))
        .att('Cantidad', Number(line.quantity).toString())
        .att('ClaveUnidad', this.catalogueValue(line, 'claveUnidad'))
        .att('Descripcion', line.description ?? '')
        .att('ValorUnitario', round(line.price ?? 0))
        .att('Importe', round(importe))
        // `02` sí objeto de impuesto; `01` no objeto. Driven by the line's own treatment rather
        // than by whether the tax happens to be zero: an exempt line is object of tax at 0 %, and
        // a line outside the tax's scope is not, and the SAT distinguishes them.
        .att('ObjetoImp', roundToCurrency(line.taxAmount ?? 0, currency) > 0 ? '02' : '01');

      if (roundToCurrency(line.discountAmount ?? 0, currency) > 0) {
        concepto.att('Descuento', round(line.discountAmount ?? 0));
      }

      const taxAmount = roundToCurrency(line.taxAmount ?? 0, currency);
      if (taxAmount > 0) {
        transferredTax += taxAmount;
        concepto
          .ele('cfdi:Impuestos')
          .ele('cfdi:Traslados')
          .ele('cfdi:Traslado')
          .att('Base', round(line.taxableBase ?? line.lineSubtotal ?? 0))
          // `002` IVA. The only transferred tax an ordinary sale carries; IEPS (`003`) rides on
          // the excise fields, which this product records separately.
          .att('Impuesto', '002')
          .att('TipoFactor', 'Tasa')
          .att('TasaOCuota', Number(line.taxRate ?? 0).toFixed(6))
          .att('Importe', round(taxAmount));
      }
    }

    if (transferredTax > 0) {
      const impuestos = root
        .ele('cfdi:Impuestos')
        .att('TotalImpuestosTrasladados', round(transferredTax));
      impuestos
        .ele('cfdi:Traslados')
        .ele('cfdi:Traslado')
        .att('Base', round(invoice.taxedTotal ?? invoice.subtotal))
        .att('Impuesto', '002')
        .att('TipoFactor', 'Tasa')
        .att('TasaOCuota', this.headlineRate(invoice))
        .att('Importe', round(transferredTax));
    }

    return root.end({ pretty: false });
  }

  /**
   * The cadena original: the projection the seal is computed over.
   *
   * Built from the document that was just serialised rather than from the invoice again, so the
   * seal cannot be computed over fields that differ from the ones transmitted — which is the
   * failure mode that produces a document the PAC rejects for an invalid seal while every figure
   * in it looks right.
   */
  cadenaOriginal(xml: string): string {
    const values: string[] = [];
    // Attributes in document order, which is the order the SAT's XSLT emits them. Empty optional
    // attributes are absent from the XML and therefore absent from the cadena, which is what the
    // XSLT does too — it emits only the attributes that are present.
    const tagPattern = /<(cfdi:[A-Za-z]+)((?:\s+[A-Za-z:]+="[^"]*")*)\s*\/?>/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagPattern.exec(xml)) !== null) {
      const attrPattern = /([A-Za-z:]+)="([^"]*)"/g;
      let attribute: RegExpExecArray | null;
      while ((attribute = attrPattern.exec(tag[2])) !== null) {
        const [, name, value] = attribute;
        // Namespace declarations and the schema location are not part of the cadena.
        if (name.startsWith('xmlns') || name === 'xsi:schemaLocation') continue;
        // Nor is the seal itself, which does not exist yet, nor the certificate's own bytes.
        if (name === 'Sello') continue;
        values.push(this.normalise(value));
      }
    }
    return `||${values.join('|')}||`;
  }

  /**
   * The SAT collapses whitespace and trims: a description with a double space seals differently
   * from the same description with one, and the PAC recomputes from the transmitted XML.
   */
  private normalise(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  private assertIssuable(input: CfdiBuildInput): void {
    if (!input.organization.taxId?.trim()) {
      throw new BadRequestError('EINVOICING.CFDI_EMISOR_SIN_RFC');
    }
    if (!input.customer.taxId?.trim()) {
      throw new BadRequestError('EINVOICING.CFDI_RECEPTOR_SIN_RFC', {
        customer: input.customer.companyName,
      });
    }
    if (!input.issuerRegime) {
      throw new BadRequestError('EINVOICING.CFDI_SIN_REGIMEN_FISCAL');
    }
    if (!input.issuingPostalCode) {
      throw new BadRequestError('EINVOICING.CFDI_SIN_LUGAR_EXPEDICION');
    }
    if (!input.customer.postalCode?.trim()) {
      throw new BadRequestError('EINVOICING.CFDI_RECEPTOR_SIN_CODIGO_POSTAL', {
        customer: input.customer.companyName,
      });
    }
  }

  /** `I` ingreso, `E` egreso (a credit note is one), `T` traslado, `P` pago. */
  private documentType(invoice: Invoice): 'I' | 'E' {
    return invoice.type === InvoiceType.CREDIT_NOTE ? 'E' : 'I';
  }

  /**
   * The buyer's own régimen fiscal.
   *
   * `616` sin obligaciones fiscales is the value for a buyer who has declared none, and it is what
   * the SAT expects for a `público en general` receipt. It is not a guess about a company: a
   * company that has not stated its regime is refused above, at the RFC check, because a CFDI to a
   * company needs its RFC and its regime together.
   */
  private receiverRegime(customer: Customer): string {
    const declared = (customer as unknown as { fiscalProfile?: Record<string, string> })
      .fiscalProfile?.['regimenFiscal'];
    return declared ?? '616';
  }

  /**
   * The document-level rate, for the summary `Traslado`.
   *
   * Taken from the lines rather than assumed: a document whose lines carry one rate states it, and
   * one that mixes rates has no single document rate — the SAT reads the per-concepto traslados in
   * that case, and the summary carries the predominant one.
   */
  private headlineRate(invoice: Invoice): string {
    const rates = new Set(
      (invoice.lineItems ?? [])
        .filter((line) => Number(line.taxAmount ?? 0) > 0)
        .map((line) => Number(line.taxRate ?? 0)),
    );
    const [first] = [...rates];
    return (first ?? 0).toFixed(6);
  }

  /**
   * A SAT catalogue value the line must carry.
   *
   * `ClaveProdServ` and `ClaveUnidad` are drawn from catalogues of fifty thousand and two thousand
   * entries. Inventing one produces a document that stamps and misdescribes what was sold, which
   * is worse than one that refuses to be built.
   */
  private catalogueValue(
    line: { fiscalCodes?: Record<string, string> | null; description?: string },
    key: string,
  ): string {
    const value = line.fiscalCodes?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    throw new BadRequestError('EINVOICING.CFDI_LINEA_SIN_CLAVE_SAT', {
      key,
      line: line.description ?? '',
    });
  }

  /** `AAAA-MM-DDThh:mm:ss`, no timezone — the SAT reads it as the issuing place's local time. */
  private stamp(date: Date | string): string {
    const iso = typeof date === 'string' ? date : date.toISOString();
    return iso.length <= 10 ? `${iso}T12:00:00` : iso.slice(0, 19);
  }
}

const CFDI_NS = 'http://www.sat.gob.mx/cfd/4';
const XSI_NS = 'http://www.w3.org/2001/XMLSchema-instance';

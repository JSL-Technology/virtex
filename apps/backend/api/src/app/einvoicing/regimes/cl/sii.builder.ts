import * as xmlbuilder from 'xmlbuilder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';

/**
 * Chile — Documento Tributario Electrónico, SII.
 *
 * ## The CAF, and why it is not like an NCF
 *
 * The SII issues a *Código de Autorización de Folios*: an XML containing a range of document
 * numbers **and an RSA private key** that authorises them. A DTE carries a `TED` — timbre
 * electrónico — sealed with that key, and the SII verifies the timbre against the public key it
 * issued with the range. So a Chilean document is signed twice, with two different keys: the
 * taxpayer's certificate signs the DTE, and the CAF's key signs the timbre inside it.
 *
 * That is why the folio range cannot be a counter like the Dominican NCF. Exhausting a CAF means
 * requesting another one from the SII, and the new range comes with its own key: a document
 * numbered from range A and sealed with range B's key is rejected.
 *
 * ## Amounts are integers
 *
 * The Chilean peso has no minor unit, and the SII rejects a decimal point in a peso amount. The
 * rounding already happens in `roundToCurrency`, which knows CLP has zero decimals; what this adds
 * is writing them without a decimal separator, which is a formatting rule and not an arithmetic one.
 *
 * *Verificar con contabilidad/legal*: the `TED`'s own field order (`DD`, and the `FRMT` sealed over
 * it) is fixed by the SII's technical instructions, and the document types (`33` factura afecta,
 * `34` exenta, `61` nota de crédito) come from its own list.
 */
export interface SiiBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** The authorised range this folio was drawn from, and the key that seals its timbre. */
  caf: { folio: number; rangeFrom: number; rangeTo: number; authorizedOn: string; privateKeyPem: string; rawCafXml: string };
  /** The tenant's economic activity code, which the SII requires on the document. */
  activityCode: string;
  /** Comuna and city of the issuing address. */
  origin: { comuna: string; city: string; address: string };
}

export class SiiBuilder {
  build(input: SiiBuildInput): { xml: string; ted: string; folio: number } {
    this.assertIssuable(input);
    const documentId = `DTE-${this.documentType(input.invoice)}-${input.caf.folio}`;
    const ted = this.ted(input);
    return { xml: this.dte(input, documentId, ted), ted, folio: input.caf.folio };
  }

  /**
   * The `DD` — the data the timbre seals.
   *
   * The SII fixes it: issuer RUT, document type, folio, date, receiver RUT, receiver name, total,
   * the first line's description, the CAF, and the moment of stamping. Its purpose is that a
   * printed document can be verified offline from its own barcode, so it deliberately carries the
   * few fields a person would check by eye.
   */
  ted(input: SiiBuildInput): string {
    const { invoice, organization, customer, caf } = input;

    const dd = xmlbuilder
      .create('DD')
      .ele('RE', {}, this.rut(organization.taxId))
      .up()
      .ele('TD', {}, this.documentType(invoice))
      .up()
      .ele('F', {}, String(caf.folio))
      .up()
      .ele('FE', {}, this.date(invoice.issueDate))
      .up()
      .ele('RR', {}, this.rut(customer.taxId))
      .up()
      .ele('RSR', {}, (customer.companyName ?? '').slice(0, 40))
      .up()
      .ele('MNT', {}, this.integer(invoice.total))
      .up()
      .ele('IT1', {}, (invoice.lineItems?.[0]?.description ?? '').slice(0, 40))
      .up();

    return dd.end({ pretty: false });
  }

  private dte(input: SiiBuildInput, documentId: string, ted: string): string {
    const { invoice, organization, customer } = input;

    const root = xmlbuilder
      .create('DTE', { encoding: 'ISO-8859-1' })
      .att('xmlns', SII_NS)
      .att('version', '1.0');

    // The signature references this element by id, not the envelope: signing the envelope is a
    // document the SII rejects.
    const documento = root.ele('Documento').att('ID', documentId);

    const encabezado = documento.ele('Encabezado');
    const idDoc = encabezado.ele('IdDoc');
    idDoc.ele('TipoDTE', {}, this.documentType(invoice));
    idDoc.ele('Folio', {}, String(input.caf.folio));
    idDoc.ele('FchEmis', {}, this.date(invoice.issueDate));

    const emisor = encabezado.ele('Emisor');
    emisor.ele('RUTEmisor', {}, this.rut(organization.taxId));
    emisor.ele('RznSoc', {}, organization.legalName);
    emisor.ele('GiroEmis', {}, (organization.industry ?? '').slice(0, 80));
    emisor.ele('Acteco', {}, input.activityCode);
    emisor.ele('DirOrigen', {}, input.origin.address);
    emisor.ele('CmnaOrigen', {}, input.origin.comuna);
    emisor.ele('CiudadOrigen', {}, input.origin.city);

    const receptor = encabezado.ele('Receptor');
    receptor.ele('RUTRecep', {}, this.rut(customer.taxId));
    receptor.ele('RznSocRecep', {}, customer.companyName);
    if (customer.address) receptor.ele('DirRecep', {}, customer.address);
    if (customer.city) receptor.ele('CmnaRecep', {}, customer.city);

    const totales = encabezado.ele('Totales');
    totales.ele('MntNeto', {}, this.integer(invoice.taxedTotal ?? invoice.subtotal));
    if (roundToCurrency(invoice.exemptTotal ?? 0, 'CLP') > 0) {
      totales.ele('MntExe', {}, this.integer(invoice.exemptTotal ?? 0));
    }
    totales.ele('TasaIVA', {}, this.headlineRate(invoice));
    totales.ele('IVA', {}, this.integer(invoice.tax ?? 0));
    totales.ele('MntTotal', {}, this.integer(invoice.total));

    for (const [index, line] of (invoice.lineItems ?? []).entries()) {
      const detalle = documento.ele('Detalle');
      detalle.ele('NroLinDet', {}, String(index + 1));
      const code = line.fiscalCodes?.['codigoItem'];
      if (code) {
        const identifier = detalle.ele('CdgItem');
        identifier.ele('TpoCodigo', {}, 'INT1');
        identifier.ele('VlrCodigo', {}, code);
      }
      detalle.ele('NmbItem', {}, (line.description ?? '').slice(0, 80));
      detalle.ele('QtyItem', {}, String(line.quantity));
      detalle.ele('PrcItem', {}, this.integer(line.price ?? 0));
      detalle.ele('MontoItem', {}, this.integer(line.lineSubtotal ?? 0));
    }

    // The timbre, whose `FRMT` is sealed with the CAF's own key rather than the taxpayer's
    // certificate. Written unsealed here; `SiiRegimeAdapter.seal` fills it.
    const tedNode = documento.ele('TED').att('version', '1.0');
    tedNode.raw(ted.replace(/<\?xml[^>]*\?>/, ''));
    tedNode.ele('FRMT', { algoritmo: 'SHA1withRSA' }, '');

    documento.ele('TmstFirma', {}, this.timestamp(invoice.issueDate));

    return root.end({ pretty: false });
  }

  /** `33` factura afecta, `34` exenta, `61` nota de crédito. */
  /**
   * The authority's document-type code for this invoice.
   *
   * Public because the numbering adapter has to draw the number from the range authorised for
   * THIS type, and it must reach that answer the same way the builder does. Two copies of the
   * rule is how a document ends up numbered from the exenta range and built as an afecta.
   */
  documentType(invoice: Invoice): string {
    if (invoice.type === InvoiceType.CREDIT_NOTE) return '61';
    return roundToCurrency(invoice.tax ?? 0, 'CLP') > 0 ? '33' : '34';
  }

  /** `12345678-9` — the SII writes the RUT with its check character and no thousands dots. */
  private rut(value: string | null | undefined): string {
    const raw = (value ?? '').replace(/[.\s]/g, '').toUpperCase();
    if (raw.includes('-')) return raw;
    return raw.length > 1 ? `${raw.slice(0, -1)}-${raw.slice(-1)}` : raw;
  }

  /** The peso has no minor unit, and the SII rejects a decimal point in an amount. */
  private integer(value: number): string {
    return String(Math.round(roundToCurrency(value, 'CLP')));
  }

  private headlineRate(invoice: Invoice): string {
    const rates = (invoice.lineItems ?? [])
      .filter((line) => Number(line.taxAmount ?? 0) > 0)
      .map((line) => Number(line.taxRate ?? 0) * 100);
    return (rates[0] ?? 19).toFixed(1);
  }

  private assertIssuable(input: SiiBuildInput): void {
    if (!this.rut(input.organization.taxId)) throw new BadRequestError('EINVOICING.SII_EMISOR_SIN_RUT');
    if (!this.rut(input.customer.taxId)) {
      throw new BadRequestError('EINVOICING.SII_RECEPTOR_SIN_RUT', {
        customer: input.customer.companyName,
      });
    }
    if (!input.caf?.privateKeyPem) throw new BadRequestError('EINVOICING.SII_SIN_CAF');
    // A folio outside the authorised range is rejected: the SII verifies the timbre against the
    // key it issued *with that range*, so the two are one fact and not two.
    if (input.caf.folio < input.caf.rangeFrom || input.caf.folio > input.caf.rangeTo) {
      throw new BadRequestError('EINVOICING.SII_FOLIO_FUERA_DE_RANGO', {
        folio: input.caf.folio,
        from: input.caf.rangeFrom,
        to: input.caf.rangeTo,
      });
    }
    if (!input.activityCode?.trim()) throw new BadRequestError('EINVOICING.SII_SIN_ACTIVIDAD');
  }

  private date(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    return iso.slice(0, 10);
  }

  private timestamp(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    return iso.length > 10 ? iso.slice(0, 19) : `${iso}T12:00:00`;
  }
}

const SII_NS = 'http://www.sii.cl/SiiDte';

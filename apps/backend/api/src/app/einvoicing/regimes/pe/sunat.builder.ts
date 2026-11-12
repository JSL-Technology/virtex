import * as xmlbuilder from 'xmlbuilder';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { ModifiedDocumentReference, requiredNumber, requiredReasonCode } from '../modified-document';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';
import { fiscalConsecutive, issuedDocumentType } from '../fiscal-number';
import { buyerRegimeDocumentCode } from '../buyer-document';

/**
 * Peru — comprobante de pago electrónico, SUNAT, UBL 2.1.
 *
 * ## What SUNAT is strict about
 *
 * The document's own name. A Peruvian comprobante is identified by
 * `RUC-TipoDocumento-Serie-Correlativo` — `20123456789-01-F001-00000123` — and that string is the
 * file name, the ZIP name inside it, and the identifier in every subsequent exchange. Getting the
 * series wrong (an `F` series is a factura, a `B` series a boleta) is not a cosmetic error: SUNAT
 * rejects the submission before reading the document.
 *
 * ## The CDR is the receipt
 *
 * SUNAT answers with a *Constancia de Recepción* — a signed XML inside a ZIP — and that, not the
 * submission, is what proves the document was accepted. It has to be stored: a taxpayer asked to
 * prove a sale was declared produces the CDR, and one that only kept the invoice cannot.
 *
 * *Verificar con contabilidad/legal*: the catalogues (`catalogo 01` document types, `catalogo 05`
 * taxes, `catalogo 07` affectation types) are revised by resolution. `1000` IGV and `10` gravado
 * are the ordinary values used here; a taxpayer with exonerated or unaffected operations carries
 * different affectation codes per line and those come from the product's own catalogue values.
 */
export interface SunatBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** Set on a nota de crédito/débito: the document it corrects, and SUNAT's code for why. */
  modifies?: ModifiedDocumentReference | null;
  /** `F001` for a factura, `B001` for a boleta. Its first letter must match the document type. */
  series: string;
}

export class SunatBuilder {
  build(input: SunatBuildInput): { xml: string; documentName: string } {
    this.assertIssuable(input);
    const { invoice, organization, customer } = input;
    const currency = invoice.currencyCode ?? 'PEN';
    const amount = (value: number) => roundToCurrency(value, currency).toFixed(2);
    const ruc = (organization.taxId ?? '').replace(/\D/g, '');
    const documentType = this.documentType(input);
    const correlative = this.correlative(fiscalConsecutive(invoice));

    // A nota de crédito (07) and a nota de débito (08) are UBL documents of their own, each with
    // its own namespace, its own line element and its own quantity. The note's kind came from
    // `invoice.type`, so a Peruvian debit note was written as an `Invoice` — which SUNAT refuses.
    const document = DOCUMENTS[documentType] ?? DOCUMENTS['01'];

    const root = xmlbuilder
      .create(document.root, { encoding: 'UTF-8' })
      .att('xmlns', document.ns)
      .att('xmlns:cac', CAC_NS)
      .att('xmlns:cbc', CBC_NS)
      .att('xmlns:ext', EXT_NS);

    // The signature lives inside this extension, which SUNAT requires to be present and empty
    // until it is filled.
    root.ele('ext:UBLExtensions').ele('ext:UBLExtension').ele('ext:ExtensionContent');

    root.ele('cbc:UBLVersionID', {}, '2.1');
    root.ele('cbc:CustomizationID', {}, '2.0');
    root.ele('cbc:ID', {}, `${input.series}-${correlative}`);
    root.ele('cbc:IssueDate', {}, this.date(invoice.issueDate));
    if (invoice.dueDate) root.ele('cbc:DueDate', {}, this.date(invoice.dueDate));
    // Only a factura or boleta carries `InvoiceTypeCode`: on a note the type is the document's own
    // root, and the list the code belongs to is the note's reason catalogue instead.
    if (!document.isNote) {
      root.ele('cbc:InvoiceTypeCode', { listID: '0101' }, documentType);
    }
    root.ele('cbc:DocumentCurrencyCode', {}, currency);

    this.party(root.ele('cac:AccountingSupplierParty'), organization.legalName, ruc, '6');
    this.party(
      root.ele('cac:AccountingCustomerParty'),
      customer.companyName,
      (customer.taxId ?? '').replace(/\D/g, ''),
      this.customerDocumentType(customer),
    );

    if (roundToCurrency(invoice.tax ?? 0, currency) > 0) {
      const taxTotal = root.ele('cac:TaxTotal');
      taxTotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(invoice.tax ?? 0));
      const subtotal = taxTotal.ele('cac:TaxSubtotal');
      subtotal.ele('cbc:TaxableAmount', { currencyID: currency }, amount(invoice.taxedTotal ?? invoice.subtotal));
      subtotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(invoice.tax ?? 0));
      const scheme = subtotal.ele('cac:TaxCategory').ele('cac:TaxScheme');
      // Catálogo 05: `1000` IGV, `VAT`, `IGV`.
      scheme.ele('cbc:ID', {}, '1000');
      scheme.ele('cbc:Name', {}, 'IGV');
      scheme.ele('cbc:TaxTypeCode', {}, 'VAT');
    }

    // ── A note names the document it corrects, and why ──────────────────────────────────
    //
    // SUNAT asks for both: `DiscrepancyResponse` carries the reason from catálogo 09 (notas de
    // crédito) or catálogo 10 (notas de débito), and `BillingReference` the referenced document by
    // its series-correlative and its own type. Without them the note is rejected — the builder
    // wrote neither (audit FAC-INV-05 / MP-10).
    if (input.modifies) {
      const modifiedNumber = requiredNumber(input.modifies);
      const discrepancy = root.ele('cac:DiscrepancyResponse');
      discrepancy.ele('cbc:ReferenceID', {}, modifiedNumber);
      discrepancy.ele(
        'cbc:ResponseCode',
        { listAgencyName: 'PE:SUNAT', listName: document.reasonList ?? '' },
        requiredReasonCode(input.modifies, invoice.adjustmentReason ?? 'OTHER'),
      );
      discrepancy.ele('cbc:Description', {}, input.modifies.reasonText ?? '');

      const reference = root.ele('cac:BillingReference').ele('cac:InvoiceDocumentReference');
      reference.ele('cbc:ID', {}, modifiedNumber);
      // Catálogo 01: the type of the document being corrected, as it was issued.
      if (input.modifies.documentType) {
        reference.ele(
          'cbc:DocumentTypeCode',
          { listAgencyName: 'PE:SUNAT', listName: 'Tipo de Documento', listURI: 'urn:pe:gob:sunat:cpe:see:gem:catalogos:catalogo01' },
          input.modifies.documentType,
        );
      }
    }

    const monetary = root.ele('cac:LegalMonetaryTotal');
    monetary.ele('cbc:LineExtensionAmount', { currencyID: currency }, amount(invoice.subtotal));
    monetary.ele('cbc:TaxInclusiveAmount', { currencyID: currency }, amount(invoice.total));
    monetary.ele('cbc:PayableAmount', { currencyID: currency }, amount(invoice.total));

    const lineTag = document.line;
    const quantityTag = document.quantity;

    for (const [index, line] of (invoice.lineItems ?? []).entries()) {
      const node = root.ele(lineTag);
      node.ele('cbc:ID', {}, String(index + 1));
      node.ele(quantityTag, { unitCode: line.fiscalCodes?.['unitCode'] ?? 'NIU' }, String(line.quantity));
      node.ele('cbc:LineExtensionAmount', { currencyID: currency }, amount(line.lineSubtotal ?? 0));

      // The reference price, which SUNAT requires alongside the net one: `01` is the value of the
      // operation, and it is the unit price with tax included.
      const pricing = node.ele('cac:PricingReference').ele('cac:AlternativeConditionPrice');
      pricing.ele('cbc:PriceAmount', { currencyID: currency }, amount(this.grossUnitPrice(line)));
      pricing.ele('cbc:PriceTypeCode', {}, '01');

      const lineTax = roundToCurrency(line.taxAmount ?? 0, currency);
      const taxTotal = node.ele('cac:TaxTotal');
      taxTotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(lineTax));
      const lineSubtotal = taxTotal.ele('cac:TaxSubtotal');
      lineSubtotal.ele('cbc:TaxableAmount', { currencyID: currency }, amount(line.taxableBase ?? line.lineSubtotal ?? 0));
      lineSubtotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(lineTax));
      const category = lineSubtotal.ele('cac:TaxCategory');
      category.ele('cbc:Percent', {}, (Number(line.taxRate ?? 0) * 100).toFixed(2));
      // Catálogo 07: `10` gravado — operación onerosa. A line that is exonerated or unaffected
      // carries `20` or `30`, and that is a property of what is sold, so it comes from the product.
      category.ele('cbc:TaxExemptionReasonCode', {}, line.fiscalCodes?.['afectacionIgv'] ?? '10');
      const lineScheme = category.ele('cac:TaxScheme');
      lineScheme.ele('cbc:ID', {}, '1000');
      lineScheme.ele('cbc:Name', {}, 'IGV');
      lineScheme.ele('cbc:TaxTypeCode', {}, 'VAT');

      const item = node.ele('cac:Item');
      item.ele('cbc:Description', {}, line.description ?? '');
      const code = line.fiscalCodes?.['codigoProducto'];
      if (code) item.ele('cac:SellersItemIdentification').ele('cbc:ID', {}, code);

      node.ele('cac:Price').ele('cbc:PriceAmount', { currencyID: currency }, amount(line.price ?? 0));
    }

    return {
      xml: root.end({ pretty: false }),
      // The name every subsequent exchange uses, and the name inside the ZIP.
      documentName: `${ruc}-${documentType}-${input.series}-${correlative}`,
    };
  }

  private party(
    node: xmlbuilder.XMLElement,
    name: string,
    documentNumber: string,
    documentType: string,
  ): void {
    const party = node.ele('cac:Party');
    party
      .ele('cac:PartyIdentification')
      .ele('cbc:ID', { schemeID: documentType, schemeName: 'Documento de Identidad' }, documentNumber);
    party.ele('cac:PartyLegalEntity').ele('cbc:RegistrationName', {}, name);
  }

  /**
   * Catálogo 06: `6` RUC, `1` DNI, `0` when the buyer stated none.
   *
   * Read from the catalogue the customer was recorded with, not inferred from the number's length
   * (A-02): an 8-digit value is a DNI because the customer holds a DNI, not because it is 8 digits.
   */
  private customerDocumentType(customer: Customer): string {
    return buyerRegimeDocumentCode('sunat', customer, 'PE') ?? '0';
  }

  /**
   * Catálogo 01: `01` factura, `03` boleta, `07` nota de crédito — the comprobantes this builder
   * writes — as the document was numbered by the market's own rule, recorded at issuance and never
   * decided again here.
   *
   * Its series must agree: SUNAT rejects an `F` series declared as a boleta before it reads the
   * document. The range's series was checked against its type when the range was registered
   * (`MarketNumbering.acceptsSeries`); this is the same rule, refused by name if the two ever drift.
   */
  documentType(input: Pick<SunatBuildInput, 'invoice' | 'series'>): string {
    const type = issuedDocumentType(input.invoice, ['01', '03', '07', '08']);
    const letter = input.series.toUpperCase().charAt(0);
    if ((type === '01' && letter !== 'F') || (type === '03' && letter !== 'B')) {
      throw new BadRequestError('einvoicing.pe.series_contradicts_document_type', { series: input.series, type });
    }
    return type;
  }


  /** SUNAT numbers correlatives without the series and without leading zeros stripped. */
  private correlative(invoiceNumber: string): string {
    const digits = invoiceNumber.replace(/\D/g, '');
    return (digits || '1').padStart(8, '0');
  }

  /** Unit price with tax included, which the `PricingReference` states. */
  private grossUnitPrice(line: {
    price?: number;
    quantity?: number;
    lineSubtotal?: number;
    taxAmount?: number;
  }): number {
    const quantity = Number(line.quantity ?? 0);
    if (quantity === 0) return Number(line.price ?? 0);
    return (Number(line.lineSubtotal ?? 0) + Number(line.taxAmount ?? 0)) / quantity;
  }

  private assertIssuable(input: SunatBuildInput): void {
    if (!(input.organization.taxId ?? '').replace(/\D/g, '')) {
      throw new BadRequestError('einvoicing.pe.organization_has_no_ruc_sunat_does');
    }
    if (!input.series?.trim()) throw new BadRequestError('einvoicing.pe.document_series_missing_f001_example');
  }

  private date(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    return iso.slice(0, 10);
  }
}


const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const UBL_CREDIT_NOTE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2';
const UBL_DEBIT_NOTE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:DebitNote-2';
const CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const EXT_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';

/**
 * Each SUNAT document as UBL names it, and which reason catalogue its notes use.
 *
 * *Verificar con contabilidad/legal*: catálogo 09 (notas de crédito) and catálogo 10 (notas de
 * débito) are SUNAT's, revised by resolution; `markets/pe/documents.ts` declares the code for each
 * reason and that mapping is what to confirm before filing.
 */
const DOCUMENTS: Readonly<
  Record<string, { root: string; ns: string; line: string; quantity: string; isNote: boolean; reasonList?: string }>
> = {
  '01': { root: 'Invoice', ns: UBL_INVOICE_NS, line: 'cac:InvoiceLine', quantity: 'cbc:InvoicedQuantity', isNote: false },
  '03': { root: 'Invoice', ns: UBL_INVOICE_NS, line: 'cac:InvoiceLine', quantity: 'cbc:InvoicedQuantity', isNote: false },
  '07': { root: 'CreditNote', ns: UBL_CREDIT_NOTE_NS, line: 'cac:CreditNoteLine', quantity: 'cbc:CreditedQuantity', isNote: true, reasonList: 'Tipo de nota de credito' },
  '08': { root: 'DebitNote', ns: UBL_DEBIT_NOTE_NS, line: 'cac:DebitNoteLine', quantity: 'cbc:DebitedQuantity', isNote: true, reasonList: 'Tipo de nota de debito' },
};

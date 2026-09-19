import * as crypto from 'crypto';
import * as xmlbuilder from 'xmlbuilder';
import { Invoice, InvoiceType } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';
import { fiscalNumber } from '../fiscal-number';
import { buyerRegimeDocumentCode } from '../buyer-document';
import { regimeDocumentCode } from '../../../localization/fiscal/identity-document-catalogue';
import { TaxpayerKind } from '../../../localization/fiscal/tax-id-validators';
import { TaxpayerType } from '../../../localization/fiscal/withholding-regimes';

/**
 * Colombia — factura electrónica DIAN, UBL 2.1.
 *
 * ## The CUFE
 *
 * The *Código Único de Factura Electrónica* is what makes a Colombian invoice identifiable: a
 * SHA-384 over a fixed concatenation of the invoice's own fields and the taxpayer's technical key,
 * which the DIAN recomputes and compares. It is not a random identifier and it is not assigned by
 * the authority — the issuer computes it, and an invoice whose CUFE does not reproduce is rejected
 * regardless of how correct the rest of it is.
 *
 * The concatenation below follows the DIAN's technical annex: number, date, time, subtotal, three
 * tax codes with their bases and values, total, issuer NIT, receiver document, technical key and
 * environment.
 *
 * *Verificar con contabilidad/legal*: the DIAN revises the annex (this follows 1.8), and the
 * `ClaveTecnica` is issued per resolution and per taxpayer — it is configuration, never a constant.
 * Before filing, the CUFE this produces must be checked against the DIAN's own validator for one
 * document; a CUFE computed over a stale field order fails validation with a message about the
 * CUFE and nothing else.
 *
 * ## Numbering
 *
 * A Colombian invoice number is not free: the DIAN authorises a prefix and a numeric range by
 * resolution, and the document carries the resolution number and the range it was drawn from. That
 * lives with the fiscal numbering the product already does for the Dominican NCF, which is the
 * same shape of problem.
 */
export interface DianBuildInput {
  invoice: Invoice;
  organization: Organization;
  customer: Customer;
  /** Issued with the invoicing resolution; secret, and per taxpayer. */
  technicalKey: string;
  /** `1` producción, `2` pruebas. The CUFE differs between them, deliberately. */
  environment: '1' | '2';
  /** The authorising resolution, which the document must carry. */
  resolution: { number: string; prefix: string; from: string; to: string; validUntil: string };
}

export class DianBuilder {
  /** The CUFE, and the UBL document that carries it. */
  build(input: DianBuildInput): { xml: string; cufe: string } {
    this.assertIssuable(input);
    const cufe = this.cufe(input);
    return { xml: this.ubl(input, cufe), cufe };
  }

  /**
   * The DIAN's document-type code.
   *
   * `01` factura de venta nacional, `91` nota crédito. Public because the numbering adapter draws
   * the number from the range authorised for this type and has to reach the same answer the
   * builder does — a note numbered from the invoice range is rejected on the resolution, not on
   * the document.
   */
  documentType(invoice: Invoice): string {
    return invoice.type === InvoiceType.CREDIT_NOTE ? '91' : '01';
  }

  /**
   * `SHA-384(NumFac + FecFac + HorFac + ValFac + CodImp1 + ValImp1 + CodImp2 + ValImp2 +
   * CodImp3 + ValImp3 + ValTot + NitOFE + NumAdq + ClTec + TipoAmb)`.
   *
   * The three tax slots are fixed: `01` IVA, `04` INC, `03` ICA, each with its accumulated value,
   * and a tax the invoice does not bear contributes `0.00` rather than being omitted. Omitting it
   * shifts every following field and produces a different hash — which is why they are written out
   * explicitly here rather than assembled from whatever taxes happen to be present.
   */
  cufe(input: DianBuildInput): string {
    const { invoice } = input;
    const currency = invoice.currencyCode ?? 'COP';
    const amount = (value: number) => roundToCurrency(value, currency).toFixed(2);

    const parts = [
      // NumFac is the AUTHORISED number, not the internal one: the DIAN recomputes the CUFE from
      // the number it granted, and a CUFE over `FAC-1` reproduces nothing.
      fiscalNumber(invoice),
      this.date(invoice.issueDate),
      this.time(invoice.issueDate),
      amount(invoice.subtotal),
      '01',
      amount(invoice.tax ?? 0),
      '04',
      amount(invoice.excise ?? 0),
      '03',
      // ICA is municipal and withheld rather than charged on the document; zero unless the tenant
      // has configured a regime that charges it, which the withholding resolver decides.
      amount(0),
      amount(invoice.total),
      (input.organization.taxId ?? '').replace(/\D/g, ''),
      (input.customer.taxId ?? '').replace(/\D/g, ''),
      input.technicalKey,
      input.environment,
    ];

    return crypto.createHash('sha384').update(parts.join(''), 'utf8').digest('hex');
  }

  private ubl(input: DianBuildInput, cufe: string): string {
    const { invoice, organization, customer } = input;
    const currency = invoice.currencyCode ?? 'COP';
    const amount = (value: number) => roundToCurrency(value, currency).toFixed(2);

    const root = xmlbuilder
      .create('Invoice', { encoding: 'UTF-8' })
      .att('xmlns', UBL_INVOICE_NS)
      .att('xmlns:cac', CAC_NS)
      .att('xmlns:cbc', CBC_NS)
      .att('xmlns:ext', EXT_NS);

    // The DIAN's own extensions ride here: `DianExtensions` carries the software provider's
    // signature and the authorisation, and `UBLExtension` is where the XAdES signature is placed.
    const extensions = root.ele('ext:UBLExtensions');
    const dian = extensions.ele('ext:UBLExtension').ele('ext:ExtensionContent').ele('sts:DianExtensions', {
      'xmlns:sts': STS_NS,
    });
    const control = dian.ele('sts:InvoiceControl');
    control.ele('sts:InvoiceAuthorization', {}, input.resolution.number);
    const authPeriod = control.ele('sts:AuthorizationPeriod');
    authPeriod.ele('cbc:EndDate', {}, input.resolution.validUntil);
    const range = control.ele('sts:AuthorizedInvoices');
    range.ele('sts:Prefix', {}, input.resolution.prefix);
    range.ele('sts:From', {}, input.resolution.from);
    range.ele('sts:To', {}, input.resolution.to);
    dian.ele('sts:InvoiceSource').ele('cbc:IdentificationCode', { listAgencyID: '6' }, 'CO');
    // The placeholder the signature is appended into; empty until `seal` runs.
    extensions.ele('ext:UBLExtension').ele('ext:ExtensionContent');

    root.ele('cbc:UBLVersionID', {}, '2.1');
    root.ele('cbc:CustomizationID', {}, '10');
    root.ele('cbc:ProfileID', {}, 'DIAN 2.1');
    root.ele('cbc:ProfileExecutionID', {}, input.environment);
    root.ele('cbc:ID', {}, fiscalNumber(invoice));
    root.ele('cbc:UUID', { schemeName: 'CUFE-SHA384' }, cufe);
    root.ele('cbc:IssueDate', {}, this.date(invoice.issueDate));
    root.ele('cbc:IssueTime', {}, this.time(invoice.issueDate));
    // `01` factura de venta nacional; `91` nota crédito.
    root.ele('cbc:InvoiceTypeCode', {}, this.documentType(invoice));
    root.ele('cbc:DocumentCurrencyCode', {}, currency);
    root.ele('cbc:LineCountNumeric', {}, String((invoice.lineItems ?? []).length));

    // Both the document type (`schemeName`) and the persona jurídica/natural axis
    // (`AdditionalAccountID`) come from the catalogue and the recorded buyer, never a constant.
    // Hardcoding `'31'` (NIT) and `'2'` (persona natural) declared every buyer a company's
    // identifier AND a natural person at once, and split a real digit off any number that was not a
    // NIT (H-06/A-02). The issuer of a Colombian factura electrónica is a NIT-registered obligado,
    // so the supplier's type is the country's company invoicing document, still read from the
    // catalogue rather than written as `'31'`.
    const country = organization.country ?? 'CO';
    const supplierScheme =
      regimeDocumentCode('dian', { countryCode: country, kind: TaxpayerKind.COMPANY }) ?? '31';
    this.party(root.ele('cac:AccountingSupplierParty'), organization.legalName, organization.taxId, '1', supplierScheme);

    const buyerScheme = buyerRegimeDocumentCode('dian', customer, country) ?? '31';
    this.party(
      root.ele('cac:AccountingCustomerParty'),
      customer.companyName,
      customer.taxId,
      this.buyerAccountType(customer, buyerScheme),
      buyerScheme,
    );

    if (roundToCurrency(invoice.tax ?? 0, currency) > 0) {
      const taxTotal = root.ele('cac:TaxTotal');
      taxTotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(invoice.tax ?? 0));
      const subtotal = taxTotal.ele('cac:TaxSubtotal');
      subtotal.ele('cbc:TaxableAmount', { currencyID: currency }, amount(invoice.taxedTotal ?? invoice.subtotal));
      subtotal.ele('cbc:TaxAmount', { currencyID: currency }, amount(invoice.tax ?? 0));
      const category = subtotal.ele('cac:TaxCategory');
      category.ele('cbc:Percent', {}, this.headlineRate(invoice));
      category.ele('cac:TaxScheme').ele('cbc:ID', {}, '01').up().ele('cbc:Name', {}, 'IVA');
    }

    const monetary = root.ele('cac:LegalMonetaryTotal');
    monetary.ele('cbc:LineExtensionAmount', { currencyID: currency }, amount(invoice.subtotal));
    monetary.ele('cbc:TaxExclusiveAmount', { currencyID: currency }, amount(invoice.taxedTotal ?? invoice.subtotal));
    monetary.ele('cbc:TaxInclusiveAmount', { currencyID: currency }, amount(invoice.total));
    monetary.ele('cbc:PayableAmount', { currencyID: currency }, amount(invoice.total));

    for (const [index, line] of (invoice.lineItems ?? []).entries()) {
      const invoiceLine = root.ele('cac:InvoiceLine');
      invoiceLine.ele('cbc:ID', {}, String(index + 1));
      invoiceLine.ele('cbc:InvoicedQuantity', { unitCode: this.unitOf(line) }, String(line.quantity));
      invoiceLine.ele('cbc:LineExtensionAmount', { currencyID: currency }, amount(line.lineSubtotal ?? 0));
      const item = invoiceLine.ele('cac:Item');
      item.ele('cbc:Description', {}, line.description ?? '');
      // UNSPSC — the DIAN's `listID="001"`. From the product's own catalogue values, never guessed.
      const code = line.fiscalCodes?.['unspsc'];
      if (code) item.ele('cac:StandardItemIdentification').ele('cbc:ID', { schemeID: '999' }, code);
      invoiceLine
        .ele('cac:Price')
        .ele('cbc:PriceAmount', { currencyID: currency }, amount(line.price ?? 0));
    }

    return root.end({ pretty: false });
  }

  private party(
    node: xmlbuilder.XMLElement,
    name: string,
    taxId: string | null | undefined,
    accountType: '1' | '2',
    documentType: string,
  ): void {
    // `1` persona jurídica, `2` persona natural — the party's kind, not a constant.
    node.ele('cbc:AdditionalAccountID', {}, accountType);
    const party = node.ele('cac:Party');
    party.ele('cac:PartyName').ele('cbc:Name', {}, name);
    const legal = party.ele('cac:PartyTaxScheme');
    legal.ele('cbc:RegistrationName', {}, name);
    // Only the NIT (`31`) carries a verification digit that Colombia writes as its own attribute;
    // splitting the last digit off a cédula (`13`) or an alphanumeric passport removes a character
    // of the number itself. The document type is the one the party was recorded with, never assumed
    // to be a NIT. *Verificar con contabilidad/legal*: the DIAN's schemeID for a document without a
    // DV — a cédula, a passport — is sent here as `0` pending confirmation of the annex's value.
    const raw = (taxId ?? '').trim();
    const isNit = documentType === '31';
    legal.ele(
      'cbc:CompanyID',
      { schemeID: isNit ? this.checkDigit(taxId) : '0', schemeName: documentType },
      isNit ? raw.replace(/\D/g, '').slice(0, -1) || raw : raw,
    );
    legal.ele('cac:TaxScheme').ele('cbc:ID', {}, '01').up().ele('cbc:Name', {}, 'IVA');
  }

  /**
   * `1` persona jurídica, `2` persona natural — from the buyer's recorded taxpayer kind.
   *
   * When the kind was never recorded (a legacy customer), it is inferred from the resolved document:
   * a NIT is a company's identifier, a cédula or passport a natural person's. That inference is only
   * the last resort; the recorded kind wins.
   */
  private buyerAccountType(customer: Customer, documentType: string): '1' | '2' {
    if (customer.taxpayerType === TaxpayerType.INDIVIDUAL) return '2';
    if (customer.taxpayerType) return '1';
    return documentType === '31' ? '1' : '2';
  }

  /** The NIT's verification digit, which Colombia writes as its own attribute. */
  private checkDigit(taxId: string | null | undefined): string {
    const digits = (taxId ?? '').replace(/\D/g, '');
    return digits.slice(-1);
  }

  private assertIssuable(input: DianBuildInput): void {
    if (!input.organization.taxId?.trim()) throw new BadRequestError('einvoicing.co.organization_has_no_nit_electronic_invoice');
    if (!input.customer.taxId?.trim()) {
      throw new BadRequestError('einvoicing.co.customer_customer_has_no_identification_document', {
        customer: input.customer.companyName,
      });
    }
    if (!input.technicalKey?.trim()) throw new BadRequestError('einvoicing.co.invoicing_resolution_technical_key_missing_cufe');
    if (!input.resolution?.number?.trim()) {
      throw new BadRequestError('einvoicing.co.dian_invoicing_resolution_with_prefix_authorised');
    }
  }

  private headlineRate(invoice: Invoice): string {
    const rates = new Set(
      (invoice.lineItems ?? [])
        .filter((line) => Number(line.taxAmount ?? 0) > 0)
        .map((line) => Number(line.taxRate ?? 0) * 100),
    );
    const [first] = [...rates];
    return (first ?? 0).toFixed(2);
  }

  /** UN/ECE unit code. `94` unidad is the DIAN's default for an item with none stated. */
  private unitOf(line: { fiscalCodes?: Record<string, string> | null }): string {
    return line.fiscalCodes?.['unitCode'] ?? '94';
  }

  private date(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    return iso.slice(0, 10);
  }

  /** `hh:mm:ss-05:00` — Colombia is UTC−5 all year, with no daylight saving. */
  private time(value: Date | string): string {
    const iso = typeof value === 'string' ? value : value.toISOString();
    const time = iso.length > 10 ? iso.slice(11, 19) : '12:00:00';
    return `${time}-05:00`;
  }
}

const UBL_INVOICE_NS = 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2';
const CAC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2';
const CBC_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2';
const EXT_NS = 'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2';
const STS_NS = 'dian:gov:co:facturaelectronica:Structures-2-1';

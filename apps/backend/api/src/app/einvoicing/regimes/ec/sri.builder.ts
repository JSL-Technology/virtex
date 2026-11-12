import * as xmlbuilder from 'xmlbuilder';
import { Invoice } from '../../../invoices/entities/invoice.entity';
import { Organization } from '../../../organizations/entities/organization.entity';
import { Customer } from '../../../customers/entities/customer.entity';
import { roundToCurrency } from '../../../common/money';
import { BadRequestError } from '../../../i18n/localized.exception';
import { fiscalConsecutive, issuedDocumentType } from '../fiscal-number';
import { buyerRegimeDocumentCode } from '../buyer-document';
import { ModifiedDocumentReference, requiredNumber } from '../modified-document';

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
  /** Set on a nota de crédito/débito: the comprobante it modifies, which the SRI requires by name. */
  modifies?: ModifiedDocumentReference | null;
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

    // A nota de crédito and a nota de débito are comprobantes in their own right: their own root,
    // their own info block, their own version, and their own fields for the document they modify.
    // Both were written as a `factura`, so the SRI had nothing to tie the correction to, and the
    // taxpayer had no way to prove which invoice a credit belonged to (FAC-INV-05 / MP-10).
    const type = this.documentType(invoice);
    const document = DOCUMENTS[type] ?? DOCUMENTS['01'];

    const root = xmlbuilder
      .create(document.root, { encoding: 'UTF-8' })
      .att('id', 'comprobante')
      .att('version', document.version);

    const info = root.ele('infoTributaria');
    info.ele('ambiente', {}, input.environment);
    info.ele('tipoEmision', {}, '1');
    info.ele('razonSocial', {}, organization.legalName);
    info.ele('ruc', {}, (organization.taxId ?? '').replace(/\D/g, ''));
    info.ele('claveAcceso', {}, accessKey);
    info.ele('codDoc', {}, type);
    info.ele('estab', {}, input.establishment);
    info.ele('ptoEmi', {}, input.emissionPoint);
    info.ele('secuencial', {}, this.sequential(fiscalConsecutive(invoice)));
    info.ele('dirMatriz', {}, organization.address ?? '');

    const head = root.ele(document.info);
    head.ele('fechaEmision', {}, this.ddmmyyyySlashed(invoice.issueDate));
    // The SRI orders this field differently in each comprobante: in a factura it precedes the
    // buyer, in a note it follows them. The order is the schema, so writing it in one place for all
    // three is a rejection on the two it does not fit.
    if (document.kind === 'INVOICE') head.ele('obligadoContabilidad', {}, 'SI');
    this.buyer(head, customer);
    if (document.kind !== 'INVOICE') {
      head.ele('obligadoContabilidad', {}, 'SI');

      // ── What the note modifies, which the SRI asks for by name ─────────────────────────
      //
      // The type, the number and the date of the comprobante being corrected, all three mandatory.
      const modifies = this.requireModified(input);
      head.ele('codDocModificado', {}, modifies.documentType ?? '01');
      head.ele('numDocModificado', {}, requiredNumber(modifies));
      head.ele('fechaEmisionDocSustento', {}, this.ddmmyyyySlashed(modifies.issueDate));
    }

    head.ele('totalSinImpuestos', {}, amount(invoice.subtotal));

    if (document.kind === 'INVOICE') {
      head.ele('totalDescuento', {}, amount(invoice.discountTotal ?? 0));
      this.taxTotals(head.ele('totalConImpuestos'), 'totalImpuesto', invoice, amount);
      head.ele('propina', {}, amount(invoice.serviceCharge ?? 0));
      head.ele('importeTotal', {}, amount(invoice.total));
      head.ele('moneda', {}, 'DOLAR');
    } else if (document.kind === 'CREDIT_NOTE') {
      head.ele('valorModificacion', {}, amount(invoice.total));
      head.ele('moneda', {}, 'DOLAR');
      this.taxTotals(head.ele('totalConImpuestos'), 'totalImpuesto', invoice, amount);
      // The motivo in words. The SRI publishes no catalogue of correction concepts — it asks why
      // in a sentence — so the note carries what the issuer wrote and nothing is invented for them
      // when they wrote nothing (the field is optional, and inventing a reason is worse than none).
      const reason = this.reasonText(input);
      if (reason) head.ele('motivo', {}, reason);
    } else {
      // A nota de débito states its taxes under `impuestos`, with the rate, and its total as
      // `valorTotal`. Neither element exists in the other two comprobantes.
      this.taxTotals(head.ele('impuestos'), 'impuesto', invoice, amount);
      head.ele('valorTotal', {}, amount(invoice.total));
    }

    if (document.kind === 'DEBIT_NOTE') {
      // A nota de débito has no `detalles`: what it charges for is stated as motivos, each with
      // its own amount. *Verificar con contabilidad/legal*: the block is optional in the ficha
      // técnica, so a note whose issuer wrote no reason carries none rather than an invented one.
      const reason = this.reasonText(input);
      if (reason) {
        const motivo = root.ele('motivos').ele('motivo');
        motivo.ele('razon', {}, reason);
        motivo.ele('valor', {}, amount(invoice.total));
      }
    } else {
      this.details(root, invoice, amount, document.itemCode);
    }

    return root.end({ pretty: false });
  }

  /** Who the comprobante is for: the same three fields, in the same order, in all of them. */
  private buyer(head: xmlbuilder.XMLElement, customer: Customer): void {
    const buyerDocumentType = this.buyerDocumentType(customer);
    head.ele('tipoIdentificacionComprador', {}, buyerDocumentType);
    head.ele('razonSocialComprador', {}, customer.companyName);
    // A passport (`06`) is alphanumeric; only the numeric identifiers (RUC, cédula) are digit-only,
    // so the strip that canonicalises those must not be applied to a passport number.
    head.ele(
      'identificacionComprador',
      {},
      buyerDocumentType === '06'
        ? (customer.taxId ?? '').trim()
        : (customer.taxId ?? '').replace(/\D/g, ''),
    );
  }

  /**
   * The document's tax, under the element name its own comprobante uses.
   *
   * A factura and a nota de crédito total it under `totalConImpuestos/totalImpuesto`; a nota de
   * débito states it under `impuestos/impuesto`, which also carries the rate.
   */
  private taxTotals(
    parent: xmlbuilder.XMLElement,
    entry: 'totalImpuesto' | 'impuesto',
    invoice: Invoice,
    amount: (value: number) => string,
  ): void {
    const tax = parent.ele(entry);
    // Código `2` IVA; codigoPorcentaje `4` es 15 %, `2` 12 %, `0` 0 %.
    tax.ele('codigo', {}, '2');
    tax.ele('codigoPorcentaje', {}, this.ivaCode(invoice));
    if (entry === 'impuesto') tax.ele('tarifa', {}, (this.ivaRate(invoice) * 100).toFixed(2));
    tax.ele('baseImponible', {}, amount(invoice.taxedTotal ?? invoice.subtotal));
    tax.ele('valor', {}, amount(invoice.tax ?? 0));
  }

  /** The lines, with the item-code element the comprobante's own version names. */
  private details(
    root: xmlbuilder.XMLElement,
    invoice: Invoice,
    amount: (value: number) => string,
    itemCode: string,
  ): void {
    const detalles = root.ele('detalles');
    for (const line of invoice.lineItems ?? []) {
      const detalle = detalles.ele('detalle');
      detalle.ele(itemCode, {}, line.fiscalCodes?.['codigoPrincipal'] ?? '');
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
  }

  /** What the issuer wrote on the note, trimmed to the length the SRI accepts. */
  private reasonText(input: SriBuildInput): string {
    return (input.modifies?.reasonText ?? '').trim().slice(0, 300);
  }

  /**
   * The root element of the comprobante this invoice becomes.
   *
   * The signature is appended inside it, and a nota de crédito's root is not `factura`: signing
   * one as though it were appends the `<Signature>` nowhere and the SRI refuses an unsigned
   * comprobante.
   */
  rootElement(invoice: Invoice): string {
    return (DOCUMENTS[this.documentType(invoice)] ?? DOCUMENTS['01']).root;
  }

  /** A note must name what it modifies: the SRI refuses one that does not, and so does this. */
  private requireModified(input: SriBuildInput): ModifiedDocumentReference {
    if (!input.modifies) {
      throw new BadRequestError('einvoicing.note_must_name_the_document_it_modifies', {
        document: input.invoice.invoiceNumber ?? '',
      });
    }
    return input.modifies;
  }

  /** `01` factura, `04` nota de crédito, `05` nota de débito. */
  /**
   * The authority's type the document was numbered as — recorded at issuance by the market's own
   * rule (`markets/<cc>/documents.ts`), never decided again here: two copies of the rule is how a
   * document ends up numbered from one range and built as another type.
   */
  documentType(invoice: Invoice): string {
    return issuedDocumentType(invoice, ['01', '04', '05']);
  }

  /**
   * The SRI's tipo de identificación for the buyer: `04` RUC, `05` cédula, `06` pasaporte — read
   * from the document the customer was recorded with, not inferred from the number's length (A-02).
   *
   * `07` consumidor final is reserved for the ABSENCE of a document, not for "the length matched
   * nothing": counting digits declared a passport holder a consumidor final and collided a mistyped
   * RUC with a real cédula. When neither a document type nor a taxpayer kind is known, the sale is
   * an unidentified final consumer, which is what `07` means.
   */
  private buyerDocumentType(customer: Customer): string {
    return buyerRegimeDocumentCode('sri', customer, 'EC') ?? '07';
  }

  /** The SRI's `codigoPorcentaje` for the document's predominant rate. */
  private ivaCode(invoice: Invoice): string {
    return this.ivaCodeForRate(this.ivaRate(invoice));
  }

  /** The rate the document's tax was computed at, as the nota de débito states it. */
  private ivaRate(invoice: Invoice): number {
    const rates = (invoice.lineItems ?? [])
      .filter((line) => Number(line.taxAmount ?? 0) > 0)
      .map((line) => Number(line.taxRate ?? 0));
    return rates[0] ?? 0;
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
      throw new BadRequestError('einvoicing.ec.organization_has_no_ruc_sri_does');
    }
    if (!input.establishment?.trim() || !input.emissionPoint?.trim()) {
      throw new BadRequestError('einvoicing.ec.sri_establishment_point_issue_missing');
    }
  }
}

/**
 * Each SRI comprobante, as its own ficha técnica defines it.
 *
 * The three are not one document with a different code in `codDoc`: the root element, the info
 * block, the schema version and even the element that carries an item's code differ, and a note
 * additionally carries the comprobante it modifies. Writing all three as a `factura` is how a
 * credit note went out with no reference to the invoice it credited.
 *
 * *Verificar con contabilidad/legal*: the SRI publishes a ficha técnica per comprobante, and these
 * are the versions and element names they fix. `codDocModificado`, `numDocModificado` and
 * `fechaEmisionDocSustento` are mandatory in both notes; the motivo is not.
 */
const DOCUMENTS: Readonly<
  Record<
    string,
    {
      root: string;
      info: string;
      version: string;
      kind: 'INVOICE' | 'CREDIT_NOTE' | 'DEBIT_NOTE';
      /** `codigoPrincipal` in the factura 2.1.0, `codigoInterno` in the nota de crédito 1.1.0. */
      itemCode: string;
    }
  >
> = {
  '01': { root: 'factura', info: 'infoFactura', version: '2.1.0', kind: 'INVOICE', itemCode: 'codigoPrincipal' },
  '04': { root: 'notaCredito', info: 'infoNotaCredito', version: '1.1.0', kind: 'CREDIT_NOTE', itemCode: 'codigoInterno' },
  // A nota de débito has no `detalles` at all: its `motivos` say what it charges for.
  '05': { root: 'notaDebito', info: 'infoNotaDebito', version: '1.0.0', kind: 'DEBIT_NOTE', itemCode: 'codigoInterno' },
};

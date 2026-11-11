import { Repository, Between, Not, IsNull, In } from 'typeorm';
import { CancellationMode, Invoice, InvoiceStatus, InvoiceType, PaymentMethod } from '../../invoices/entities/invoice.entity';
import { PurchaseFiscalDocument } from '../../contracts/fiscal-records/purchase-fiscal-records.contract';
import { Organization } from '../../organizations/entities/organization.entity';
import { roundAmount } from '../../common/money';
import { UnprocessableEntityError } from '../../i18n/localized.exception';
// The Dominican returns move into the Dominican package with phase 5 of docs/ARQUITECTURA_MERCADOS.md.
import { isValidDominicanTaxId } from '../../markets/do/identity';

/**
 * The Dominican Republic's "formatos de envío": 606 (purchases), 607 (sales), 608 (voided
 * comprobantes) and 609 (payments abroad).
 *
 * ## What these replace
 *
 * The previous implementation emitted six pipe-delimited fields for the 607 and five for the 606.
 * The published formats carry twenty-three boxes each (see `FORMAT_607_BOXES`), and neither had a
 * header line, so what the product produced could not be uploaded to the DGII at all. Worse, the
 * 606 derived the tax borne on a purchase as `total − total / 1.18`, which assumes every purchase
 * is taxable at the standard rate; the code's own comment called it a stopgap. The 608 and 609 did
 * not exist, so a taxpayer using this product could not report a single voided comprobante.
 *
 * ## Conventions, stated once
 *
 * * Fields are pipe-delimited, one record per line, no trailing delimiter.
 * * Dates are `AAAAMMDD`; a period is `AAAAMM`.
 * * Amounts carry two decimals with a dot separator and no thousands separator.
 * * An amount of zero is written as `0.00`; an inapplicable text field is left empty.
 * * The first line is the header the DGII expects for the format.
 *
 * Every figure comes from a stored, document-level field. Nothing is inferred from a total, because
 * a return derived by arithmetic from an inclusive amount is a guess presented as a declaration.
 */
/**
 * A point-of-sale ticket that carries a comprobante fiscal (B02), as the 607 and 608 need it.
 * Read by `ComplianceService` from the tills' journal; amounts are already net of change.
 */
export interface TillFiscalSale {
  fiscalNumber: string;
  /** The sale's date in the company's fiscal time zone, `YYYY-MM-DD`. */
  date: string;
  goods: number;
  services: number;
  tax: number;
  cash: number;
  card: number;
  transfer: number;
  other: number;
  voided: boolean;
  voidReason: string | null;
}

/**
 * «Forma de pago» 06: the DGII reports a supplier's credit note on that column, whatever method
 * paid the bill it corrects. It is the 606's rule, so it lives with the 606 and not on the purchase.
 */
const CREDIT_NOTE_PAYMENT_FORM = '06';

/**
 * What a customer actually withheld from us on an invoice, from its collections (607 boxes 7, 10
 * and 12). The withholding happens when the customer pays — not when we issue — so the amounts and
 * the date come from the receipts that carried it. Before any such receipt nothing has been
 * withheld yet; the return regenerated after it (the DGII's rectification) reports it.
 */
export interface CollectedWithholding {
  tax: number;
  incomeTax: number;
  /** The date of the latest receipt that withheld, `YYYY-MM-DD`. */
  date: string;
}

/**
 * The 607 detail record, box by box, as the DGII publishes it (Norma General 07-2018, "Formato de
 * Envío de Datos 607"). Twenty-three boxes. The previous record had twenty-four: it carried the 606's
 * services/goods split, which the 607 does not have, and lacked box 7, so from box 7 on every amount
 * sat one box to the right of where the DGII reads it.
 */
export const FORMAT_607_BOXES = [
  'RNC/Cédula o Pasaporte',
  'Tipo Identificación',
  'Número Comprobante Fiscal',
  'Número Comprobante Fiscal Modificado',
  'Tipo de Ingreso',
  'Fecha Comprobante',
  'Fecha de Retención',
  'Monto Facturado',
  'ITBIS Facturado',
  'ITBIS Retenido por Terceros',
  'ITBIS Percibido',
  'Retención Renta por Terceros',
  'ISR Percibido',
  'Impuesto Selectivo al Consumo',
  'Otros Impuestos/Tasas',
  'Monto Propina Legal',
  'Efectivo',
  'Cheque/Transferencia/Depósito',
  'Tarjeta Débito/Crédito',
  'Venta a Crédito',
  'Bonos o Certificados de Regalo',
  'Permuta',
  'Otras Formas de Ventas',
] as const;

export class DominicanRepublicReports {
  // ── 607: Ventas de bienes y servicios ──────────────────────────────────────

  /**
   * Sales. One record per issued comprobante in the period, including credit and debit notes.
   *
   * Voided documents are deliberately excluded: an annulled comprobante belongs to the 608 and
   * reporting it as a sale overstates the return. The previous version filtered only on "has an
   * NCF" and therefore reported annulled invoices as sales.
   */
  static async generate607Report(
    organizationId: string,
    year: number,
    month: number,
    invoiceRepository: Repository<Invoice>,
    organization: Organization,
    tillSales: readonly TillFiscalSale[] = [],
    withholdings: ReadonlyMap<string, CollectedWithholding> = new Map(),
  ): Promise<string> {
    const { from, to } = monthBounds(year, month);

    // Every comprobante issued in the month — including an invoice a credit note later reversed in
    // full: it was a sale of its month and its note reports the reversal, so leaving it out (as
    // this did) subtracted the sale twice. Only a comprobante ANNULLED is not a sale; it is the 608's.
    // To confirm with a local accountant.
    const sales = await invoiceRepository.find({
      relations: ['customer'],
      where: [
        {
          organizationId,
          issueDate: Between(from, to),
          fiscalNumber: Not(IsNull()),
          status: Not(In([InvoiceStatus.DRAFT, InvoiceStatus.VOID])),
        },
        {
          organizationId,
          issueDate: Between(from, to),
          fiscalNumber: Not(IsNull()),
          status: InvoiceStatus.VOID,
          cancellationMode: CancellationMode.CREDIT_NOTE,
        },
      ],
      order: { issueDate: 'ASC', invoiceNumber: 'ASC' },
    });

    const modifiedNcfById = await resolveModifiedNcfs(organizationId, sales, invoiceRepository);
    const incomeType = organization.fiscalProfile?.['tipoIngreso'] || '01';

    const rows = sales.map((sale) => {
      const taxId = digitsOnly(sale.customerTaxId ?? sale.customer?.taxId);
      const paymentSplit = splitByPaymentMethod(sale);
      const withheld = withholdings.get(sale.id);

      return record607([
        taxId,
        identificationType(taxId),
        sale.fiscalNumber ?? '',
        sale.originalInvoiceId ? modifiedNcfById.get(sale.originalInvoiceId) ?? '' : '',
        incomeType,
        compactDate(sale.issueDate),
        // 7 — only when something was withheld; the DGII requires it then and refuses it otherwise.
        withheld && (withheld.tax > 0 || withheld.incomeTax > 0) ? compactDate(withheld.date) : '',
        money(sale.subtotal - sale.discountTotal),
        money(sale.tax),
        money(withheld?.tax ?? 0),
        // ITBIS percibido: a perception regime the product does not operate. Zero, not omitted:
        // the record is positional.
        money(0),
        money(withheld?.incomeTax ?? 0),
        money(0),
        money(lineExcise(sale)),
        money(0),
        money(sale.serviceCharge),
        money(paymentSplit.cash),
        money(paymentSplit.transfer),
        money(paymentSplit.card),
        money(paymentSplit.credit),
        money(paymentSplit.giftCard),
        money(paymentSplit.swap),
        money(paymentSplit.other),
      ]);
    });

    // Till tickets with a B02 are consumer comprobantes like any other (QA R3-C02): they were
    // missing, so every sale rung at a till was left out of the return.
    const tillRows = tillSales
      .filter((sale) => !sale.voided)
      .map((sale) =>
        record607([
          '',
          '',
          sale.fiscalNumber,
          '',
          incomeType,
          compactDate(sale.date),
          '',
          money(sale.goods + sale.services),
          money(sale.tax),
          money(0),
          money(0),
          money(0),
          money(0),
          money(0),
          money(0),
          money(0),
          money(sale.cash),
          money(sale.transfer),
          money(sale.card),
          money(0),
          money(0),
          money(0),
          money(sale.other),
        ]),
      );
    rows.push(...tillRows);

    // RNC, period and record count. The previous header carried a fifth field (a total) the
    // published header does not have.
    const header = ['607', digitsOnly(organization.taxId), period(year, month), String(rows.length)].join('|');

    return [header, ...rows].join('\n');
  }

  // ── 606: Compras de bienes y servicios ─────────────────────────────────────

  /**
   * Purchases. One record per supplier comprobante received in the period — the bills, and the
   * credit notes the supplier issued against them — as Purchasing reports them through
   * `PurchaseFiscalRecordsSource`.
   *
   * The credit notes were missing: a supplier's NCF B04 / e-CF 34 reduces the ITBIS the buyer may
   * deduct, and leaving it out of the 606 overstated the tax credit for the month. It is reported
   * as its own record, with the bill's NCF as «NCF modificado» and form of payment 06 (nota de
   * crédito), which is how the DGII pairs the two.
   */
  static generate606Report(
    year: number,
    month: number,
    documents: readonly PurchaseFiscalDocument[],
    organization: Organization,
  ): string {
    // Every line of the 606 identifies the supplier by RNC or cédula, and the DGII rejects the
    // whole file over one that does not (QA B-02: a bill without one was reported anyway). The
    // file is not produced; the documents to correct are named instead. Bills posted from now on
    // cannot reach this point — accounts payable refuses an NCF without a valid supplier id —
    // but bills recorded before that rule still can.
    const unidentified = documents.filter((document) => !isValidDominicanTaxId(document.supplierTaxId ?? ''));
    if (unidentified.length > 0) {
      throw new UnprocessableEntityError('compliance.report_606_supplier_tax_id_missing', {
        count: unidentified.length,
        bills: unidentified
          .slice(0, 10)
          .map((document) => `${document.fiscalNumber} (${document.supplierName ?? '—'})`)
          .join(', '),
      });
    }

    // A credit note modifies a comprobante; without the bill's NCF the record has nothing to
    // point at and the DGII rejects it. Named, like the unidentified suppliers above.
    const unpaired = documents.filter((document) => document.kind === 'credit_note' && !document.modifiedFiscalNumber);
    if (unpaired.length > 0) {
      throw new UnprocessableEntityError('compliance.report_606_credit_note_without_modified_ncf', {
        count: unpaired.length,
        notes: unpaired
          .slice(0, 10)
          .map((document) => `${document.reference} (${document.fiscalNumber})`)
          .join(', '),
      });
    }

    // Every line of the 606 states what was bought, and the DGII rejects the file over one that
    // does not. A purchase used to be filed as `06` (compras de mercancías) when nobody had said
    // what it was, because the column defaulted to it: the file was produced and said something
    // the taxpayer had never stated. The documents to classify are named instead
    // (`PATCH /accounts-payable/:id/fiscal-attributes`).
    const unclassified = documents.filter((document) => !document.fiscalAttributes['purchaseCategory']);
    if (unclassified.length > 0) {
      throw new UnprocessableEntityError('compliance.report_606_purchase_not_classified', {
        count: unclassified.length,
        bills: unclassified
          .slice(0, 10)
          .map((document) => `${document.fiscalNumber ?? document.reference} (${document.supplierName ?? '—'})`)
          .join(', '),
      });
    }

    const rows = documents.map((document) => {
      const taxId = digitsOnly(document.supplierTaxId);
      return [
        taxId,
        identificationType(taxId),
        // The 606's own columns, from what the market asked the purchase to state, by the keys
        // `markets/do/purchases.ts` declares. Checked above: nothing is filed unclassified.
        document.fiscalAttributes['purchaseCategory'],
        document.fiscalNumber ?? '',
        document.modifiedFiscalNumber ?? '',
        compactDate(document.date),
        document.paidOn ? compactDate(document.paidOn) : '',
        money(document.servicesAmount),
        money(document.goodsAmount),
        money(document.servicesAmount + document.goodsAmount),
        money(document.taxAmount),
        money(document.taxWithheld),
        money(document.taxProportional),
        money(document.taxToCost),
        // ITBIS por adelantar: what remains deductible after proportionality and cost allocation.
        // On a credit note, the ITBIS it gives back: the credit the buyer no longer carries.
        money(Math.max(0, document.taxAmount - document.taxProportional - document.taxToCost)),
        money(0),
        document.fiscalAttributes['isrRetentionType'] ?? '',
        money(document.incomeTaxWithheld),
        money(0),
        money(document.exciseAmount),
        money(document.otherTaxes),
        money(document.serviceCharge),
        // «Forma de pago»: the DGII's code for the method that settled it, and `06` for a credit
        // note, which is how the 606 reports one whatever method the bill was paid by.
        (document.kind === 'credit_note' ? CREDIT_NOTE_PAYMENT_FORM : document.paymentFiscalCode) || '01',
      ].join('|');
    });

    const header = [
      '606',
      digitsOnly(organization.taxId),
      period(year, month),
      String(rows.length),
    ].join('|');

    return [header, ...rows].join('\n');
  }

  // ── 608: Comprobantes anulados ─────────────────────────────────────────────

  /**
   * Voided comprobantes. A fiscal number that was assigned and then annulled must be declared, or
   * the DGII sees a gap in the taxpayer's numbering and asks about it.
   */
  static async generate608Report(
    organizationId: string,
    year: number,
    month: number,
    invoiceRepository: Repository<Invoice>,
    organization: Organization,
    tillSales: readonly TillFiscalSale[] = [],
  ): Promise<string> {
    const { from, to } = monthBounds(year, month);

    // Annulled comprobantes only: one a credit note reversed is still a sale (607), and its note is
    // the record of the reversal. `cancellation_mode` null is a document voided before the mode
    // was recorded and not reversed by a note — an annulment, as the 608 always read it.
    const voided = (
      await invoiceRepository.find({
        where: {
          organizationId,
          issueDate: Between(from, to),
          fiscalNumber: Not(IsNull()),
          status: InvoiceStatus.VOID,
        },
        order: { issueDate: 'ASC' },
      })
    ).filter((invoice) => invoice.cancellationMode !== CancellationMode.CREDIT_NOTE);

    const rows = voided.map((invoice) =>
      [
        invoice.fiscalNumber ?? '',
        compactDate(invoice.issueDate),
        // The DGII code chosen when it was annulled (FAC-INV-05); guessed from the reason's words
        // only for a document voided before the code was recorded.
        invoice.cancellationReasonCode ?? annulmentCode(invoice.voidReason),
      ].join('|'),
    );
    // A voided till ticket whose B02 was printed is an annulled comprobante too.
    for (const sale of tillSales.filter((t) => t.voided)) {
      rows.push([sale.fiscalNumber, compactDate(sale.date), annulmentCode(sale.voidReason)].join('|'));
    }

    const header = [
      '608',
      digitsOnly(organization.taxId),
      period(year, month),
      String(rows.length),
    ].join('|');

    return [header, ...rows].join('\n');
  }

  // ── 609: Pagos al exterior ─────────────────────────────────────────────────

  /**
   * Payments to non-resident suppliers, with the income tax withheld at source: the bills of
   * suppliers established outside the Dominican Republic, as Purchasing reports them.
   */
  static generate609Report(
    year: number,
    month: number,
    documents: readonly PurchaseFiscalDocument[],
    organization: Organization,
  ): string {
    const rows = documents.map((document) =>
      [
        (document.supplierName ?? '').trim(),
        // Tipo de renta: fees for services is the ordinary case for a cross-border payment; where
        // the bill declares an ISR retention type, that classification wins.
        document.fiscalAttributes['isrRetentionType'] || '02',
        compactDate(document.date),
        money(document.servicesAmount + document.goodsAmount || document.total),
        money(document.incomeTaxWithheld),
      ].join('|'),
    );

    const header = [
      '609',
      digitsOnly(organization.taxId),
      period(year, month),
      String(rows.length),
    ].join('|');

    return [header, ...rows].join('\n');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the NCF of every comprobante modified by a note in the batch.
 *
 * The 607's "NCF modificado" column must carry the fiscal NUMBER of the document being modified.
 * Credit notes store `originalInvoiceId`, a UUID; emitting that produced a column of primary keys.
 */
async function resolveModifiedNcfs(
  organizationId: string,
  documents: Invoice[],
  invoiceRepository: Repository<Invoice>,
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(
      documents
        .filter((d) => d.type !== InvoiceType.INVOICE && d.originalInvoiceId)
        .map((d) => d.originalInvoiceId as string),
    ),
  );
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const originals = await invoiceRepository.find({
    where: { organizationId, id: In(ids) },
    select: ['id', 'fiscalNumber'],
  });
  for (const original of originals) {
    if (original.fiscalNumber) map.set(original.id, original.fiscalNumber);
  }
  return map;
}

/**
 * The 607 splits the amount invoiced across the payment methods used. The product records one
 * method per document, so the whole amount lands in its column; the positional columns still have
 * to be present and zeroed.
 */
function splitByPaymentMethod(invoice: Invoice): {
  cash: number;
  transfer: number;
  card: number;
  credit: number;
  giftCard: number;
  swap: number;
  other: number;
} {
  const zero = { cash: 0, transfer: 0, card: 0, credit: 0, giftCard: 0, swap: 0, other: 0 };
  const amount = round2(invoice.total);

  switch (invoice.paymentMethod) {
    case PaymentMethod.CASH:
      return { ...zero, cash: amount };
    case PaymentMethod.CHECK:
    case PaymentMethod.BANK_TRANSFER:
      return { ...zero, transfer: amount };
    case PaymentMethod.CREDIT_CARD:
    case PaymentMethod.DEBIT_CARD:
      return { ...zero, card: amount };
    case PaymentMethod.CREDIT:
      return { ...zero, credit: amount };
    case PaymentMethod.GIFT_CARD:
      return { ...zero, giftCard: amount };
    case PaymentMethod.SWAP:
      return { ...zero, swap: amount };
    default:
      return { ...zero, other: amount };
  }
}

/**
 * Excise charged on the document.
 *
 * The document-level figure, not a sum over `lineItems`: the relation is not loaded by the 607's
 * query, so the reduction silently returned 0 for every sale and the `MontoISC` column was always
 * blank. `invoices.excise` is stored by the tax engine and is the same number by construction.
 */
function lineExcise(invoice: Invoice): number {
  return round2(invoice.excise ?? 0);
}

/**
 * DGII "Tipo de Anulación". The product records a free-text reason, so the code is derived from it
 * where it is unambiguous and falls back to 06 (other) rather than guessing.
 */
function annulmentCode(reason: string | null | undefined): string {
  const text = (reason ?? '').toLowerCase();
  if (text.includes('deterioro') || text.includes('impresión') || text.includes('impresion')) return '01';
  if (text.includes('error') && text.includes('impres')) return '02';
  if (text.includes('duplic')) return '03';
  if (text.includes('correcc') || text.includes('información') || text.includes('informacion')) return '04';
  if (text.includes('devol') || text.includes('cancel')) return '05';
  return '06';
}

/** 1 = RNC (9 digits), 2 = Cédula (11 digits), 3 = anything else (passport, foreign id). */
function identificationType(taxId: string): string {
  if (taxId.length === 9) return '1';
  if (taxId.length === 11) return '2';
  return taxId ? '3' : '';
}

function digitsOnly(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '');
}

/** `AAAAMM` for the report period. */
function period(year: number, month: number): string {
  return `${year}${String(month).padStart(2, '0')}`;
}

/** `AAAAMMDD` from a `YYYY-MM-DD` string or a Date. */
function compactDate(value: string | Date): string {
  const iso = value instanceof Date ? value.toISOString().split('T')[0] : String(value).split('T')[0];
  return iso.replace(/-/g, '');
}

function money(value: number): string {
  return round2(value ?? 0).toFixed(2);
}

function round2(value: number): number {
  return roundAmount(Number(value ?? 0));
}

/**
 * First and last day of the month as `YYYY-MM-DD`, computed in UTC.
 *
 * `new Date(year, month - 1, 1)` is local time; `toISOString()` then converts to UTC, so on a
 * server east of Greenwich the first day of the month became the last day of the previous one and
 * the period silently shifted.
 */
function monthBounds(year: number, month: number): { from: string; to: string } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from: from.toISOString().split('T')[0], to: to.toISOString().split('T')[0] };
}

/** One 607 record: refuses to write a line that is not exactly the published twenty-three boxes. */
function record607(boxes: readonly string[]): string {
  if (boxes.length !== FORMAT_607_BOXES.length) {
    throw new Error(`607 record has ${boxes.length} boxes; the format has ${FORMAT_607_BOXES.length}`);
  }
  return boxes.join('|');
}

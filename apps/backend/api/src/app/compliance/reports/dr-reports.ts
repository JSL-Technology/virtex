import { Repository, Between, Not, IsNull, In } from 'typeorm';
import { Invoice, InvoiceStatus, InvoiceType, PaymentMethod } from '../../invoices/entities/invoice.entity';
import { VendorBill, VendorBillStatus } from '../../accounts-payable/entities/vendor-bill.entity';
import { Organization } from '../../organizations/entities/organization.entity';

/**
 * The Dominican Republic's "formatos de envío": 606 (purchases), 607 (sales), 608 (voided
 * comprobantes) and 609 (payments abroad).
 *
 * ## What these replace
 *
 * The previous implementation emitted six pipe-delimited fields for the 607 and five for the 606.
 * The published formats carry twenty-four and twenty-three respectively, and neither file had a
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
  ): Promise<string> {
    const { from, to } = monthBounds(year, month);

    const sales = await invoiceRepository.find({
      relations: ['customer'],
      where: {
        organizationId,
        issueDate: Between(from, to),
        ncfNumber: Not(IsNull()),
        status: Not(In([InvoiceStatus.DRAFT, InvoiceStatus.VOID])),
      },
      order: { issueDate: 'ASC', invoiceNumber: 'ASC' },
    });

    const modifiedNcfById = await resolveModifiedNcfs(organizationId, sales, invoiceRepository);
    const incomeType = organization.fiscalProfile?.['tipoIngreso'] || '01';

    const rows = sales.map((sale) => {
      const taxId = digitsOnly(sale.customerTaxId ?? sale.customer?.taxId);
      const paymentSplit = splitByPaymentMethod(sale);

      return [
        taxId,
        identificationType(taxId),
        sale.ncfNumber ?? '',
        sale.originalInvoiceId ? modifiedNcfById.get(sale.originalInvoiceId) ?? '' : '',
        incomeType,
        compactDate(sale.issueDate),
        money(sale.servicesTotal),
        money(sale.goodsTotal),
        money(sale.subtotal - sale.discountTotal),
        money(sale.tax),
        money(sale.taxWithheld),
        // ITBIS percibido: a perception regime the product does not operate. Reported as zero
        // rather than omitted, because the column is positional.
        money(0),
        money(sale.incomeTaxWithheld),
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
      ].join('|');
    });

    const totalInvoiced = sales.reduce((sum, s) => sum + (s.subtotal - s.discountTotal), 0);
    const header = [
      '607',
      digitsOnly(organization.taxId),
      period(year, month),
      String(rows.length),
      money(totalInvoiced),
    ].join('|');

    return [header, ...rows].join('\n');
  }

  // ── 606: Compras de bienes y servicios ─────────────────────────────────────

  static async generate606Report(
    organizationId: string,
    year: number,
    month: number,
    vendorBillRepository: Repository<VendorBill>,
    organization: Organization,
  ): Promise<string> {
    const { fromDate, toDate } = monthBoundsAsDates(year, month);

    const purchases = await vendorBillRepository.find({
      relations: ['vendor'],
      where: {
        organizationId,
        date: Between(fromDate, toDate),
        ncf: Not(IsNull()),
        status: Not(In([VendorBillStatus.DRAFT, VendorBillStatus.VOID, VendorBillStatus.REJECTED])),
      },
      order: { date: 'ASC' },
    });

    const rows = purchases.map((bill) => {
      const taxId = digitsOnly(bill.vendor?.taxId);
      return [
        taxId,
        identificationType(taxId),
        bill.purchaseCategory || '06',
        bill.ncf ?? '',
        bill.ncfModified ?? '',
        compactDate(bill.date),
        bill.paidAt ? compactDate(bill.paidAt) : '',
        money(bill.servicesAmount),
        money(bill.goodsAmount),
        money(bill.servicesAmount + bill.goodsAmount),
        money(bill.taxAmount),
        money(bill.taxWithheld),
        money(bill.taxProportional),
        money(bill.taxToCost),
        // ITBIS por adelantar: what remains deductible after proportionality and cost allocation.
        money(Math.max(0, bill.taxAmount - bill.taxProportional - bill.taxToCost)),
        money(0),
        bill.isrRetentionType ?? '',
        money(bill.incomeTaxWithheld),
        money(0),
        money(bill.exciseAmount),
        money(bill.otherTaxes),
        money(bill.serviceCharge),
        bill.paymentForm || '01',
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
  ): Promise<string> {
    const { from, to } = monthBounds(year, month);

    const voided = await invoiceRepository.find({
      where: {
        organizationId,
        issueDate: Between(from, to),
        ncfNumber: Not(IsNull()),
        status: InvoiceStatus.VOID,
      },
      order: { issueDate: 'ASC' },
    });

    const rows = voided.map((invoice) =>
      [
        invoice.ncfNumber ?? '',
        compactDate(invoice.issueDate),
        annulmentCode(invoice.voidReason),
      ].join('|'),
    );

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
   * Payments to non-resident suppliers, with the income tax withheld at source. Identified by a
   * supplier whose country is not the Dominican Republic.
   */
  static async generate609Report(
    organizationId: string,
    year: number,
    month: number,
    vendorBillRepository: Repository<VendorBill>,
    organization: Organization,
  ): Promise<string> {
    const { fromDate, toDate } = monthBoundsAsDates(year, month);

    const bills = await vendorBillRepository
      .createQueryBuilder('bill')
      .innerJoinAndSelect('bill.vendor', 'vendor')
      .where('bill.organizationId = :organizationId', { organizationId })
      .andWhere('bill.date BETWEEN :fromDate AND :toDate', { fromDate, toDate })
      .andWhere('bill.status NOT IN (:...excluded)', {
        excluded: [VendorBillStatus.DRAFT, VendorBillStatus.VOID, VendorBillStatus.REJECTED],
      })
      .andWhere("COALESCE(vendor.country, 'DO') <> 'DO'")
      .orderBy('bill.date', 'ASC')
      .getMany();

    const rows = bills.map((bill) =>
      [
        (bill.vendor?.name ?? '').trim(),
        // Tipo de renta: fees for services is the ordinary case for a cross-border payment; where
        // the bill declares an ISR retention type, that classification wins.
        bill.isrRetentionType || '02',
        compactDate(bill.date),
        money(bill.servicesAmount + bill.goodsAmount || bill.total),
        money(bill.incomeTaxWithheld),
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
    select: ['id', 'ncfNumber'],
  });
  for (const original of originals) {
    if (original.ncfNumber) map.set(original.id, original.ncfNumber);
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

/** Excise charged across the document's lines. */
function lineExcise(invoice: Invoice): number {
  return round2((invoice.lineItems ?? []).reduce((sum, line) => sum + (line.exciseAmount ?? 0), 0));
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
  return Math.round((Number(value ?? 0) + Number.EPSILON) * 100) / 100;
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

function monthBoundsAsDates(year: number, month: number): { fromDate: Date; toDate: Date } {
  return {
    fromDate: new Date(Date.UTC(year, month - 1, 1)),
    toDate: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

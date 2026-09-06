import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InvoiceLineItem } from '../invoices/entities/invoice-line-item.entity';
import { Invoice, InvoiceStatus, InvoiceType } from '../invoices/entities/invoice.entity';
import { BadRequestError } from '../i18n/localized.exception';
import { daysBetween, IsoDate, toIsoDate } from '../common/dates';
import { roundAmount, sumAmounts } from '../common/money';

/** One product or one customer, with what it sold and what it cost. */
export interface ProfitabilityRow {
  id: string;
  /** SKU for a product, tax id or code for a customer. Absent for an ad-hoc line. */
  code: string | null;
  name: string;
  unitsSold: number;
  totalRevenue: number;
  totalCost: number;
  grossProfit: number;
  /** Percentage of revenue, or null when nothing was sold. */
  grossMargin: number | null;
}

export interface ProfitabilityReport {
  period: { startDate: IsoDate; endDate: IsoDate };
  currency: string;
  rows: ProfitabilityRow[];
  totals: {
    unitsSold: number;
    totalRevenue: number;
    totalCost: number;
    grossProfit: number;
    grossMargin: number | null;
  };
  /**
   * Lines that earned revenue at no recorded cost, so their margin overstates the truth.
   *
   * Counted rather than hidden: a product sold before its cost was set shows a 100 % margin, and a
   * reader who is not told will act on it.
   */
  linesWithoutCost: number;
}

/** A profitability report may not span more than this. Roughly three fiscal years. */
const MAX_PROFITABILITY_DAYS = 1_150;

/**
 * Gross margin by product and by customer, from the documents that were actually issued.
 *
 * ## What these two reports were
 *
 * Three hardcoded rows each, written into the Angular component as a signal: a `Laptop Pro 15"`
 * that sold 120 units for 191,998.80, an ergonomic wireless mouse, an ultrawide monitor. No HTTP
 * request, no service, no server-side counterpart at all. A tenant opening either screen saw an
 * imaginary company's figures presented as its own, with nothing on the page to suggest otherwise —
 * and margin is the number a business acts on.
 *
 * The data was there the whole time: `invoice_line_items` carries `productId`, `quantity`,
 * `lineSubtotal` and `unitCost`, the last being the cost recorded at the moment of sale, which is
 * exactly what cost of goods sold was posted at.
 *
 * ## Which documents count
 *
 * Issued ones. A draft is a proposal and a void invoice is a document that was withdrawn; counting
 * either inflates revenue with sales that never happened. Credit notes count **negatively**,
 * because a return reverses both the revenue and the cost of the original sale — a report that
 * ignores them shows a margin the business did not earn.
 *
 * ## Which currency
 *
 * The books'. Every figure is taken from the base-currency columns, because a report that adds a
 * peso invoice to a dollar invoice produces a number in no currency at all.
 */
@Injectable()
export class ProfitabilityService {
  constructor(
    @InjectRepository(InvoiceLineItem)
    private readonly lineRepository: Repository<InvoiceLineItem>,
    @InjectRepository(Invoice)
    private readonly invoiceRepository: Repository<Invoice>,
  ) {}

  byProduct(
    organizationId: string,
    range: { startDate: string; endDate: string },
  ): Promise<ProfitabilityReport> {
    return this.build(organizationId, range, 'product');
  }

  byCustomer(
    organizationId: string,
    range: { startDate: string; endDate: string },
  ): Promise<ProfitabilityReport> {
    return this.build(organizationId, range, 'customer');
  }

  private async build(
    organizationId: string,
    range: { startDate: string; endDate: string },
    dimension: 'product' | 'customer',
  ): Promise<ProfitabilityReport> {
    const startDate = toIsoDate(range.startDate);
    const endDate = toIsoDate(range.endDate);
    if (startDate > endDate) {
      throw new BadRequestError('REPORTS.RANGO_FECHAS_INVALIDO');
    }
    if (daysBetween(startDate, endDate) > MAX_PROFITABILITY_DAYS) {
      throw new BadRequestError('REPORTS.RANGO_FECHAS_EXCEDE_LIMITE', {
        days: daysBetween(startDate, endDate),
        max: MAX_PROFITABILITY_DAYS,
      });
    }

    const query = this.lineRepository
      .createQueryBuilder('line')
      .innerJoin('line.invoice', 'invoice')
      .where('invoice.organizationId = :organizationId', { organizationId })
      .andWhere('invoice.issueDate BETWEEN :startDate AND :endDate', { startDate, endDate })
      // Issued documents only. A draft is a proposal; a void invoice was withdrawn.
      .andWhere('invoice.status NOT IN (:...excluded)', {
        excluded: [InvoiceStatus.DRAFT, InvoiceStatus.VOID],
      });

    if (dimension === 'product') {
      query
        .leftJoin('line.product', 'product')
        .select([
          // `line."productId"`, quoted. The column is camelCase, and inside a raw expression
          // TypeORM does not rewrite the property, so PostgreSQL folded it to `productid` and the
          // query failed outright.
          `COALESCE(line."productId"::text, 'sin-producto') AS "id"`,
          'MAX(product.sku) AS "code"',
          'MAX(COALESCE(product.name, line.description)) AS "name"',
        ])
        .groupBy(`COALESCE(line."productId"::text, 'sin-producto')`);
    } else {
      query
        .select([
          // Quoted, for the same reason as `productId` above: a raw expression is passed through
          // verbatim, and PostgreSQL folds an unquoted identifier to lower case.
          `invoice."customer_id"::text AS "id"`,
          `MAX(invoice."customerName") AS "code"`,
          `MAX(invoice."customerName") AS "name"`,
        ])
        .groupBy(`invoice."customer_id"`);
    }

    // The sign follows the document type: a credit note reverses the sale it corrects, in both
    // revenue and cost, so it subtracts from both rather than being excluded or added.
    const sign = `CASE WHEN invoice.type = '${InvoiceType.CREDIT_NOTE}' THEN -1 ELSE 1 END`;
    // Base currency throughout. `line_subtotal` and `unit_cost` are in the document's currency;
    // multiplying by the document's rate is what makes a peso invoice and a dollar invoice
    // addable.
    const inBase = `${sign} * invoice.exchange_rate`;

    const rows = await query
      .addSelect(`SUM(${sign} * line.quantity)`, 'unitsSold')
      .addSelect(`SUM(line.line_subtotal * (${inBase}))`, 'totalRevenue')
      .addSelect(`SUM(COALESCE(line.unit_cost, 0) * line.quantity * (${inBase}))`, 'totalCost')
      // Null **or zero**, on a line that actually earned revenue. `unit_cost` carries a database
      // default of 0 and a not-null transformer, so a line whose cost was never recorded reaches
      // the table as 0 rather than as null — indistinguishable, in the figures, from an item that
      // genuinely cost nothing. Both produce a 100 % margin, and both are the reader's business.
      .addSelect(
        `SUM(CASE WHEN COALESCE(line.unit_cost, 0) = 0 AND line.line_subtotal <> 0 THEN 1 ELSE 0 END)`,
        'linesWithoutCost',
      )
      .getRawMany<{
        id: string;
        code: string | null;
        name: string | null;
        unitsSold: string;
        totalRevenue: string;
        totalCost: string;
        linesWithoutCost: string;
      }>();

    const currency = await this.baseCurrencyOf(organizationId);

    const mapped: ProfitabilityRow[] = rows
      .map((row) => {
        const totalRevenue = roundAmount(Number(row.totalRevenue ?? 0));
        const totalCost = roundAmount(Number(row.totalCost ?? 0));
        const grossProfit = roundAmount(totalRevenue - totalCost);
        return {
          id: row.id,
          code: row.code,
          name: row.name ?? row.id,
          unitsSold: roundAmount(Number(row.unitsSold ?? 0), 6),
          totalRevenue,
          totalCost,
          grossProfit,
          grossMargin:
            totalRevenue === 0 ? null : roundAmount((grossProfit / totalRevenue) * 100, 2),
        };
      })
      // Most profitable first, which is the order the question is asked in.
      .sort((a, b) => b.grossProfit - a.grossProfit);

    const totalRevenue = sumAmounts(mapped.map((row) => row.totalRevenue));
    const totalCost = sumAmounts(mapped.map((row) => row.totalCost));
    const grossProfit = roundAmount(totalRevenue - totalCost);

    return {
      period: { startDate, endDate },
      currency,
      rows: mapped,
      totals: {
        unitsSold: roundAmount(sumAmounts(mapped.map((row) => row.unitsSold)), 6),
        totalRevenue,
        totalCost,
        grossProfit,
        grossMargin: totalRevenue === 0 ? null : roundAmount((grossProfit / totalRevenue) * 100, 2),
      },
      // Reported rather than hidden. A line sold before the product had a cost produces a 100 %
      // margin, and a reader who is not told will act on it.
      linesWithoutCost: rows.reduce((sum, row) => sum + Number(row.linesWithoutCost ?? 0), 0),
    };
  }

  /** The currency every figure in the report is stated in. */
  private async baseCurrencyOf(organizationId: string): Promise<string> {
    const row = await this.invoiceRepository.manager.query<{ base_currency: string }[]>(
      `SELECT "base_currency" FROM "organization_settings" WHERE "organization_id" = $1 LIMIT 1`,
      [organizationId],
    );
    return row[0]?.base_currency ?? 'USD';
  }
}

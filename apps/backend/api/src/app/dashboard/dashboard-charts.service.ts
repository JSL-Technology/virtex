import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AccountType } from '../chart-of-accounts/enums/account-enums';
import { InvoiceStatus } from '../invoices/entities/invoice.entity';
import { roundAmount } from '../common/money';

/** The headline figures of the dashboard, each against a comparable previous period. */
export interface DashboardSummaryDto {
  salesToday: number;
  /** Fractional change against yesterday, or null when yesterday was zero and there is no ratio. */
  salesTodayChange: number | null;
  pendingInvoices: number;
  pendingInvoicesAmount: number;
  lowStockProducts: number;
  outOfStockProducts: number;
  activeCustomers: number;
  /** Fractional change against the start of this month. */
  activeCustomersChange: number | null;
}

/** One month of a trend, keyed by the first day of the month so the client can format it. */
export interface TrendPointDto {
  /** `2026-09-01`. */
  month: string;
  amount: number;
}

export interface BreakdownSliceDto {
  /** The account's or product's own name. Never a translated label: this is data, not chrome. */
  label: string;
  amount: number;
}

export interface InvoiceStatusSliceDto {
  status: string;
  count: number;
  amount: number;
}

export interface LowStockItemDto {
  id: string;
  name: string;
  sku: string | null;
  stock: number;
  reorderLevel: number | null;
}

export type DashboardAlertSeverity = 'critical' | 'warning';

export interface DashboardAlertDto {
  id: string;
  severity: DashboardAlertSeverity;
  /** i18n key; the client writes the sentence in the reader's language. */
  messageKey: string;
  params: Record<string, string | number>;
  route: string;
}

/**
 * The dashboard's charts, from the tenant's own ledger and documents.
 *
 * ## What these replace
 *
 * Every series on the dashboard was a literal in the browser bundle. Sales were
 * `[5200, 7500, 6800, 9100, 8800, 12500, 11300]` over `Ene…Jul`; operating expenses were
 * "Nómina y Salarios 45 %, Marketing 25 %…"; the low-stock panel listed a webcam and a mechanical
 * keyboard nobody sells; the alerts panel warned that the margin on "Laptop Pro" had fallen and
 * that "Ejemplo Corp" was in arrears. None of it moved when the tenant traded, and all of it was
 * in Spanish regardless of the reader. A dashboard that shows the same numbers to every customer
 * is not a dashboard; it is a screenshot.
 *
 * The KPI tiles on the same page were already computed from the ledger. These are the rest.
 */
@Injectable()
export class DashboardChartsService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Revenue per month, from issued documents, net of credit notes.
   *
   * Drafts are excluded — they are not revenue — and a credit note subtracts, because a month in
   * which everything was credited back did not earn what it billed.
   */
  async salesTrend(organizationId: string, months = 12): Promise<TrendPointDto[]> {
    const rows: { month: string; amount: string }[] = await this.dataSource.query(
      `SELECT to_char(date_trunc('month', i."issueDate"), 'YYYY-MM-DD') AS month,
              COALESCE(SUM(
                CASE WHEN i."status" = $3 THEN -i."total_in_base_currency"
                     ELSE i."total_in_base_currency" END
              ), 0) AS amount
         FROM "invoices" i
        WHERE i."organization_id" = $1
          AND i."status" <> $4
          AND i."issueDate" >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
        GROUP BY 1
        ORDER BY 1`,
      [organizationId, months - 1, InvoiceStatus.CREDIT_NOTE, InvoiceStatus.DRAFT],
    );

    return this.fillMonths(rows, months);
  }

  /**
   * Where the money went, by expense account, over the same window.
   *
   * By account and not by an invented five-category taxonomy: the chart of accounts is the
   * taxonomy the tenant chose, and it is the one their accountant will reconcile against.
   */
  async expenseBreakdown(organizationId: string, months = 12, limit = 8): Promise<BreakdownSliceDto[]> {
    const rows: { label: unknown; amount: string }[] = await this.dataSource.query(
      `SELECT a."name" AS label,
              COALESCE(SUM(l."debit" - l."credit"), 0) AS amount
         FROM "journal_entry_lines" l
         JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
         JOIN "accounts" a ON a."id" = l."account_id"
        WHERE e."organization_id" = $1
          AND e."status" IN ('Posted', 'Modified')
          AND a."type" = $3
          AND e."date" >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
        GROUP BY a."id", a."name"
       HAVING COALESCE(SUM(l."debit" - l."credit"), 0) > 0
        ORDER BY 2 DESC
        LIMIT $4`,
      [organizationId, months - 1, AccountType.EXPENSE, limit],
    );

    return rows.map((row) => ({
      label: accountName(row.label),
      amount: roundAmount(Number(row.amount)),
    }));
  }

  /** How the receivable book splits by document status — issued, part-paid, settled, annulled. */
  async invoiceStatusMix(organizationId: string): Promise<InvoiceStatusSliceDto[]> {
    const rows: { status: string; count: string; amount: string }[] = await this.dataSource.query(
      `SELECT i."status" AS status,
              COUNT(*) AS count,
              COALESCE(SUM(i."total_in_base_currency"), 0) AS amount
         FROM "invoices" i
        WHERE i."organization_id" = $1
        GROUP BY i."status"
        ORDER BY 3 DESC`,
      [organizationId],
    );

    return rows.map((row) => ({
      status: row.status,
      count: Number(row.count),
      amount: roundAmount(Number(row.amount)),
    }));
  }

  /** What sold most, by billed value, over the window. */
  async topProducts(organizationId: string, months = 12, limit = 5): Promise<BreakdownSliceDto[]> {
    const rows: { label: string; amount: string }[] = await this.dataSource.query(
      `SELECT COALESCE(p."name", li."description") AS label,
              COALESCE(SUM(li."line_subtotal" * i."exchange_rate"), 0) AS amount
         FROM "invoice_line_item" li
         JOIN "invoices" i ON i."id" = li."invoiceId"
         LEFT JOIN "products" p ON p."id" = li."productId"
        WHERE i."organization_id" = $1
          AND i."status" NOT IN ($3, $4)
          AND i."issueDate" >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
        GROUP BY 1
        ORDER BY 2 DESC
        LIMIT $5`,
      [organizationId, months - 1, InvoiceStatus.DRAFT, InvoiceStatus.VOID, limit],
    );

    return rows.map((row) => ({ label: row.label, amount: roundAmount(Number(row.amount)) }));
  }

  /**
   * The four headline figures, each with the change against the comparable previous period.
   *
   * These were `Ventas de Hoy $1,250.00 +15%`, `Facturas Pendientes 12 −5%`, `Productos Bajos 8`
   * and `Clientes Activos 312 +1.2%` — literals in the bundle, identical for every tenant, with
   * changes measured against nothing.
   */
  async summary(organizationId: string): Promise<DashboardSummaryDto> {
    const [row]: {
      sales_today: string;
      sales_yesterday: string;
      pending_count: string;
      pending_amount: string;
      customers: string;
      customers_prev: string;
    }[] = await this.dataSource.query(
      `SELECT
         (SELECT COALESCE(SUM(i."total_in_base_currency"), 0)
            FROM "invoices" i
           WHERE i."organization_id" = $1 AND i."status" <> $2
             AND i."issueDate" = CURRENT_DATE) AS sales_today,
         (SELECT COALESCE(SUM(i."total_in_base_currency"), 0)
            FROM "invoices" i
           WHERE i."organization_id" = $1 AND i."status" <> $2
             AND i."issueDate" = CURRENT_DATE - 1) AS sales_yesterday,
         (SELECT COUNT(*)
            FROM "invoices" i
           WHERE i."organization_id" = $1 AND i."status" IN ($3, $4)) AS pending_count,
         (SELECT COALESCE(SUM(i."balance" * i."exchange_rate"), 0)
            FROM "invoices" i
           WHERE i."organization_id" = $1 AND i."status" IN ($3, $4)) AS pending_amount,
         (SELECT COUNT(*) FROM "customers" c
           WHERE c."organization_id" = $1 AND c."status" = 'ACTIVE') AS customers,
         (SELECT COUNT(*) FROM "customers" c
           WHERE c."organization_id" = $1 AND c."status" = 'ACTIVE'
             AND c."created_at" < date_trunc('month', CURRENT_DATE)) AS customers_prev`,
      [
        organizationId,
        InvoiceStatus.DRAFT,
        InvoiceStatus.PENDING,
        InvoiceStatus.PARTIALLY_PAID,
      ],
    );

    const lowStock = await this.lowStock(organizationId, 500);

    return {
      salesToday: roundAmount(Number(row?.sales_today ?? 0)),
      salesTodayChange: change(Number(row?.sales_today ?? 0), Number(row?.sales_yesterday ?? 0)),
      pendingInvoices: Number(row?.pending_count ?? 0),
      pendingInvoicesAmount: roundAmount(Number(row?.pending_amount ?? 0)),
      lowStockProducts: lowStock.length,
      outOfStockProducts: lowStock.filter((item) => item.stock <= 0).length,
      activeCustomers: Number(row?.customers ?? 0),
      activeCustomersChange: change(
        Number(row?.customers ?? 0),
        Number(row?.customers_prev ?? 0),
      ),
    };
  }

  /**
   * Budget against actuals, month by month, over the same window.
   *
   * The chart above this was `Presupuesto [100, 110, 105, …]` versus `Real [95, 105, 108, …]` —
   * two invented series for every tenant of the product, including those that keep no budget at
   * all. A tenant with no budget for a month gets a zero there and the widget says so; it does not
   * get somebody else's plan.
   */
  async budgetVsActual(
    organizationId: string,
    months = 12,
  ): Promise<{ month: string; budgeted: number; actual: number }[]> {
    const budgeted: { month: string; amount: string }[] = await this.dataSource.query(
      `SELECT b."period" || '-01' AS month, COALESCE(SUM(bl."amount"), 0) AS amount
         FROM "budgets" b
         JOIN "budget_lines" bl ON bl."budget_id" = b."id"
        WHERE b."organization_id" = $1
          AND (b."period" || '-01')::date >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
        GROUP BY 1
        ORDER BY 1`,
      [organizationId, months - 1],
    );

    // Actuals on the very accounts the budget names, so the two sides measure the same thing. A
    // budget for marketing compared against total spend is a comparison of nothing.
    const actual: { month: string; amount: string }[] = await this.dataSource.query(
      `SELECT to_char(date_trunc('month', e."date"), 'YYYY-MM-DD') AS month,
              COALESCE(SUM(ABS(l."debit" - l."credit")), 0) AS amount
         FROM "journal_entry_lines" l
         JOIN "journal_entries" e ON e."id" = l."journal_entry_id"
        WHERE e."organization_id" = $1
          AND e."status" IN ('Posted', 'Modified')
          AND e."date" >= date_trunc('month', CURRENT_DATE) - ($2 || ' months')::interval
          AND l."account_id" IN (
            SELECT DISTINCT bl."account_id"
              FROM "budget_lines" bl
              JOIN "budgets" b ON b."id" = bl."budget_id"
             WHERE b."organization_id" = $1
          )
        GROUP BY 1
        ORDER BY 1`,
      [organizationId, months - 1],
    );

    const budgetByMonth = new Map(budgeted.map((row) => [row.month, roundAmount(Number(row.amount))]));
    const actualByMonth = new Map(actual.map((row) => [row.month, roundAmount(Number(row.amount))]));

    return this.fillMonths([], months).map((point) => ({
      month: point.month,
      budgeted: budgetByMonth.get(point.month) ?? 0,
      actual: actualByMonth.get(point.month) ?? 0,
    }));
  }

  /**
   * What is running out, against the reorder level the tenant set.
   *
   * A product with no reorder level is only reported when it has actually run out: guessing a
   * threshold would fill the panel with items nobody is worried about.
   */
  async lowStock(organizationId: string, limit = 10): Promise<LowStockItemDto[]> {
    const rows: {
      id: string;
      name: string;
      sku: string | null;
      stock: string;
      reorder_level: string | null;
    }[] = await this.dataSource.query(
      `SELECT p."id", p."name", p."sku", p."stock", p."reorder_level"
         FROM "products" p
        WHERE p."organization_id" = $1
          AND p."kind" = 'GOOD'
          AND p."status" = 'Active'
          AND (
            (p."reorder_level" IS NOT NULL AND p."stock" <= p."reorder_level")
            OR (p."reorder_level" IS NULL AND p."stock" <= 0)
          )
        ORDER BY p."stock" ASC, p."name" ASC
        LIMIT $2`,
      [organizationId, limit],
    );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      sku: row.sku,
      stock: Number(row.stock),
      reorderLevel: row.reorder_level === null ? null : Number(row.reorder_level),
    }));
  }

  /**
   * What needs attention, derived rather than authored.
   *
   * Three facts the tenant's own data can state: money that should already have arrived, stock
   * that has run out, and a period that is still open after it ended. The panel this replaces
   * announced that the margin on "Laptop Pro" had fallen 15 % — to every customer, for ever.
   */
  async alerts(organizationId: string): Promise<DashboardAlertDto[]> {
    const alerts: DashboardAlertDto[] = [];

    const [overdue]: { count: string; amount: string }[] = await this.dataSource.query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(i."balance" * i."exchange_rate"), 0) AS amount
         FROM "invoices" i
        WHERE i."organization_id" = $1
          AND i."status" IN ($2, $3)
          AND i."dueDate" < CURRENT_DATE`,
      [organizationId, InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID],
    );
    if (Number(overdue?.count ?? 0) > 0) {
      alerts.push({
        id: 'receivables-overdue',
        severity: 'critical',
        messageKey: 'dashboard.alerts.receivables_overdue',
        params: { count: Number(overdue.count), amount: roundAmount(Number(overdue.amount)) },
        route: '/invoices',
      });
    }

    const outOfStock = await this.lowStock(organizationId, 50);
    const depleted = outOfStock.filter((item) => item.stock <= 0);
    if (depleted.length > 0) {
      alerts.push({
        id: 'stock-depleted',
        severity: 'critical',
        messageKey: 'dashboard.alerts.count_product_out_stock',
        params: { count: depleted.length },
        route: '/inventory',
      });
    } else if (outOfStock.length > 0) {
      alerts.push({
        id: 'stock-low',
        severity: 'warning',
        messageKey: 'dashboard.alerts.stock_low',
        params: { count: outOfStock.length },
        route: '/inventory',
      });
    }

    const [stalePeriod]: { name: string }[] = await this.dataSource.query(
      `SELECT p."name"
         FROM "accounting_periods" p
        WHERE p."organization_id" = $1
          AND p."status" = 'OPEN'
          AND p."end_date" < CURRENT_DATE
        ORDER BY p."end_date" ASC
        LIMIT 1`,
      [organizationId],
    );
    if (stalePeriod) {
      alerts.push({
        id: 'period-unclosed',
        severity: 'warning',
        messageKey: 'dashboard.alerts.period_period_still_open_closing_date',
        params: { period: stalePeriod.name },
        route: '/accounting/periods',
      });
    }

    return alerts;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * A month with no trade is a zero, not a gap.
   *
   * Highcharts draws a line straight from May to August if June and July are missing, which reads
   * as a gentle decline where the truth is two months of nothing.
   */
  private fillMonths(rows: { month: string; amount: string }[], months: number): TrendPointDto[] {
    const byMonth = new Map(rows.map((row) => [row.month, roundAmount(Number(row.amount))]));
    const out: TrendPointDto[] = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - (months - 1));

    for (let index = 0; index < months; index += 1) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-01`;
      out.push({ month: key, amount: byMonth.get(key) ?? 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
  }
}

/** Account names are stored per language: `{ "es": "Costo de Ventas" }`. */
function accountName(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    const map = value as Record<string, string>;
    return map['es'] ?? map['en'] ?? map['pt'] ?? Object.values(map)[0] ?? '';
  }
  return '';
}

/**
 * The change from `previous` to `current`, as a fraction.
 *
 * Null when there is nothing to compare against: a first day of trading is not "+100 %", and
 * dividing by zero to produce a percentage is how a dashboard starts lying quietly.
 */
function change(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return roundAmount((current - previous) / previous);
}

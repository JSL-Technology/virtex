import { Inject, Injectable, Logger } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, LessThanOrEqual, Not, Repository } from 'typeorm';
import { ERPVariable, VARIABLE_REGISTRY } from './variable-registry';
import { Invoice, InvoiceStatus, InvoiceType } from '../../invoices/entities/invoice.entity';
import { InvoiceLineItem } from '../../invoices/entities/invoice-line-item.entity';
import { Product, ProductStatus } from '../../inventory/entities/product.entity';
import {
  VendorBill,
  VendorBillStatus,
} from '../../accounts-payable/entities/vendor-bill.entity';
import { Employee } from '../../hcm/entities/employee.entity';
import { Budget } from '../../budgets/entities/budget.entity';
import { Account, AccountType } from '../../chart-of-accounts/entities/account.entity';
import { Organization } from '../../organizations/entities/organization.entity';
import { OrganizationSettings } from '../../organizations/entities/organization-settings.entity';
import { AuthenticatedUser } from '../../auth/interfaces/authenticated-user.interface';
import { FinancialReportingService } from '../../financial-reporting/financial-reporting.service';
import { TreasuryService } from '../../treasury/treasury.service';
import { ExchangeRateResolver } from '../../currencies/exchange-rate-resolver.service';
import { FiscalCalendarService } from '../../shared/fiscal-calendar.service';
import { findTaxScheme } from '../../localization/fiscal/country-tax-schemes';
import { roundAmount, sumAmounts } from '../../common/money';
import { addDaysIso, toIsoDate } from '../../common/dates';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../i18n/localized.exception';

/** How long a resolved value is reused. Long enough to serve one recalculation of a large sheet. */
const CACHE_TTL_MS = 60_000;

/** Default horizon for the cash projection, in days. */
const DEFAULT_PROJECTION_DAYS = 30;

/** Sales documents that count as invoiced: issued, whatever their collection state. */
const INVOICED_STATUSES = [
  InvoiceStatus.PENDING,
  InvoiceStatus.PARTIALLY_PAID,
  InvoiceStatus.PAID,
];

/** Documents with a balance still to collect. */
const OPEN_STATUSES = [InvoiceStatus.PENDING, InvoiceStatus.PARTIALLY_PAID];

/**
 * Resolving the ERP variables a spreadsheet references.
 *
 * ## What was wrong, and why each part mattered
 *
 * **The declared permissions were never checked.** Every entry in `VARIABLE_REGISTRY` carries a
 * `permission`, and `resolveVariable` never read it. `POST /datasheets/resolve-variables` carried
 * only `JwtAuthGuard`. So any authenticated member of the tenant could pull EBITDA, the cash
 * position, the gross margin, the cost of any product and the entire sales history by asking for a
 * variable by name. The permission list was decoration on an open door.
 *
 * **It leaked across tenants.** The snapshot branch loaded a `DatasheetBook` by id alone, with no
 * `organizationId`.
 *
 * **The sales figures were always zero.** `getSalesSum` filtered `invoice.status = 'paid'` against
 * an enum whose value is `'Paid'`. Nothing ever matched, so `TOTAL_SALES`, `MONTH_SALES` and
 * `TODAY_SALES` returned 0 in every tenant since the module shipped. It also summed `invoice.total`
 * across mixed currencies without converting, and defined "sales" as documents *collected* rather
 * than *issued*, which is not revenue recognition in any framework.
 *
 * **Three variables returned invented numbers.** `GOAL_FULFILLMENT` divided by
 * `const goal = 1000000; // Mock goal from settings`. `IMPORTAR_*` returned the literal
 * `[['Encabezado 1','Encabezado 2'],['Dato 1','Dato 2']]`. `PROJECTED_CASH_FLOW` had no case at all
 * and fell through to `default: value = 0`. A number in a cell carries no provenance: nobody
 * reading the sheet afterwards can tell a real figure from a placeholder, and the ones that were
 * placeholders were the ones a financial model leans on.
 *
 * **Every failure became a value.** `catch (e) { value = '#ERROR' }` turned a permission denial, a
 * dead connection and a genuine bug into the same three characters in a cell.
 *
 * Everything below reads the tenant's own records. A variable that cannot be answered from them is
 * not in the registry.
 */
@Injectable()
export class DatasheetVariablesService {
  private readonly logger = new Logger(DatasheetVariablesService.name);

  constructor(
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem)
    private readonly invoiceLines: Repository<InvoiceLineItem>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(VendorBill) private readonly bills: Repository<VendorBill>,
    @InjectRepository(Employee) private readonly employees: Repository<Employee>,
    @InjectRepository(Budget) private readonly budgets: Repository<Budget>,
    @InjectRepository(Account) private readonly accounts: Repository<Account>,
    @InjectRepository(Organization) private readonly organizations: Repository<Organization>,
    @InjectRepository(OrganizationSettings)
    private readonly settings: Repository<OrganizationSettings>,
    private readonly reporting: FinancialReportingService,
    private readonly treasury: TreasuryService,
    private readonly exchangeRates: ExchangeRateResolver,
    private readonly calendar: FiscalCalendarService,
  ) {}

  getRegistry(): ERPVariable[] {
    return VARIABLE_REGISTRY;
  }

  /**
   * Resolve one variable for one caller.
   *
   * Throws rather than returning a marker string. A cell that says `#ERROR` is indistinguishable
   * from a cell that says zero to everyone downstream, and the two mean opposite things.
   */
  async resolveVariable(
    name: string,
    params: unknown[],
    user: AuthenticatedUser,
  ): Promise<string | number> {
    const variable = VARIABLE_REGISTRY.find(
      (candidate) => candidate.nameEn === name || candidate.nameEs === name,
    );
    if (!variable) {
      throw new NotFoundError('DATASHEETS.VARIABLE_NO_EXISTE', { name });
    }
    this.assertPermitted(variable, user);

    const cacheKey = `var:${user.organizationId}:${variable.nameEn}:${JSON.stringify(params)}`;
    const cached = await this.cacheManager.get<string | number>(cacheKey);
    if (cached !== undefined && cached !== null) return cached;

    const value = await this.compute(variable, params, user);
    await this.cacheManager.set(cacheKey, value, CACHE_TTL_MS);
    return value;
  }

  /**
   * Resolve several at once, reporting per variable.
   *
   * A batch is not all-or-nothing: a sheet referencing twenty variables, one of which the caller
   * may not see, should render the nineteen and say why the twentieth is missing — but say it, as
   * a reason, not as a number.
   */
  async resolveBatch(
    variables: { name: string; params?: unknown[] }[],
    user: AuthenticatedUser,
  ): Promise<Record<string, { value: string | number } | { error: string }>> {
    const results: Record<string, { value: string | number } | { error: string }> = {};

    await Promise.all(
      (variables ?? []).map(async (requested) => {
        const params = requested.params ?? [];
        const key = `${requested.name}${params.length ? `(${params.join(',')})` : ''}`;
        try {
          results[key] = { value: await this.resolveVariable(requested.name, params, user) };
        } catch (error) {
          const messageKey = (error as { messageKey?: string }).messageKey;
          results[key] = { error: messageKey ?? (error as Error).message };
          if (!messageKey) {
            // An unexpected failure is a defect, not a cell value. It is logged with its stack so
            // it can be found, rather than disappearing into a spreadsheet as `#ERROR`.
            this.logger.error(
              `No se pudo resolver ${requested.name}: ${(error as Error).message}`,
              (error as Error).stack,
            );
          }
        }
      }),
    );

    return results;
  }

  /** The permission the registry declares, actually enforced. */
  private assertPermitted(variable: ERPVariable, user: AuthenticatedUser): void {
    if (!variable.permission) return;
    const held = new Set(
      (user.roles ?? []).flatMap(
        (role: { permissions?: string[] }) => role.permissions ?? [],
      ),
    );
    if (!held.has(variable.permission)) {
      throw new ForbiddenError('DATASHEETS.SIN_PERMISO_PARA_VARIABLE', {
        variable: variable.nameEs,
        permission: variable.permission,
      });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────

  private async compute(
    variable: ERPVariable,
    params: unknown[],
    user: AuthenticatedUser,
  ): Promise<string | number> {
    const org = user.organizationId;
    const today = await this.calendar.today(org);

    switch (variable.nameEn) {
      // ── Sales ─────────────────────────────────────────────────────────────
      case 'TOTAL_SALES':
        return this.invoicedBetween(org, null, null);
      case 'TODAY_SALES':
        return this.invoicedBetween(org, today, today);
      case 'MONTH_SALES':
        return this.invoicedBetween(org, monthStart(today), monthEnd(today));
      case 'PREVIOUS_MONTH_SALES': {
        const previous = previousMonth(today);
        return this.invoicedBetween(org, monthStart(previous), monthEnd(previous));
      }
      case 'YEAR_SALES':
        return this.invoicedBetween(org, `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`);

      case 'AVERAGE_TICKET': {
        const [total, count] = await Promise.all([
          this.invoicedBetween(org, null, null),
          this.invoices.count({
            where: { organizationId: org, type: InvoiceType.INVOICE, status: In(INVOICED_STATUSES) },
          }),
        ]);
        return count === 0 ? 0 : roundAmount(total / count);
      }

      case 'GOAL_FULFILLMENT': {
        const budgeted = await this.revenueBudgetFor(org, today.slice(0, 7));
        if (budgeted === 0) {
          // No budget is not a goal of zero, and it is not a goal of a million either.
          throw new BadRequestError('DATASHEETS.SIN_PRESUPUESTO_DE_INGRESOS', {
            period: today.slice(0, 7),
          });
        }
        const achieved = await this.invoicedBetween(org, monthStart(today), monthEnd(today));
        return roundAmount((achieved / budgeted) * 100);
      }

      // ── Costs and profit, from the ledger ─────────────────────────────────
      case 'SALES_COST':
      case 'GROSS_PROFIT':
      case 'GROSS_MARGIN': {
        const statement = await this.reporting.getIncomeStatement(
          org,
          `${today.slice(0, 4)}-01-01`,
          today,
        );
        const revenue = statement.revenue.total;
        const cost = statement.costOfSales.total;
        if (variable.nameEn === 'SALES_COST') return roundAmount(cost);
        if (variable.nameEn === 'GROSS_PROFIT') return roundAmount(revenue - cost);
        return revenue === 0 ? 0 : roundAmount(((revenue - cost) / revenue) * 100);
      }

      case 'EBITDA': {
        const statement = await this.reporting.getIncomeStatement(
          org,
          `${today.slice(0, 4)}-01-01`,
          today,
        );
        // Operating result before the depreciation and amortisation inside operating expenses.
        const depreciation = await this.depreciationFor(org, `${today.slice(0, 4)}-01-01`, today);
        return roundAmount(statement.operatingIncome + depreciation);
      }

      // ── Inventory ─────────────────────────────────────────────────────────
      case 'INVENTORY_VALUE': {
        const row = await this.products
          .createQueryBuilder('product')
          .select('COALESCE(SUM(product.stock * product.cost), 0)', 'total')
          .where('product.organizationId = :org', { org })
          .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
          .getRawOne<{ total: string }>();
        return roundAmount(Number(row?.total ?? 0));
      }
      case 'UNITS_IN_STOCK': {
        const row = await this.products
          .createQueryBuilder('product')
          .select('COALESCE(SUM(product.stock), 0)', 'total')
          .where('product.organizationId = :org', { org })
          .andWhere('product.status = :status', { status: ProductStatus.ACTIVE })
          .getRawOne<{ total: string }>();
        return roundAmount(Number(row?.total ?? 0), 6);
      }
      case 'OUT_OF_STOCK_PRODUCTS':
        return this.products.count({
          where: { organizationId: org, status: ProductStatus.ACTIVE, stock: 0 },
        });
      case 'PRODUCT_COST':
      case 'PRODUCT_STOCK': {
        const sku = String(params[0] ?? '').trim();
        if (!sku) throw new BadRequestError('DATASHEETS.PARAMETRO_REQUERIDO', { param: 'ref' });
        const product = await this.products.findOne({ where: { sku, organizationId: org } });
        if (!product) throw new NotFoundError('DATASHEETS.PRODUCTO_NO_ENCONTRADO', { sku });
        return variable.nameEn === 'PRODUCT_COST'
          ? roundAmount(product.cost)
          : roundAmount(product.stock, 6);
      }

      // ── Receivables ───────────────────────────────────────────────────────
      case 'ACCOUNTS_RECEIVABLE':
        return this.receivableBalance(org, null);
      case 'OVERDUE_AR':
        return this.receivableBalance(org, today);
      case 'DELINQUENCY_INDEX': {
        const [outstanding, overdue] = await Promise.all([
          this.receivableBalance(org, null),
          this.receivableBalance(org, today),
        ]);
        return outstanding === 0 ? 0 : roundAmount((overdue / outstanding) * 100);
      }
      case 'CUSTOMER_DEBT': {
        const customerId = String(params[0] ?? '').trim();
        if (!customerId) throw new BadRequestError('DATASHEETS.PARAMETRO_REQUERIDO', { param: 'id' });
        return this.receivableBalance(org, null, customerId);
      }

      // ── Payables ──────────────────────────────────────────────────────────
      case 'ACCOUNTS_PAYABLE':
        return this.payableBalance(org);
      case 'MONTH_PURCHASES': {
        const rows = await this.bills.find({
          where: {
            organizationId: org,
            status: Not(In([VendorBillStatus.VOID, VendorBillStatus.REJECTED])),
            date: Between(
              monthStart(today) as unknown as Date,
              monthEnd(today) as unknown as Date,
            ),
          },
          select: ['totalInBaseCurrency'],
        });
        return sumAmounts(rows.map((bill) => Number(bill.totalInBaseCurrency)));
      }

      // ── Cash ──────────────────────────────────────────────────────────────
      case 'CURRENT_CASH_FLOW': {
        const position = await this.treasury.cashPosition(org, today);
        return roundAmount(position.total);
      }
      case 'PROJECTED_CASH_FLOW': {
        const days = Number(params[0] ?? DEFAULT_PROJECTION_DAYS);
        if (!Number.isFinite(days) || days < 0 || days > 365) {
          throw new BadRequestError('DATASHEETS.HORIZONTE_PROYECCION_NO_VALIDO', { days });
        }
        const horizon = addDaysIso(today, Math.trunc(days));
        const [position, collections, payments] = await Promise.all([
          this.treasury.cashPosition(org, today),
          this.receivableDueBy(org, horizon),
          this.payableDueBy(org, horizon),
        ]);
        return roundAmount(position.total + collections - payments);
      }

      // ── People ────────────────────────────────────────────────────────────
      case 'ACTIVE_EMPLOYEES':
        return this.employees.count({ where: { organizationId: org } });

      // ── Fiscal ────────────────────────────────────────────────────────────
      case 'TAX_RATE': {
        const organization = await this.organizations.findOne({
          where: { id: org },
          select: ['id', 'country'],
        });
        const scheme = findTaxScheme(organization?.country ?? '');
        const standard = scheme?.taxes.find((tax) => tax.rate > 0);
        if (!standard) {
          // A country whose base is sub-national (US, BR) has no single national rate to state.
          throw new BadRequestError('DATASHEETS.PAIS_SIN_TASA_NACIONAL_UNICA', {
            country: organization?.country ?? '',
          });
        }
        return standard.rate;
      }
      case 'EXCHANGE_RATE': {
        const from = String(params[0] ?? '').trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(from)) {
          throw new BadRequestError('DATASHEETS.PARAMETRO_REQUERIDO', { param: 'moneda' });
        }
        const base = await this.baseCurrency(org);
        const resolved = await this.exchangeRates.resolve(from, base, today);
        return roundAmount(resolved.rate, 6);
      }

      // ── Sales detail ──────────────────────────────────────────────────────
      case 'TOP_SELLING_PRODUCT': {
        const row = await this.invoiceLines
          .createQueryBuilder('line')
          .innerJoin(Invoice, 'invoice', 'invoice.id = line."invoiceId"')
          .select('line.description', 'description')
          .addSelect('SUM(line.taxable_base)', 'total')
          .where('invoice.organizationId = :org', { org })
          .andWhere('invoice.type = :type', { type: InvoiceType.INVOICE })
          .andWhere('invoice.status IN (:...statuses)', { statuses: INVOICED_STATUSES })
          .andWhere('invoice.issueDate BETWEEN :from AND :to', {
            from: monthStart(today),
            to: monthEnd(today),
          })
          .groupBy('line.description')
          .orderBy('SUM(line.taxable_base)', 'DESC')
          .limit(1)
          .getRawOne<{ description: string }>();
        if (!row) throw new NotFoundError('DATASHEETS.SIN_VENTAS_EN_EL_PERIODO');
        return row.description;
      }

      // ── System ────────────────────────────────────────────────────────────
      case 'COMPANY_NAME': {
        const organization = await this.organizations.findOne({
          where: { id: org },
          select: ['id', 'legalName'],
        });
        return organization?.legalName ?? '';
      }
      case 'COMPANY_TAX_ID': {
        const organization = await this.organizations.findOne({
          where: { id: org },
          select: ['id', 'taxId'],
        });
        return organization?.taxId ?? '';
      }
      case 'TODAY_DATE':
        return today;
      case 'CURRENT_USER_NAME':
        return [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.email ?? '');

      default: {
        // Unreachable while the registry and this switch agree; if they ever diverge, the caller is
        // told rather than handed a zero.
        const exhaustive: string = variable.nameEn;
        throw new NotFoundError('DATASHEETS.VARIABLE_SIN_IMPLEMENTACION', { name: exhaustive });
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Real figures, from the tenant's own records
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Sales invoiced in a date range, in the books' currency, net of credit notes.
   *
   * `totalInBaseCurrency`, not `total`: a tenant that invoices in more than one currency was
   * previously having its dollars added to its pesos. Issued documents, not collected ones —
   * revenue is recognised when the document is issued, not when the customer pays. Credit notes
   * subtract, because a sale that was credited back is not a sale.
   */
  private async invoicedBetween(
    organizationId: string,
    from: string | null,
    to: string | null,
  ): Promise<number> {
    const query = this.invoices
      .createQueryBuilder('invoice')
      .select('COALESCE(SUM(invoice.total_in_base_currency), 0)', 'total')
      .where('invoice.organizationId = :organizationId', { organizationId })
      .andWhere('invoice.type = :type', { type: InvoiceType.INVOICE })
      .andWhere('invoice.status IN (:...statuses)', { statuses: INVOICED_STATUSES });
    if (from && to) {
      query.andWhere('invoice.issueDate BETWEEN :from AND :to', { from, to });
    }
    const sales = Number((await query.getRawOne<{ total: string }>())?.total ?? 0);

    const creditQuery = this.invoices
      .createQueryBuilder('invoice')
      .select('COALESCE(SUM(invoice.total_in_base_currency), 0)', 'total')
      .where('invoice.organizationId = :organizationId', { organizationId })
      .andWhere('invoice.type = :type', { type: InvoiceType.CREDIT_NOTE })
      .andWhere('invoice.status <> :draft', { draft: InvoiceStatus.DRAFT });
    if (from && to) {
      creditQuery.andWhere('invoice.issueDate BETWEEN :from AND :to', { from, to });
    }
    const credits = Number((await creditQuery.getRawOne<{ total: string }>())?.total ?? 0);

    return roundAmount(sales - credits);
  }

  /** Outstanding receivable, optionally only what is already overdue, or for one customer. */
  private async receivableBalance(
    organizationId: string,
    overdueOn: string | null,
    customerId?: string,
  ): Promise<number> {
    const query = this.invoices
      .createQueryBuilder('invoice')
      // The balance is in document currency; the rate the document was booked at converts it.
      .select('COALESCE(SUM(invoice.balance * COALESCE(invoice.exchange_rate, 1)), 0)', 'total')
      .where('invoice.organizationId = :organizationId', { organizationId })
      .andWhere('invoice.status IN (:...statuses)', { statuses: OPEN_STATUSES });
    if (overdueOn) query.andWhere('invoice.dueDate < :overdueOn', { overdueOn });
    if (customerId) query.andWhere('invoice.customer_id = :customerId', { customerId });
    return roundAmount(Number((await query.getRawOne<{ total: string }>())?.total ?? 0));
  }

  /** Receivable falling due on or before `horizon`, including what is already overdue. */
  private async receivableDueBy(organizationId: string, horizon: string): Promise<number> {
    const rows = await this.invoices.find({
      where: {
        organizationId,
        status: In(OPEN_STATUSES),
        dueDate: LessThanOrEqual(horizon),
      },
      select: ['balance', 'exchangeRate'],
    });
    return sumAmounts(rows.map((row) => Number(row.balance) * (Number(row.exchangeRate) || 1)));
  }

  private async payableBalance(organizationId: string): Promise<number> {
    const rows = await this.bills.find({
      where: {
        organizationId,
        status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
      },
      select: ['balance', 'exchangeRate'],
    });
    return sumAmounts(rows.map((row) => Number(row.balance) * (Number(row.exchangeRate) || 1)));
  }

  private async payableDueBy(organizationId: string, horizon: string): Promise<number> {
    const rows = await this.bills.find({
      where: {
        organizationId,
        status: In([VendorBillStatus.OPEN, VendorBillStatus.PARTIALLY_PAID]),
        dueDate: LessThanOrEqual(horizon as unknown as Date),
      },
      select: ['balance', 'exchangeRate'],
    });
    return sumAmounts(rows.map((row) => Number(row.balance) * (Number(row.exchangeRate) || 1)));
  }

  /**
   * The revenue budget for a `YYYY-MM` period.
   *
   * This is what replaced `const goal = 1000000`. A budget line is a figure somebody entered
   * against a revenue account for a month; summing those is a goal the tenant actually set.
   */
  private async revenueBudgetFor(organizationId: string, period: string): Promise<number> {
    const budgets = await this.budgets.find({
      where: { organizationId, period },
      relations: ['lines'],
    });
    if (budgets.length === 0) return 0;

    const accountIds = [
      ...new Set(budgets.flatMap((budget) => budget.lines.map((line) => line.accountId))),
    ];
    if (accountIds.length === 0) return 0;

    const revenueAccounts = await this.accounts.find({
      where: { id: In(accountIds), organizationId, type: AccountType.REVENUE },
      select: ['id'],
    });
    const revenueIds = new Set(revenueAccounts.map((account) => account.id));

    return sumAmounts(
      budgets
        .flatMap((budget) => budget.lines)
        .filter((line) => revenueIds.has(line.accountId))
        .map((line) => Number(line.amount)),
    );
  }

  /** Depreciation and amortisation charged in the range, added back for EBITDA. */
  private async depreciationFor(
    organizationId: string,
    from: string,
    to: string,
  ): Promise<number> {
    const statement = await this.reporting.getIncomeStatement(organizationId, from, to);
    const accounts = await this.accounts.find({
      where: { organizationId, systemRole: 'DEPRECIATION_EXPENSE' as never },
      select: ['id'],
    });
    const depreciationIds = new Set(accounts.map((account) => account.id));
    return sumAmounts(
      statement.operatingExpenses.accounts
        .filter((line) => depreciationIds.has(line.accountId))
        .map((line) => line.amount),
    );
  }

  private async baseCurrency(organizationId: string): Promise<string> {
    const settings = await this.settings.findOne({ where: { organizationId } });
    return settings?.baseCurrency ?? 'USD';
  }
}

function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

function monthEnd(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  return toIsoDate(new Date(Date.UTC(year, month, 0)));
}

function previousMonth(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  return toIsoDate(new Date(Date.UTC(year, month - 2, 1)));
}

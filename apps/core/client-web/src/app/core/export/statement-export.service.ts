import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import {
  BalanceSheetReport,
  CashFlowStatementReport,
  IncomeStatementReport,
  ReportAccountLine,
  ReportSection,
  TrialBalanceReport,
} from '../api/financial-reporting.service';
import { ProfitabilityReport } from '../api/profitability.service';
import { accountNameOf } from '../i18n/localized-name';
import { CsvValue, downloadCsv, reportFilename, toCsv } from './csv-export';

/**
 * The four statutory statements, as files.
 *
 * ## What each export has to carry besides the numbers
 *
 * A statement without its heading is a column of figures nobody can file. Each export opens with
 * the report's name, the ledger it came from, the currency it is stated in and the date or period
 * it covers — the same four facts a printed statement carries in its header, because the file will
 * be opened weeks later by someone who did not run it.
 *
 * ## Why the totals come from the report
 *
 * Every subtotal, total and balance check written here is the one the server computed. Adding the
 * columns up again in the browser would be a second implementation of the ledger, and the day the
 * two disagree is the day nobody can say which is right.
 */
@Injectable({ providedIn: 'root' })
export class StatementExportService {
  private readonly translate = inject(TranslateService);

  private t(key: string): string {
    const translated = this.translate.instant(key);
    // `instant` returns the key itself when the catalogue has no entry. Writing `REPORTS.X.Y` into
    // a spreadsheet cell is worse than writing nothing, because it looks like data.
    return translated === key ? '' : translated;
  }

  private get locale(): string {
    return this.translate.currentLang || this.translate.getDefaultLang() || 'es';
  }

  /** Title, ledger, currency and period, above the table. */
  private preamble(title: string, ledgerName: string, currency: string, period: string[]): CsvValue[][] {
    return [
      [title],
      [this.t('reports.export.ledger'), ledgerName],
      [this.t('reports.export.currency'), currency],
      ...period.map((line) => [this.t('reports.export.period'), line]),
      [this.t('reports.export.generated_at'), new Date().toISOString()],
      [],
    ];
  }

  private lineRows(accounts: ReportAccountLine[]): CsvValue[][] {
    return accounts.map((account) => [
      account.code,
      accountNameOf(account.name),
      account.category,
      account.amount,
    ]);
  }

  private sectionRows(sections: ReportSection[]): CsvValue[][] {
    return sections.flatMap((section) => [
      [section.category],
      ...this.lineRows(section.accounts),
      ['', this.t('reports.export.subtotal'), '', section.subtotal],
      [],
    ]);
  }

  private get accountHeader(): CsvValue[] {
    return [
      this.t('reports.export.code'),
      this.t('reports.export.account'),
      this.t('reports.export.category'),
      this.t('reports.export.amount'),
    ];
  }

  exportBalanceSheet(report: BalanceSheetReport): void {
    const rows: CsvValue[][] = [
      this.accountHeader,
      [this.t('reports.export.assets')],
      ...this.sectionRows(report.assets.sections),
      ['', this.t('reports.export.total_assets'), '', report.assets.total],
      [],
      [this.t('reports.export.liabilities')],
      ...this.sectionRows(report.liabilities.sections),
      ['', this.t('reports.export.total_liabilities'), '', report.liabilities.total],
      [],
      [this.t('reports.export.equity')],
      ...this.sectionRows(report.equity.sections),
      ['', this.t('reports.export.result_year_not_yet_closed'), '', report.equity.unclosedResult],
      ['', this.t('reports.export.total_equity'), '', report.equity.total],
      [],
      [
        '',
        this.t('reports.export.total_liabilities_and_equity'),
        '',
        report.totalLiabilitiesAndEquity,
      ],
      // Exported deliberately. A statement that does not balance must say so in the file as
      // plainly as it does on the screen; an export that quietly drops the warning is how an
      // unbalanced set of books reaches an auditor looking correct.
      ['', this.t('reports.export.is_balanced'), '', report.isBalanced],
      ['', this.t('reports.export.out_of_balance_by'), '', report.outOfBalanceBy],
    ];

    downloadCsv(
      reportFilename('balance-general', report.asOfDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('reports.balance_sheet.balance_general'),
          report.ledger.name,
          report.ledger.currency,
          [report.asOfDate],
        ),
      }),
    );
  }

  exportIncomeStatement(report: IncomeStatementReport): void {
    const rows: CsvValue[][] = [
      this.accountHeader,
      [this.t('reports.export.revenue')],
      ...this.sectionRows(report.revenue.sections),
      ['', this.t('reports.export.total_revenue'), '', report.revenue.total],
      [],
      [this.t('reports.export.cost_of_sales')],
      ...this.lineRows(report.costOfSales.accounts),
      ['', this.t('reports.export.total_cost_of_sales'), '', report.costOfSales.total],
      ['', this.t('reports.export.gross_profit'), '', report.grossProfit],
      [],
      [this.t('reports.export.operating_expenses')],
      ...this.lineRows(report.operatingExpenses.accounts),
      ['', this.t('reports.export.total_operating_expenses'), '', report.operatingExpenses.total],
      ['', this.t('reports.export.operating_income'), '', report.operatingIncome],
      [],
      [this.t('reports.export.non_operating')],
      ...this.lineRows(report.nonOperating.accounts),
      ['', this.t('reports.export.total_non_operating'), '', report.nonOperating.total],
      [],
      ['', this.t('reports.export.net_income'), '', report.netIncome],
    ];

    downloadCsv(
      reportFilename('estado-de-resultados', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('reports.income_statement.income_statement'),
          report.ledger.name,
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  exportTrialBalance(report: TrialBalanceReport): void {
    const rows: CsvValue[][] = [
      [
        this.t('reports.export.code'),
        this.t('reports.export.account'),
        this.t('reports.export.opening_debit'),
        this.t('reports.export.opening_credit'),
        this.t('reports.export.period_debit'),
        this.t('reports.export.period_credit'),
        this.t('reports.export.closing_debit'),
        this.t('reports.export.closing_credit'),
      ],
      ...report.rows.map((row) => [
        row.code,
        accountNameOf(row.name),
        row.openingDebit,
        row.openingCredit,
        row.periodDebit,
        row.periodCredit,
        row.closingDebit,
        row.closingCredit,
      ]),
      [
        '',
        this.t('reports.export.totals'),
        report.totals.openingDebit,
        report.totals.openingCredit,
        report.totals.periodDebit,
        report.totals.periodCredit,
        report.totals.closingDebit,
        report.totals.closingCredit,
      ],
      ['', this.t('reports.export.is_balanced'), report.isBalanced],
    ];

    downloadCsv(
      reportFilename('balance-de-comprobacion', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('reports.trial_balance.trial_balance'),
          report.ledger.name,
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  exportCashFlow(report: CashFlowStatementReport): void {
    const adjustmentRows = (movements: { code: string; amount: number }[]): CsvValue[][] =>
      movements.map((movement) => [movement.code, '', '', movement.amount]);

    // Investing and financing carry their two sides as well as their net, because the export is
    // the file a reader takes to a spreadsheet and the gross presentation IAS 7.21 requires has to
    // survive the trip. A file with only the net is a file the statement cannot be rebuilt from.
    const grossRows = (
      movements: { code: string; inflow: number; outflow: number; amount: number }[],
    ): CsvValue[][] =>
      movements.map((movement) => [
        movement.code,
        movement.inflow,
        movement.outflow,
        movement.amount,
      ]);

    const rows: CsvValue[][] = [
      [
        this.t('reports.export.concept'),
        this.t('reports.cash_flow.inflows'),
        this.t('reports.cash_flow.outflows'),
        this.t('reports.export.amount'),
      ],
      [this.t('reports.export.opening_cash'), '', '', report.openingCash],
      [],
      [this.t('reports.export.operating')],
      [this.t('reports.export.net_income'), '', '', report.operating.netIncome],
      ...adjustmentRows(report.operating.nonCashAdjustments),
      ...adjustmentRows(report.operating.workingCapitalChanges),
      [this.t('reports.export.total_operating'), '', '', report.operating.total],
      [],
      [this.t('reports.export.investing')],
      ...grossRows(report.investing.movements),
      [
        this.t('reports.export.total_investing'),
        report.investing.inflows,
        report.investing.outflows,
        report.investing.total,
      ],
      [],
      [this.t('reports.export.financing')],
      ...grossRows(report.financing.movements),
      [
        this.t('reports.export.total_financing'),
        report.financing.inflows,
        report.financing.outflows,
        report.financing.total,
      ],
      [],
      [
        this.t('reports.cash_flow.effect_exchange_rate_changes_cash'),
        '',
        '',
        report.effectOfExchangeRateOnCash,
      ],
      [this.t('reports.export.net_change_in_cash'), '', '', report.netChangeInCash],
      [this.t('reports.export.closing_cash'), '', '', report.closingCash],
      [
        this.t('reports.export.unexplained_difference'),
        '',
        '',
        report.unexplainedDifference,
      ],
      // The IAS 7.43 disclosure travels with the statement. Debit and credit, not a cash figure:
      // these transactions had none, which is why they are here rather than in a section above.
      ...(report.nonCashTransactions.length > 0
        ? ([
            [],
            [this.t('reports.cash_flow.investing_financing_transactions_used_no_cash')],
            [
              this.t('reports.export.code'),
              this.t('reports.export.debit'),
              this.t('reports.export.credit'),
            ],
            ...report.nonCashTransactions.map((line) => [line.code, line.debit, line.credit]),
          ] as CsvValue[][])
        : []),
    ];

    downloadCsv(
      reportFilename('flujo-de-efectivo', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('reports.cash_flow.statement_cash_flows'),
          report.ledger.name,
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  /**
   * Gross margin by product or by customer.
   *
   * The `linesWithoutCost` count is written into the file, not just the screen: a product sold
   * before its cost was recorded shows a 100 % margin, and a reader opening the export next month
   * has no other way to know which rows to distrust.
   */
  exportProfitability(report: ProfitabilityReport, dimension: 'product' | 'customer'): void {
    const subjectKey =
      dimension === 'product' ? 'reports.export.product' : 'reports.export.customer';

    const rows: CsvValue[][] = [
      [
        this.t('reports.export.code'),
        this.t(subjectKey),
        this.t('reports.export.units_sold'),
        this.t('reports.export.total_revenue'),
        this.t('reports.export.total_cost'),
        this.t('reports.export.gross_profit'),
        this.t('reports.export.gross_margin'),
      ],
      ...report.rows.map((row) => [
        row.code,
        row.name,
        row.unitsSold,
        row.totalRevenue,
        row.totalCost,
        row.grossProfit,
        row.grossMargin,
      ]),
      [
        '',
        this.t('reports.export.totals'),
        report.totals.unitsSold,
        report.totals.totalRevenue,
        report.totals.totalCost,
        report.totals.grossProfit,
        report.totals.grossMargin,
      ],
      [],
      ['', this.t('reports.export.lines_without_cost'), report.linesWithoutCost],
    ];

    downloadCsv(
      reportFilename(
        dimension === 'product' ? 'rentabilidad-por-producto' : 'rentabilidad-por-cliente',
        report.period.startDate,
        report.period.endDate,
      ),
      toCsv(rows, {
        locale: this.locale,
        preamble: [
          [
            this.t(
              dimension === 'product'
                ? 'reports.profitability_by_product.profitability_by_product'
                : 'reports.profitability_by_customer.profitability_by_customer',
            ),
          ],
          [this.t('reports.export.currency'), report.currency],
          [
            this.t('reports.export.period'),
            `${report.period.startDate} – ${report.period.endDate}`,
          ],
          [this.t('reports.export.generated_at'), new Date().toISOString()],
          [],
        ],
      }),
    );
  }

}

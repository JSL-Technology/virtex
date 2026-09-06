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
      [this.t('REPORTS.EXPORT.LEDGER'), ledgerName],
      [this.t('REPORTS.EXPORT.CURRENCY'), currency],
      ...period.map((line) => [this.t('REPORTS.EXPORT.PERIOD'), line]),
      [this.t('REPORTS.EXPORT.GENERATED_AT'), new Date().toISOString()],
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
      ['', this.t('REPORTS.EXPORT.SUBTOTAL'), '', section.subtotal],
      [],
    ]);
  }

  private get accountHeader(): CsvValue[] {
    return [
      this.t('REPORTS.EXPORT.CODE'),
      this.t('REPORTS.EXPORT.ACCOUNT'),
      this.t('REPORTS.EXPORT.CATEGORY'),
      this.t('REPORTS.EXPORT.AMOUNT'),
    ];
  }

  exportBalanceSheet(report: BalanceSheetReport): void {
    const rows: CsvValue[][] = [
      this.accountHeader,
      [this.t('REPORTS.EXPORT.ASSETS')],
      ...this.sectionRows(report.assets.sections),
      ['', this.t('REPORTS.EXPORT.TOTAL_ASSETS'), '', report.assets.total],
      [],
      [this.t('REPORTS.EXPORT.LIABILITIES')],
      ...this.sectionRows(report.liabilities.sections),
      ['', this.t('REPORTS.EXPORT.TOTAL_LIABILITIES'), '', report.liabilities.total],
      [],
      [this.t('REPORTS.EXPORT.EQUITY')],
      ...this.sectionRows(report.equity.sections),
      ['', this.t('REPORTS.EXPORT.UNCLOSED_RESULT'), '', report.equity.unclosedResult],
      ['', this.t('REPORTS.EXPORT.TOTAL_EQUITY'), '', report.equity.total],
      [],
      [
        '',
        this.t('REPORTS.EXPORT.TOTAL_LIABILITIES_AND_EQUITY'),
        '',
        report.totalLiabilitiesAndEquity,
      ],
      // Exported deliberately. A statement that does not balance must say so in the file as
      // plainly as it does on the screen; an export that quietly drops the warning is how an
      // unbalanced set of books reaches an auditor looking correct.
      ['', this.t('REPORTS.EXPORT.IS_BALANCED'), '', report.isBalanced],
      ['', this.t('REPORTS.EXPORT.OUT_OF_BALANCE_BY'), '', report.outOfBalanceBy],
    ];

    downloadCsv(
      reportFilename('balance-general', report.asOfDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('REPORTS.BALANCE_SHEET.BALANCE_GENERAL'),
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
      [this.t('REPORTS.EXPORT.REVENUE')],
      ...this.sectionRows(report.revenue.sections),
      ['', this.t('REPORTS.EXPORT.TOTAL_REVENUE'), '', report.revenue.total],
      [],
      [this.t('REPORTS.EXPORT.COST_OF_SALES')],
      ...this.lineRows(report.costOfSales.accounts),
      ['', this.t('REPORTS.EXPORT.TOTAL_COST_OF_SALES'), '', report.costOfSales.total],
      ['', this.t('REPORTS.EXPORT.GROSS_PROFIT'), '', report.grossProfit],
      [],
      [this.t('REPORTS.EXPORT.OPERATING_EXPENSES')],
      ...this.lineRows(report.operatingExpenses.accounts),
      ['', this.t('REPORTS.EXPORT.TOTAL_OPERATING_EXPENSES'), '', report.operatingExpenses.total],
      ['', this.t('REPORTS.EXPORT.OPERATING_INCOME'), '', report.operatingIncome],
      [],
      [this.t('REPORTS.EXPORT.NON_OPERATING')],
      ...this.lineRows(report.nonOperating.accounts),
      ['', this.t('REPORTS.EXPORT.TOTAL_NON_OPERATING'), '', report.nonOperating.total],
      [],
      ['', this.t('REPORTS.EXPORT.NET_INCOME'), '', report.netIncome],
    ];

    downloadCsv(
      reportFilename('estado-de-resultados', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('REPORTS.INCOME_STATEMENT.TITULO'),
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
        this.t('REPORTS.EXPORT.CODE'),
        this.t('REPORTS.EXPORT.ACCOUNT'),
        this.t('REPORTS.EXPORT.OPENING_DEBIT'),
        this.t('REPORTS.EXPORT.OPENING_CREDIT'),
        this.t('REPORTS.EXPORT.PERIOD_DEBIT'),
        this.t('REPORTS.EXPORT.PERIOD_CREDIT'),
        this.t('REPORTS.EXPORT.CLOSING_DEBIT'),
        this.t('REPORTS.EXPORT.CLOSING_CREDIT'),
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
        this.t('REPORTS.EXPORT.TOTALS'),
        report.totals.openingDebit,
        report.totals.openingCredit,
        report.totals.periodDebit,
        report.totals.periodCredit,
        report.totals.closingDebit,
        report.totals.closingCredit,
      ],
      ['', this.t('REPORTS.EXPORT.IS_BALANCED'), report.isBalanced],
    ];

    downloadCsv(
      reportFilename('balance-de-comprobacion', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('REPORTS.TRIAL_BALANCE.TITULO'),
          report.ledger.name,
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  exportCashFlow(report: CashFlowStatementReport): void {
    const movementRows = (movements: { code: string; amount: number }[]): CsvValue[][] =>
      movements.map((movement) => [movement.code, movement.amount]);

    const rows: CsvValue[][] = [
      [this.t('REPORTS.EXPORT.CONCEPT'), this.t('REPORTS.EXPORT.AMOUNT')],
      [this.t('REPORTS.EXPORT.OPENING_CASH'), report.openingCash],
      [],
      [this.t('REPORTS.EXPORT.OPERATING')],
      [this.t('REPORTS.EXPORT.NET_INCOME'), report.operating.netIncome],
      ...movementRows(report.operating.nonCashAdjustments),
      ...movementRows(report.operating.workingCapitalChanges),
      [this.t('REPORTS.EXPORT.TOTAL_OPERATING'), report.operating.total],
      [],
      [this.t('REPORTS.EXPORT.INVESTING')],
      ...movementRows(report.investing.movements),
      [this.t('REPORTS.EXPORT.TOTAL_INVESTING'), report.investing.total],
      [],
      [this.t('REPORTS.EXPORT.FINANCING')],
      ...movementRows(report.financing.movements),
      [this.t('REPORTS.EXPORT.TOTAL_FINANCING'), report.financing.total],
      [],
      [this.t('REPORTS.EXPORT.NET_CHANGE_IN_CASH'), report.netChangeInCash],
      [this.t('REPORTS.EXPORT.CLOSING_CASH'), report.closingCash],
      [this.t('REPORTS.EXPORT.UNEXPLAINED_DIFFERENCE'), report.unexplainedDifference],
    ];

    downloadCsv(
      reportFilename('flujo-de-efectivo', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: this.locale,
        preamble: this.preamble(
          this.t('REPORTS.CASH_FLOW.TITULO'),
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
      dimension === 'product' ? 'REPORTS.EXPORT.PRODUCT' : 'REPORTS.EXPORT.CUSTOMER';

    const rows: CsvValue[][] = [
      [
        this.t('REPORTS.EXPORT.CODE'),
        this.t(subjectKey),
        this.t('REPORTS.EXPORT.UNITS_SOLD'),
        this.t('REPORTS.EXPORT.TOTAL_REVENUE'),
        this.t('REPORTS.EXPORT.TOTAL_COST'),
        this.t('REPORTS.EXPORT.GROSS_PROFIT'),
        this.t('REPORTS.EXPORT.GROSS_MARGIN'),
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
        this.t('REPORTS.EXPORT.TOTALS'),
        report.totals.unitsSold,
        report.totals.totalRevenue,
        report.totals.totalCost,
        report.totals.grossProfit,
        report.totals.grossMargin,
      ],
      [],
      ['', this.t('REPORTS.EXPORT.LINES_WITHOUT_COST'), report.linesWithoutCost],
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
                ? 'REPORTS.PROFITABILITY_BY_PRODUCT.PROFITABILITY_BY_PRODUCT'
                : 'REPORTS.PROFITABILITY_BY_CUSTOMER.PROFITABILITY_BY_CUSTOMER',
            ),
          ],
          [this.t('REPORTS.EXPORT.CURRENCY'), report.currency],
          [
            this.t('REPORTS.EXPORT.PERIOD'),
            `${report.period.startDate} – ${report.period.endDate}`,
          ],
          [this.t('REPORTS.EXPORT.GENERATED_AT'), new Date().toISOString()],
          [],
        ],
      }),
    );
  }

}

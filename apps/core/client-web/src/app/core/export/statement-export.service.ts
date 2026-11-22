import { Injectable, inject } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';
import {
  BalanceSheetReport,
  CashFlowStatementReport,
  IncomeStatementReport,
  ReportAccountLine,
  ReportSection,
  TrialBalanceReport,
} from '../../features/reports/data/financial-reporting.service';
import { ProfitabilityReport } from '../api/profitability.service';
import { LocaleStore, VirtexTranslateStore } from '@virtex/shared/ui-i18n';
import { composeKey, isNarrativeRef, localizedNameIn, namesOf, renderNarrative } from '@virtex/shared/types';
import { CsvValue, downloadCsv, reportFilename, toCsv } from './csv-export';
import { GeneralLedger } from '../models/general-ledger.model';

/**
 * The language a statement is exported in (books bilingual).
 *
 * - `reader` — the person exporting it: the controller of a Dominican subsidiary sends the parent
 *   company its balance sheet in English.
 * - `books` — the language the company keeps its books in: the statements a filing, a bank or a
 *   local auditor reads, as the books record them.
 * - `bilingual` — both, side by side («Bancos / Banks»): the group auditor who signs off the local
 *   statements and reads them in the group's language.
 *
 * The figures are the same in all three; only the words change.
 */
export type StatementLanguage = 'reader' | 'books' | 'bilingual';

/** What exporting in one of those needs: its words, its names and the narratives the system wrote. */
interface Reading {
  /** A heading; empty where the catalogue has none — a key in a cell looks like data. */
  t(key: string): string;
  /** A name kept in several languages, or a master's name with its translations. */
  name(value: Record<string, string> | string | null | undefined, translations?: Record<string, string> | null): string;
  /** An account category, by its code. */
  category(code: string | null | undefined): string;
  /** A narrative the system wrote: the record in the books language, rendered in another. */
  narrative(text: string | null | undefined, key?: string | null, params?: Record<string, unknown> | null): string;
  /** The language the figures are written for. */
  language: string;
}

@Injectable({ providedIn: 'root' })
export class StatementExportService {
  /** Names kept in several languages, and the books language. */
  private readonly names = inject(LocaleStore);
  private readonly translate = inject(TranslateService);
  /** Whether a catalogue holds a key, asked of the store every lookup walks. */
  private readonly catalogue = inject(VirtexTranslateStore, { optional: true });

  /**
   * The words, names and narratives of one export.
   *
   * The books language's catalogue is loaded when it is not the interface's — the interface is not
   * switched for it, and its own catalogue is never reloaded.
   */
  private async reading(language: StatementLanguage): Promise<Reading> {
    const reader = this.translate.getCurrentLang() || this.translate.getFallbackLang() || 'es';
    const books = this.names.booksLanguage();
    const languages = language === 'reader' || books === reader ? [reader] : language === 'books' ? [books] : [books, reader];
    for (const lang of languages) await this.ensureLoaded(lang);

    const has = (lang: string, key: string) => (this.catalogue ? this.catalogue.hasKey(lang, key) : this.translate.instant(key, {}, lang) !== key);
    const word = (lang: string, key: string, params: Record<string, unknown> = {}): string | null => {
      if (!has(lang, key)) return null;
      const text: unknown = this.translate.instant(key, params, lang);
      return typeof text === 'string' ? text : null;
    };
    const nameIn = (lang: string, value: Record<string, string> | string | null | undefined, translations?: Record<string, string> | null) =>
      localizedNameIn(translations && (typeof value === 'string' || value == null) ? namesOf(typeof value === 'string' ? value : null, translations, books) : value, lang, books);
    const narrativeIn = (lang: string, text: string | null | undefined, key?: string | null, params?: Record<string, unknown> | null) => {
      const recorded = text ?? '';
      const ref = { key: key ?? '', params: params ?? {} };
      if (lang === books || !key || !isNarrativeRef(ref)) return recorded;
      return renderNarrative(ref, { message: (k, values) => word(lang, k, values), name: (name) => nameIn(lang, name) }) ?? recorded;
    };
    // Two languages read as «Bancos / Banks»; a word that reads the same in both is written once.
    const both = (values: string[]) => [...new Set(values.filter((value) => value !== ''))].join(' / ');

    return {
      t: (key) => both(languages.map((lang) => word(lang, key) ?? '')),
      name: (value, translations) => both(languages.map((lang) => nameIn(lang, value, translations))),
      category: (code) =>
        code ? both(languages.map((lang) => word(lang, composeKey('accounting.categories', code)) ?? code)) : '',
      narrative: (text, key, params) => both(languages.map((lang) => narrativeIn(lang, text, key, params))),
      language: language === 'books' ? books : reader,
    };
  }

  /** A language's catalogue, loaded once; the interface's is already there. */
  private async ensureLoaded(lang: string): Promise<void> {
    const loaded = this.translate.getTranslations(lang) as Record<string, unknown> | undefined;
    if (loaded && Object.keys(loaded).length > 0) return;
    await firstValueFrom(this.translate.reloadLang(lang));
  }

  /** Title, ledger, currency and period, above the table. */
  private preamble(r: Reading, title: string, ledgerName: string, currency: string, period: string[]): CsvValue[][] {
    return [
      [title],
      [r.t('reports.export.ledger'), ledgerName],
      [r.t('reports.export.currency'), currency],
      ...period.map((line) => [r.t('reports.export.period'), line]),
      [r.t('reports.export.generated_at'), new Date().toISOString()],
      [],
    ];
  }

  private lineRows(r: Reading, accounts: ReportAccountLine[]): CsvValue[][] {
    return accounts.map((account) => [account.code, r.name(account.name), r.category(account.category), account.amount]);
  }

  private sectionRows(r: Reading, sections: ReportSection[]): CsvValue[][] {
    return sections.flatMap((section) => [
      [r.category(section.category)],
      ...this.lineRows(r, section.accounts),
      ['', r.t('reports.export.subtotal'), '', section.subtotal],
      [],
    ]);
  }

  private accountHeader(r: Reading): CsvValue[] {
    return [r.t('reports.export.code'), r.t('reports.export.account'), r.t('reports.export.category'), r.t('reports.export.amount')];
  }

  async exportBalanceSheet(report: BalanceSheetReport, language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const rows: CsvValue[][] = [
      this.accountHeader(r),
      [r.t('reports.export.assets')],
      ...this.sectionRows(r, report.assets.sections),
      ['', r.t('reports.export.total_assets'), '', report.assets.total],
      [],
      [r.t('reports.export.liabilities')],
      ...this.sectionRows(r, report.liabilities.sections),
      ['', r.t('reports.export.total_liabilities'), '', report.liabilities.total],
      [],
      [r.t('reports.export.equity')],
      ...this.sectionRows(r, report.equity.sections),
      ['', r.t('reports.export.result_year_not_yet_closed'), '', report.equity.unclosedResult],
      ['', r.t('reports.export.total_equity'), '', report.equity.total],
      [],
      ['', r.t('reports.export.total_liabilities_and_equity'), '', report.totalLiabilitiesAndEquity],
      // Exported deliberately. A statement that does not balance must say so in the file as
      // plainly as it does on the screen; an export that quietly drops the warning is how an
      // unbalanced set of books reaches an auditor looking correct.
      ['', r.t('reports.export.is_balanced'), '', report.isBalanced],
      ['', r.t('reports.export.out_of_balance_by'), '', report.outOfBalanceBy],
    ];

    downloadCsv(
      reportFilename('balance-general', report.asOfDate),
      toCsv(rows, {
        locale: r.language,
        preamble: this.preamble(
          r,
          r.t('reports.balance_sheet.balance_general'),
          r.name(report.ledger.name, report.ledger.nameTranslations),
          report.ledger.currency,
          [report.asOfDate],
        ),
      }),
    );
  }

  async exportIncomeStatement(report: IncomeStatementReport, language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const rows: CsvValue[][] = [
      this.accountHeader(r),
      [r.t('reports.export.revenue')],
      ...this.sectionRows(r, report.revenue.sections),
      ['', r.t('reports.export.total_revenue'), '', report.revenue.total],
      [],
      [r.t('reports.export.cost_of_sales')],
      ...this.lineRows(r, report.costOfSales.accounts),
      ['', r.t('reports.export.total_cost_of_sales'), '', report.costOfSales.total],
      ['', r.t('reports.export.gross_profit'), '', report.grossProfit],
      [],
      [r.t('reports.export.operating_expenses')],
      ...this.lineRows(r, report.operatingExpenses.accounts),
      ['', r.t('reports.export.total_operating_expenses'), '', report.operatingExpenses.total],
      ['', r.t('reports.export.operating_income'), '', report.operatingIncome],
      [],
      [r.t('reports.export.non_operating')],
      ...this.lineRows(r, report.nonOperating.accounts),
      ['', r.t('reports.export.total_non_operating'), '', report.nonOperating.total],
      [],
      ['', r.t('reports.export.net_income'), '', report.netIncome],
    ];

    downloadCsv(
      reportFilename('estado-de-resultados', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: r.language,
        preamble: this.preamble(
          r,
          r.t('reports.income_statement.income_statement'),
          r.name(report.ledger.name, report.ledger.nameTranslations),
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  async exportTrialBalance(report: TrialBalanceReport, language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const rows: CsvValue[][] = [
      [
        r.t('reports.export.code'),
        r.t('reports.export.account'),
        r.t('reports.export.opening_debit'),
        r.t('reports.export.opening_credit'),
        r.t('reports.export.period_debit'),
        r.t('reports.export.period_credit'),
        r.t('reports.export.closing_debit'),
        r.t('reports.export.closing_credit'),
      ],
      ...report.rows.map((row) => [
        row.code,
        r.name(row.name),
        row.openingDebit,
        row.openingCredit,
        row.periodDebit,
        row.periodCredit,
        row.closingDebit,
        row.closingCredit,
      ]),
      [
        '',
        r.t('reports.export.totals'),
        report.totals.openingDebit,
        report.totals.openingCredit,
        report.totals.periodDebit,
        report.totals.periodCredit,
        report.totals.closingDebit,
        report.totals.closingCredit,
      ],
      ['', r.t('reports.export.is_balanced'), report.isBalanced],
    ];

    downloadCsv(
      reportFilename('balance-de-comprobacion', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: r.language,
        preamble: this.preamble(
          r,
          r.t('reports.trial_balance.trial_balance'),
          r.name(report.ledger.name, report.ledger.nameTranslations),
          report.ledger.currency,
          [`${report.period.startDate} – ${report.period.endDate}`],
        ),
      }),
    );
  }

  async exportCashFlow(report: CashFlowStatementReport, language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const label = (movement: { code: string; name?: Record<string, string> | string }) =>
      movement.name ? `${movement.code} ${r.name(movement.name)}` : movement.code;
    const adjustmentRows = (
      movements: { code: string; name?: Record<string, string> | string; amount: number }[],
    ): CsvValue[][] => movements.map((movement) => [label(movement), '', '', movement.amount]);

    // Investing and financing carry their two sides as well as their net, because the export is
    // the file a reader takes to a spreadsheet and the gross presentation IAS 7.21 requires has to
    // survive the trip. A file with only the net is a file the statement cannot be rebuilt from.
    const grossRows = (
      movements: { code: string; name?: Record<string, string> | string; inflow: number; outflow: number; amount: number }[],
    ): CsvValue[][] => movements.map((movement) => [label(movement), movement.inflow, movement.outflow, movement.amount]);

    const rows: CsvValue[][] = [
      [r.t('reports.export.concept'), r.t('reports.cash_flow.inflows'), r.t('reports.cash_flow.outflows'), r.t('reports.export.amount')],
      [r.t('reports.export.opening_cash'), '', '', report.openingCash],
      [],
      [r.t('reports.export.operating')],
      [r.t('reports.export.net_income'), '', '', report.operating.netIncome],
      ...adjustmentRows(report.operating.nonCashAdjustments),
      ...adjustmentRows(report.operating.workingCapitalChanges),
      [r.t('reports.export.total_operating'), '', '', report.operating.total],
      [],
      [r.t('reports.export.investing')],
      ...grossRows(report.investing.movements),
      [r.t('reports.export.total_investing'), report.investing.inflows, report.investing.outflows, report.investing.total],
      [],
      [r.t('reports.export.financing')],
      ...grossRows(report.financing.movements),
      [r.t('reports.export.total_financing'), report.financing.inflows, report.financing.outflows, report.financing.total],
      [],
      [r.t('reports.cash_flow.effect_exchange_rate_changes_cash'), '', '', report.effectOfExchangeRateOnCash],
      [r.t('reports.export.net_change_in_cash'), '', '', report.netChangeInCash],
      [r.t('reports.export.closing_cash'), '', '', report.closingCash],
      [r.t('reports.export.unexplained_difference'), '', '', report.unexplainedDifference],
      // The IAS 7.43 disclosure travels with the statement. Debit and credit, not a cash figure:
      // these transactions had none, which is why they are here rather than in a section above.
      ...(report.nonCashTransactions.length > 0
        ? ([
            [],
            [r.t('reports.cash_flow.investing_financing_transactions_used_no_cash')],
            [r.t('reports.export.code'), r.t('reports.export.debit'), r.t('reports.export.credit')],
            ...report.nonCashTransactions.map((line) => [line.code, line.debit, line.credit]),
          ] as CsvValue[][])
        : []),
    ];

    downloadCsv(
      reportFilename('flujo-de-efectivo', report.period.startDate, report.period.endDate),
      toCsv(rows, {
        locale: r.language,
        preamble: this.preamble(
          r,
          r.t('reports.cash_flow.statement_cash_flows'),
          r.name(report.ledger.name, report.ledger.nameTranslations),
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
  async exportProfitability(report: ProfitabilityReport, dimension: 'product' | 'customer', language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const subjectKey = dimension === 'product' ? 'reports.export.product' : 'reports.export.customer';

    const rows: CsvValue[][] = [
      [
        r.t('reports.export.code'),
        r.t(subjectKey),
        r.t('reports.export.units_sold'),
        r.t('reports.export.total_revenue'),
        r.t('reports.export.total_cost'),
        r.t('reports.export.gross_profit'),
        r.t('reports.export.gross_margin'),
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
        r.t('reports.export.totals'),
        report.totals.unitsSold,
        report.totals.totalRevenue,
        report.totals.totalCost,
        report.totals.grossProfit,
        report.totals.grossMargin,
      ],
      [],
      ['', r.t('reports.export.lines_without_cost'), report.linesWithoutCost],
    ];

    downloadCsv(
      reportFilename(
        dimension === 'product' ? 'rentabilidad-por-producto' : 'rentabilidad-por-cliente',
        report.period.startDate,
        report.period.endDate,
      ),
      toCsv(rows, {
        locale: r.language,
        preamble: [
          [
            r.t(
              dimension === 'product'
                ? 'reports.profitability_by_product.profitability_by_product'
                : 'reports.profitability_by_customer.profitability_by_customer',
            ),
          ],
          [r.t('reports.export.currency'), report.currency],
          [r.t('reports.export.period'), `${report.period.startDate} – ${report.period.endDate}`],
          [r.t('reports.export.generated_at'), new Date().toISOString()],
          [],
        ],
      }),
    );
  }

  /**
   * One account's ledger, as on screen: opening balance, every movement with its running balance,
   * closing balance (QA A-13 — «Exportar» in the general ledger did nothing). The narratives the
   * system wrote are written as the chosen reading reads them: the record in the books language.
   */
  async exportGeneralLedger(ledger: GeneralLedger, from: string, to: string, language: StatementLanguage = 'reader'): Promise<void> {
    const r = await this.reading(language);
    const rows: CsvValue[][] = [
      [
        r.t('accounting.general_ledger.date'),
        r.t('accounting.general_ledger.reference'),
        r.t('accounting.general_ledger.description'),
        r.t('accounting.general_ledger.debit'),
        r.t('accounting.general_ledger.credit'),
        r.t('accounting.general_ledger.balance'),
      ],
      [from, '', r.t('accounting.general_ledger.opening_balance'), '', '', ledger.initialBalance],
      ...ledger.lines.map((line) => [
        line.date,
        line.reference,
        r.narrative(line.description, line.descriptionKey, line.descriptionParams),
        line.debit === null ? '' : Number(line.debit),
        line.credit === null ? '' : Number(line.credit),
        Number(line.balance),
      ]),
      [to, '', r.t('accounting.general_ledger.ending_balance'), '', '', ledger.finalBalance],
    ];
    const account = `${ledger.account.code} ${r.name(ledger.account.name)}`;
    downloadCsv(
      reportFilename('libro-mayor', ledger.account.code, from, to),
      toCsv(rows, {
        locale: r.language,
        preamble: [
          [r.t('accounting.general_ledger.general_ledger')],
          [r.t('accounting.general_ledger.account'), account],
          [r.t('reports.export.period'), `${from} — ${to}`],
          [r.t('reports.export.generated_at'), new Date().toISOString()],
          [],
        ],
      }),
    );
  }
}

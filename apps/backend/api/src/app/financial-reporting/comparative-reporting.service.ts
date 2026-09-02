
import { Injectable } from '@nestjs/common';
import {
  FinancialReportingService,
  DimensionFilters,
  ReportAccountLine,
  balanceSheetAccounts,
  flattenSections,
} from './financial-reporting.service';
import { AccountType } from '../chart-of-accounts/entities/account.entity';

interface ComparativeBalance {
    [ledgerId: string]: number;
}

/**
 * One account, with its balance in each ledger being compared.
 *
 * Built on the report's own account line rather than on the `Account` entity: a comparative report
 * carries what the statements carry — code, name, type, category — and not the entity's twenty-odd
 * operational columns, which were being serialised into the response for every account.
 */
type ComparativeAccount = Omit<ReportAccountLine, 'amount'> & {
    balances: ComparativeBalance;
};

@Injectable()
export class ComparativeReportingService {
  constructor(private readonly financialReportingService: FinancialReportingService) {}

  async getComparativeBalanceSheet(
    organizationId: string,
    asOfDate: Date,
    ledgerIds: string[],
    filters: DimensionFilters = {},
  ) {
    const reports = await Promise.all(
        ledgerIds.map(id => this.financialReportingService.getBalanceSheet(organizationId, asOfDate, filters, id))
    );

    const consolidatedAccounts = new Map<string, ComparativeAccount>();

    for (const report of reports) {
        const allAccounts = balanceSheetAccounts(report);
        for (const account of allAccounts) {
            if (!consolidatedAccounts.has(account.accountId)) {
                const { amount, ...accountData } = account;
                consolidatedAccounts.set(account.accountId, {
                    ...accountData,
                    balances: {},
                });
            }
            const consolidatedAccount = consolidatedAccounts.get(account.accountId)!;
            consolidatedAccount.balances[report.ledger.id] = account.amount;
        }
    }
    
    const finalAccounts = Array.from(consolidatedAccounts.values());

    return {
        asOfDate,
        ledgers: reports.map(r => r.ledger),
        assets: finalAccounts.filter(a => a.type === 'ASSET'),
        liabilities: finalAccounts.filter(a => a.type === 'LIABILITY'),
        equity: finalAccounts.filter(a => a.type === 'EQUITY'),
    };
  }

  async getComparativeIncomeStatement(
    organizationId: string,
    startDate: Date,
    endDate: Date,
    ledgerIds: string[],
    filters: DimensionFilters = {},
  ) {
    const reports = await Promise.all(
        ledgerIds.map(id => this.financialReportingService.getIncomeStatement(organizationId, startDate, endDate, filters, id))
    );

    const consolidatedRevenue = new Map<string, ComparativeAccount>();
    const consolidatedExpenses = new Map<string, ComparativeAccount>();

    for (const report of reports) {
      for (const account of flattenSections(report.revenue.sections)) {
        if (!consolidatedRevenue.has(account.accountId)) {
          const { amount, ...accountData } = account;
          consolidatedRevenue.set(account.accountId, { ...accountData, balances: {} });
        }
        consolidatedRevenue.get(account.accountId)!.balances[report.ledger.id] = account.amount;
      }
      const expenseLines = [
        ...report.costOfSales.accounts,
        ...report.operatingExpenses.accounts,
        ...report.nonOperating.accounts,
      ];
      for (const account of expenseLines) {
        if (!consolidatedExpenses.has(account.accountId)) {
          const { amount, ...accountData } = account;
          consolidatedExpenses.set(account.accountId, { ...accountData, balances: {} });
        }
        consolidatedExpenses.get(account.accountId)!.balances[report.ledger.id] = account.amount;
      }
    }

    return {
      period: { startDate, endDate },
      ledgers: reports.map(r => r.ledger),
      revenue: Array.from(consolidatedRevenue.values()),
      expenses: Array.from(consolidatedExpenses.values()),
      netIncome: reports.reduce((acc, report) => {
        acc[report.ledger.id] = report.netIncome;
        return acc;
      }, {} as Record<string, number>)
    };
  }
}
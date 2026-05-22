
import { Injectable } from '@nestjs/common';
import { FinancialReportingService, DimensionFilters } from './financial-reporting.service';
import { Account, AccountType } from '../chart-of-accounts/entities/account.entity';

interface ComparativeBalance {
    [ledgerId: string]: number;
}

interface ComparativeAccount extends Omit<Account, 'balances'> {
    balances: ComparativeBalance;
}

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
        const allAccounts = [...report.assets, ...report.liabilities, ...report.equity];
        for (const account of allAccounts) {
            if (!consolidatedAccounts.has(account.id)) {
                const { balances, balance, ...accountData } = account;
                consolidatedAccounts.set(account.id, {
                    ...accountData,
                    code: account.code,
                    balances: {},
                });
            }
            const consolidatedAccount = consolidatedAccounts.get(account.id)!;
            consolidatedAccount.balances[report.ledger.id] = account.balance;
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
      for (const account of report.revenue.accounts) {
        if (!consolidatedRevenue.has(account.id)) {
          const { balance, ...accountData } = account;
          consolidatedRevenue.set(account.id, { ...accountData, balances: {} });
        }
        consolidatedRevenue.get(account.id)!.balances[report.ledger.id] = account.balance;
      }
      for (const account of report.expenses.accounts) {
        if (!consolidatedExpenses.has(account.id)) {
          const { balance, ...accountData } = account;
          consolidatedExpenses.set(account.id, { ...accountData, balances: {} });
        }
        consolidatedExpenses.get(account.id)!.balances[report.ledger.id] = account.balance;
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
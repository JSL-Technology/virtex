
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, DataSource, LessThanOrEqual } from 'typeorm';
import { Account, AccountType, AccountCategory } from '../chart-of-accounts/entities/account.entity';
import { JournalEntryLine } from '../journal-entries/entities/journal-entry-line.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { MonthlyAccountBalance } from '../reporting/entities/monthly-account-balance.entity';
import { subDays } from 'date-fns';
import { Ledger } from '../accounting/entities/ledger.entity';

export type DimensionFilters = Record<string, string>;

export interface BalanceSheetReport {
  asOfDate: Date;
  filters: DimensionFilters;
  ledger: { id: string; name: string };
  assets: (Account & { balance: number })[];
  liabilities: (Account & { balance: number })[];
  equity: (Account & { balance: number })[];
  netIncomeForPeriod: number;
}

@Injectable()
export class FinancialReportingService {

  constructor(
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
    @InjectRepository(JournalEntryLine)
    private readonly journalEntryLineRepository: Repository<JournalEntryLine>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(MonthlyAccountBalance)
    private readonly monthlyBalanceRepository: Repository<MonthlyAccountBalance>,
    private readonly dataSource: DataSource,
  ) {}

  private async _resolveLedger(organizationId: string, ledgerId?: string): Promise<Ledger> {
    const ledgerRepo = this.dataSource.getRepository(Ledger);
    let ledger: Ledger | null;

    if (ledgerId) {
      ledger = await ledgerRepo.findOneBy({ id: ledgerId, organizationId });
      if (!ledger) {
        throw new NotFoundException(`El libro contable con ID "${ledgerId}" no fue encontrado o no pertenece a su organización.`);
      }
    } else {
      ledger = await ledgerRepo.findOneBy({ organizationId, isDefault: true });
      if (!ledger) {
        throw new BadRequestException('No se ha especificado un libro contable y no hay uno configurado por defecto para la organización.');
      }
    }
    return ledger;
  }

  async getBalanceSheet(organizationId: string, asOfDate: Date, filters: DimensionFilters = {}, ledgerId?: string): Promise<BalanceSheetReport> {
    const targetLedger = await this._resolveLedger(organizationId, ledgerId);

    if (Object.keys(filters).length > 0) {
      return this.getBalanceSheetFromJournal(organizationId, asOfDate, filters, targetLedger);
    }

    const year = asOfDate.getFullYear();
    const month = asOfDate.getMonth() + 1;

    const accounts = await this.accountRepository.find({
        where: { organizationId, type: In([AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY]) },
        relations: ['segments']
    });



    const accountMap = new Map(accounts.map(acc => [acc.id, Object.assign(new Account(), { ...acc, balance: 0 })]));


    const qb = this.dataSource.createQueryBuilder()
      .select('DISTINCT ON (mb.accountId) mb.*')
      .from(MonthlyAccountBalance, 'mb')
      .where('mb.organizationId = :organizationId', { organizationId })
      .andWhere('mb.ledgerId = :ledgerId', { ledgerId: targetLedger.id })
      .andWhere('(mb.year < :year OR (mb.year = :year AND mb.month <= :month))', { year, month })
      .orderBy('mb.accountId')
      .addOrderBy('mb.year', 'DESC')
      .addOrderBy('mb.month', 'DESC');

    const latestBalances: MonthlyAccountBalance[] = await qb.getRawMany();

    for (const balance of latestBalances) {
        const account = accountMap.get(balance.accountId);
        if (account) {
            account.balance = parseFloat(balance.endBalance as any);
        }
    }

    const netIncome = await this.calculateNetIncome(organizationId, new Date(asOfDate.getFullYear(), 0, 1), asOfDate, filters, targetLedger.id);
    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });

    if (settings && settings.defaultRetainedEarningsAccountId) {
        const retainedEarningsAccount = accountMap.get(settings.defaultRetainedEarningsAccountId);
        if (retainedEarningsAccount) {
            retainedEarningsAccount.balance += netIncome;
        }
    }

    const finalAccounts = Array.from(accountMap.values());

    return {
        asOfDate,
        filters,
        ledger: { id: targetLedger.id, name: targetLedger.name },
        assets: finalAccounts.filter(a => a.type === AccountType.ASSET),
        liabilities: finalAccounts.filter(a => a.type === AccountType.LIABILITY),
        equity: finalAccounts.filter(a => a.type === AccountType.EQUITY),
        netIncomeForPeriod: netIncome,
    };
  }
  
  async getIncomeStatement(organizationId: string, startDate: Date, endDate: Date, filters: DimensionFilters = {}, ledgerId?: string) {
      const targetLedger = await this._resolveLedger(organizationId, ledgerId);

      if (Object.keys(filters).length > 0) {
          return this.getIncomeStatementFromJournal(organizationId, startDate, endDate, filters, targetLedger);
      }

      const startYear = startDate.getFullYear();
      const startMonth = startDate.getMonth() + 1;
      const endYear = endDate.getFullYear();
      const endMonth = endDate.getMonth() + 1;

      const movements = await this.monthlyBalanceRepository.createQueryBuilder('mb')
          .innerJoinAndSelect('mb.account', 'account')
          .where('mb.organizationId = :organizationId', { organizationId })
          .andWhere('mb.ledgerId = :ledgerId', { ledgerId: targetLedger.id })
          .andWhere('account.type IN (:...types)', { types: [AccountType.REVENUE, AccountType.EXPENSE] })
          .andWhere(`(mb.year || '-' || LPAD(mb.month::text, 2, '0')) BETWEEN :startPeriod AND :endPeriod`, {
              startPeriod: `${startYear}-${String(startMonth).padStart(2, '0')}`,
              endPeriod: `${endYear}-${String(endMonth).padStart(2, '0')}`,
          })
          .select([
              'account.id AS id', 'account.code AS code', 'account.name AS name', 'account.type AS type', 'account.category AS category',
              'SUM(mb.netChange) AS balance'
          ])
          .groupBy('account.id, account.code, account.name, account.type, account.category')
          .getRawMany();

      const revenueAccounts: any[] = [];
      const expenseAccounts: any[] = [];
      let totalRevenue = 0;
      let totalExpenses = 0;

      for (const move of movements) {
          const balance = parseFloat(move.balance);
          if (move.type === AccountType.REVENUE) {
              const finalBalance = balance * -1;
              revenueAccounts.push({ ...move, balance: finalBalance });
              totalRevenue += finalBalance;
          } else if (move.type === AccountType.EXPENSE) {
              expenseAccounts.push({ ...move, balance });
              totalExpenses += balance;
          }
      }
      
      return {
          period: { startDate, endDate },
          filters,
          ledger: { id: targetLedger.id, name: targetLedger.name },
          revenue: { accounts: revenueAccounts, total: totalRevenue },
          expenses: { accounts: expenseAccounts, total: totalExpenses },
          netIncome: totalRevenue - totalExpenses
      };
  }

  async getCashFlowStatement(organizationId: string, startDate: Date, endDate: Date, ledgerId?: string) {
    const targetLedger = await this._resolveLedger(organizationId, ledgerId);

    const netIncome = await this.calculateNetIncome(organizationId, startDate, endDate, {}, targetLedger.id);
    const nonCashCharges = await this.getNonCashCharges(organizationId, startDate, endDate, targetLedger.id);
    const changesInWorkingCapital = await this.getChangesInWorkingCapital(organizationId, startDate, endDate, targetLedger.id);
    const cashFromOperations = netIncome + nonCashCharges + changesInWorkingCapital.total;
    const cashFromInvesting = await this.getInvestingActivities(organizationId, startDate, endDate, targetLedger.id);
    const cashFromFinancing = await this.getFinancingActivities(organizationId, startDate, endDate, targetLedger.id);
    const netCashFlow = cashFromOperations + cashFromInvesting + cashFromFinancing;

    return {
      period: { startDate, endDate },
      ledger: { id: targetLedger.id, name: targetLedger.name },
      operatingActivities: {
        netIncome,
        adjustments: { nonCashCharges, changesInWorkingCapital },
        netCashFromOperations: cashFromOperations,
      },
      investingActivities: {
        netCashFromInvesting: cashFromInvesting,
      },
      financingActivities: {
        netCashFromFinancing: cashFromFinancing,
      },
      netCashFlow,
    };
  }
  
  private async getBalanceSheetFromJournal(organizationId: string, asOfDate: Date, filters: DimensionFilters, ledger: Ledger): Promise<BalanceSheetReport> {
    const accounts = await this.accountRepository.find({
        where: { organizationId, type: In([AccountType.ASSET, AccountType.LIABILITY, AccountType.EQUITY]) },
        relations: ['segments']
    });



    const accountMap = new Map(accounts.map(acc => [acc.id, Object.assign(new Account(), { ...acc, balance: 0 })]));


    const accountIds = Array.from(accountMap.keys());

    if (accountIds.length === 0) {
        return { asOfDate, assets: [], liabilities: [], equity: [], netIncomeForPeriod: 0, filters, ledger: { id: ledger.id, name: ledger.name } };
    }

    const movementsQuery = this.dataSource.createQueryBuilder()
        .from(JournalEntryLine, 'line')
        .innerJoin('line.journalEntry', 'entry')
        .innerJoin('line.valuations', 'valuation')
        .where('entry.organizationId = :organizationId', { organizationId })
        .andWhere('entry.date <= :asOfDate', { asOfDate: asOfDate.toISOString().split('T')[0] })
        .andWhere('line.accountId IN (:...accountIds)', { accountIds })
        .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id });

    for (const dimensionId in filters) {
        if (filters.hasOwnProperty(dimensionId)) {
            const dimensionValueId = filters[dimensionId];
            movementsQuery.andWhere(`line.dimensions ->> :dimensionId = :dimensionValueId`, {
                dimensionId,
                dimensionValueId
            });
        }
    }

    const movements = await movementsQuery
        .select(['line.accountId AS accountId', 'SUM(valuation.debit - valuation.credit) AS balance'])
        .groupBy('line.accountId')
        .getRawMany();

    for (const move of movements) {
        const account = accountMap.get(move.accountId);
        if (account) {
            account.balance = parseFloat(move.balance);
        }
    }

    const netIncome = await this.calculateNetIncome(organizationId, new Date(asOfDate.getFullYear(), 0, 1), asOfDate, filters, ledger.id);
    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });

    if (settings && settings.defaultRetainedEarningsAccountId) {
        const retainedEarningsAccount = accountMap.get(settings.defaultRetainedEarningsAccountId);
        if (retainedEarningsAccount) {
            retainedEarningsAccount.balance += netIncome;
        }
    }

    const finalAccounts = Array.from(accountMap.values());

    return {
        asOfDate,
        filters,
        ledger: { id: ledger.id, name: ledger.name },
        assets: finalAccounts.filter(a => a.type === AccountType.ASSET),
        liabilities: finalAccounts.filter(a => a.type === AccountType.LIABILITY),
        equity: finalAccounts.filter(a => a.type === AccountType.EQUITY),
        netIncomeForPeriod: netIncome,
    };
  }
  
  private async getIncomeStatementFromJournal(organizationId: string, startDate: Date, endDate: Date, filters: DimensionFilters, ledger: Ledger) {
      const movementsQuery = this.dataSource.createQueryBuilder()
          .from(JournalEntryLine, 'line')
          .innerJoin('line.account', 'account')
          .innerJoin('line.journalEntry', 'entry')
          .innerJoin('line.valuations', 'valuation')
          .where('entry.organizationId = :organizationId', { organizationId })
          .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
          .andWhere('account.type IN (:...types)', { types: [AccountType.REVENUE, AccountType.EXPENSE] })
          .andWhere('valuation.ledgerId = :ledgerId', { ledgerId: ledger.id });
      
      for (const dimensionId in filters) {
        if (filters.hasOwnProperty(dimensionId)) {
            const dimensionValueId = filters[dimensionId];
            movementsQuery.andWhere(`line.dimensions ->> :dimensionId = :dimensionValueId`, {
                dimensionId,
                dimensionValueId
            });
        }
      }

      const movements = await movementsQuery
          .select([
              'account.id AS id', 'account.code AS code', 'account.name AS name', 'account.type AS type', 'account.category AS category',
              'SUM(valuation.debit) AS totalDebit', 'SUM(valuation.credit) AS totalCredit'
          ])
          .groupBy('account.id, account.code, account.name, account.type, account.category')
          .getRawMany();

      const revenueAccounts: any[] = [];
      const expenseAccounts: any[] = [];
      let totalRevenue = 0;
      let totalExpenses = 0;

      for (const move of movements) {
          if (move.type === AccountType.REVENUE) {
              const balance = parseFloat(move.totalCredit) - parseFloat(move.totalDebit);
              revenueAccounts.push({ ...move, balance });
              totalRevenue += balance;
          } else if (move.type === AccountType.EXPENSE) {
              const balance = parseFloat(move.totalDebit) - parseFloat(move.totalCredit);
              expenseAccounts.push({ ...move, balance });
              totalExpenses += balance;
          }
      }
      
      return {
          period: { startDate, endDate },
          filters,
          ledger: { id: ledger.id, name: ledger.name },
          revenue: { accounts: revenueAccounts, total: totalRevenue },
          expenses: { accounts: expenseAccounts, total: totalExpenses },
          netIncome: totalRevenue - totalExpenses
      };
  }

  private async getWorkingCapitalBalances(organizationId: string, asOfDate: Date, ledgerId: string): Promise<{ accountsReceivable: number, inventory: number, accountsPayable: number }> {
      const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
      if (!settings) {
          return { accountsReceivable: 0, inventory: 0, accountsPayable: 0 };
      }

      const accountIds = [
          settings.defaultAccountsReceivableId,
          settings.defaultInventoryId,
          settings.defaultAccountsPayableId
      ].filter(Boolean) as string[];

      if (accountIds.length === 0) {
          return { accountsReceivable: 0, inventory: 0, accountsPayable: 0 };
      }

      const balances = await this.dataSource.createQueryBuilder()
          .from(JournalEntryLine, 'line')
          .innerJoin('line.journalEntry', 'entry')
          .innerJoin('line.valuations', 'valuation')
          .where('entry.organizationId = :organizationId', { organizationId })
          .andWhere('entry.date <= :asOfDate', { asOfDate })
          .andWhere('line.accountId IN (:...accountIds)', { accountIds })
          .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
          .select('line.accountId AS accountId, SUM(valuation.debit - valuation.credit) AS balance')
          .groupBy('line.accountId')
          .getRawMany();

      const balanceMap = new Map(balances.map(b => [b.accountId, parseFloat(b.balance)]));

      return {
          accountsReceivable: balanceMap.get(settings.defaultAccountsReceivableId!) || 0,
          inventory: balanceMap.get(settings.defaultInventoryId!) || 0,
          accountsPayable: (balanceMap.get(settings.defaultAccountsPayableId!) || 0),
      };
  }

  public async getInvestingActivities(organizationId: string, startDate: Date, endDate: Date, ledgerId: string): Promise<number> {
      const fixedAssetAccounts = await this.accountRepository.find({
          where: { organizationId, category: AccountCategory.NON_CURRENT_ASSET }
      });
      const fixedAssetAccountIds = fixedAssetAccounts.map(a => a.id);

      if (fixedAssetAccountIds.length === 0) return 0;
      
      const result = await this.dataSource.createQueryBuilder()
        .from(JournalEntryLine, 'line')
        .innerJoin('line.journalEntry', 'entry')
        .innerJoin('line.valuations', 'valuation')
        .where('entry.organizationId = :organizationId', { organizationId })
        .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
        .andWhere('line.accountId IN (:...fixedAssetAccountIds)', { fixedAssetAccountIds })
        .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
        .select('SUM(valuation.debit - valuation.credit)', 'netChange')
        .getRawOne();
        
      return (parseFloat(result?.netChange) || 0) * -1;
  }

  public async getFinancingActivities(organizationId: string, startDate: Date, endDate: Date, ledgerId: string): Promise<number> {
      const financingAccounts = await this.accountRepository.find({
          where: [
              { organizationId, type: AccountType.EQUITY },
              { organizationId, category: AccountCategory.NON_CURRENT_LIABILITY }
          ]
      });
      const financingAccountIds = financingAccounts.map(a => a.id);

      if (financingAccountIds.length === 0) return 0;

      const result = await this.dataSource.createQueryBuilder()
        .from(JournalEntryLine, 'line')
        .innerJoin('line.journalEntry', 'entry')
        .innerJoin('line.valuations', 'valuation')
        .where('entry.organizationId = :organizationId', { organizationId })
        .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
        .andWhere('line.accountId IN (:...financingAccountIds)', { financingAccountIds })
        .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
        .select('SUM(valuation.credit - valuation.debit)', 'netChange')
        .getRawOne();
        
      return parseFloat(result?.netChange) || 0;
  }

  private async getChangesInWorkingCapital(organizationId: string, startDate: Date, endDate: Date, ledgerId: string) {
      const startBalances = await this.getWorkingCapitalBalances(organizationId, subDays(startDate, 1), ledgerId);
      const endBalances = await this.getWorkingCapitalBalances(organizationId, endDate, ledgerId);
      
      const changes = {
          accountsReceivable: (startBalances.accountsReceivable || 0) - (endBalances.accountsReceivable || 0),
          inventory: (startBalances.inventory || 0) - (endBalances.inventory || 0),
          accountsPayable: (endBalances.accountsPayable || 0) - (startBalances.accountsPayable || 0),
          total: 0
      };
      
      changes.total = changes.accountsReceivable + changes.inventory + changes.accountsPayable;
      return changes;
  }

  private async getNonCashCharges(organizationId: string, startDate: Date, endDate: Date, ledgerId: string): Promise<number> {
    const settings = await this.orgSettingsRepository.findOneBy({ organizationId });
    if (!settings?.defaultDepreciationExpenseAccountId) return 0;

    const result = await this.dataSource.createQueryBuilder()
      .from(JournalEntryLine, 'line')
      .innerJoin('line.journalEntry', 'entry')
      .innerJoin('line.valuations', 'valuation')
      .where('entry.organizationId = :organizationId', { organizationId })
      .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
      .andWhere('line.accountId = :depreciationAccountId', { depreciationAccountId: settings.defaultDepreciationExpenseAccountId })
      .andWhere('valuation.ledgerId = :ledgerId', { ledgerId })
      .select('SUM(valuation.debit - valuation.credit)', 'total')
      .getRawOne();
      
    return parseFloat(result?.total) || 0;
  }

  private async calculateNetIncome(organizationId: string, startDate: Date, endDate: Date, filters: DimensionFilters = {}, ledgerId: string): Promise<number> {
      const query = this.dataSource.createQueryBuilder()
          .from(JournalEntryLine, 'line')
          .innerJoin('line.journalEntry', 'entry')
          .innerJoin('line.account', 'account')
          .innerJoin('line.valuations', 'valuation')
          .where('entry.organizationId = :organizationId', { organizationId })
          .andWhere('entry.date BETWEEN :startDate AND :endDate', { startDate, endDate })
          .andWhere('account.type IN (:...types)', { types: [AccountType.REVENUE, AccountType.EXPENSE] })
          .andWhere('valuation.ledgerId = :ledgerId', { ledgerId });

      for (const dimensionId in filters) {
        if (filters.hasOwnProperty(dimensionId)) {
            const dimensionValueId = filters[dimensionId];
            query.andWhere(`line.dimensions ->> :dimensionId = :dimensionValueId`, {
                dimensionId,
                dimensionValueId
            });
        }
      }

      const result = await query
          .select([
              'SUM(CASE WHEN account.type = :revenue THEN valuation.credit - valuation.debit ELSE 0 END) AS totalRevenue',
              'SUM(CASE WHEN account.type = :expense THEN valuation.debit - valuation.credit ELSE 0 END) AS totalExpense',
          ])
          .setParameters({ revenue: AccountType.REVENUE, expense: AccountType.EXPENSE })
          .getRawOne();
          
      return (parseFloat(result?.totalRevenue) || 0) - (parseFloat(result?.totalExpense) || 0);
  }
}
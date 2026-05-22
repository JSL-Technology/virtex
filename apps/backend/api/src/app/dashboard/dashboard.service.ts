
import { Injectable, Inject, BadRequestException, NotFoundException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import * as cacheManager_1 from 'cache-manager';
import { ChartOfAccountsService } from '../chart-of-accounts/chart-of-accounts.service';
import { InventoryService } from '../inventory/inventory.service';
import { AccountType, AccountCategory } from '../chart-of-accounts/enums/account-enums';
import { QuickRatioDto } from './dto/quick-ratio.dto';
import { WorkingCapitalDto } from './dto/working-capital.dto';
import { CurrentRatioDto } from './dto/current-ratio.dto';
import { RoadDto } from './dto/roa.dto';
import { RoeDto } from './dto/roe.dto';
import { LeverageDto } from './dto/leverage.dto';
import { NetMarginDto } from './dto/net-margin.dto';
import { EbitdaDto } from './dto/ebitda.dto';
import { FcfDto } from './dto/fcf.dto';
import { Ledger } from '../accounting/entities/ledger.entity';
import { DataSource, Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { CashFlowWaterfallDto } from './dto/cash-flow-waterfall.dto';
import { startOfYear, endOfDay } from 'date-fns';

@Injectable()
export class DashboardService {
  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly inventoryService: InventoryService,
    @Inject(CACHE_MANAGER) private cacheManager: cacheManager_1.Cache,
    private readonly dataSource: DataSource,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly financialReportingService: FinancialReportingService,
  ) {}

  private async getFinancialMetrics(organizationId: string) {
    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestException('No se ha configurado un libro contable por defecto para la organización.');
    }

    const allAccounts = await this.chartOfAccountsService.findAllForOrg(organizationId);

    let totalAssets = 0;
    let currentAssets = 0;
    let totalLiabilities = 0;
    let currentLiabilities = 0;
    let totalEquity = 0;
    let revenue = 0;
    let expenses = 0;

    for (const account of allAccounts) {
      const balanceRecord = account.balances.find(b => b.ledgerId === defaultLedger.id);
      const balance = balanceRecord ? Number(balanceRecord.balance) : 0;

      switch (account.type) {
        case AccountType.ASSET:
          totalAssets += balance;
          if (account.category === AccountCategory.CURRENT_ASSET) {
            currentAssets += balance;
          }
          break;
        case AccountType.LIABILITY:
          totalLiabilities += balance;
          if (account.category === AccountCategory.CURRENT_LIABILITY) {
            currentLiabilities += balance;
          }
          break;
        case AccountType.EQUITY:
          totalEquity += balance;
          break;
        case AccountType.REVENUE:
          revenue += balance;
          break;
        case AccountType.EXPENSE:
          expenses += balance;
          break;
      }
    }

    const netIncome = revenue - expenses;
    const workingCapital = currentAssets - currentLiabilities;

    return {
      totalAssets,
      currentAssets,
      totalLiabilities,
      currentLiabilities,
      totalEquity,
      revenue,
      netIncome,
      workingCapital
    };
  }

  async getQuickRatio(organizationId: string): Promise<QuickRatioDto> {
    const cacheKey = `quick-ratio:${organizationId}`;
    const cachedData = await this.cacheManager.get<QuickRatioDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { currentAssets, currentLiabilities } = await this.getFinancialMetrics(organizationId);
    const products = await this.inventoryService.findAll(organizationId);
    const inventoryValue = products.reduce((sum, p) => sum + p.cost * p.stock, 0);

    const quickAssets = currentAssets - inventoryValue;
    const quickRatio = currentLiabilities > 0 ? quickAssets / currentLiabilities : 0;

    const result = {
      quickRatio: parseFloat(quickRatio.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getLeverage(organizationId: string): Promise<LeverageDto> {
    const cacheKey = `leverage:${organizationId}`;
    const cachedData = await this.cacheManager.get<LeverageDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { totalLiabilities, totalEquity } = await this.getFinancialMetrics(organizationId);
    const leverage = totalEquity > 0 ? totalLiabilities / totalEquity : 0;

    const result = {
      leverage: parseFloat(leverage.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getNetMargin(organizationId: string): Promise<NetMarginDto> {
    const cacheKey = `net-margin:${organizationId}`;
    const cachedData = await this.cacheManager.get<NetMarginDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { netIncome, revenue } = await this.getFinancialMetrics(organizationId);
    const netMargin = revenue > 0 ? (netIncome / revenue) * 100 : 0;

    const result = {
      netMargin: parseFloat(netMargin.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getEBITDA(organizationId: string): Promise<EbitdaDto> {
    const cacheKey = `ebitda:${organizationId}`;
    const cachedData = await this.cacheManager.get<EbitdaDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }




    const { netIncome } = await this.getFinancialMetrics(organizationId);

    const result = {
      ebitda: parseFloat(netIncome.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getFreeCashFlow(organizationId: string): Promise<FcfDto> {
    const cacheKey = `fcf:${organizationId}`;
    const cachedData = await this.cacheManager.get<FcfDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }




    const { netIncome, workingCapital } = await this.getFinancialMetrics(organizationId);
    const freeCashFlow = netIncome - workingCapital;

    const result = {
      freeCashFlow: parseFloat(freeCashFlow.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getROE(organizationId: string): Promise<RoeDto> {
    const cacheKey = `roe:${organizationId}`;
    const cachedData = await this.cacheManager.get<RoeDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { netIncome, totalAssets, totalLiabilities } = await this.getFinancialMetrics(organizationId);
    const shareholderEquity = totalAssets - totalLiabilities;
    const roe = shareholderEquity > 0 ? (netIncome / shareholderEquity) * 100 : 0;

    const result = {
      roe: parseFloat(roe.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getROA(organizationId: string): Promise<RoadDto> {
    const cacheKey = `roa:${organizationId}`;
    const cachedData = await this.cacheManager.get<RoadDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { netIncome, totalAssets } = await this.getFinancialMetrics(organizationId);




    const roa = totalAssets > 0 ? (netIncome / totalAssets) * 100 : 0;

    const result = {
      roa: parseFloat(roa.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getCurrentRatio(organizationId: string): Promise<CurrentRatioDto> {
    const cacheKey = `current-ratio:${organizationId}`;
    const cachedData = await this.cacheManager.get<CurrentRatioDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { currentAssets, currentLiabilities } = await this.getFinancialMetrics(organizationId);
    const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0;

    const result = {
      currentRatio: parseFloat(currentRatio.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getWorkingCapital(organizationId: string): Promise<WorkingCapitalDto> {
    const cacheKey = `working-capital:${organizationId}`;
    const cachedData = await this.cacheManager.get<WorkingCapitalDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const { workingCapital } = await this.getFinancialMetrics(organizationId);

    const result = {
      workingCapital: parseFloat(workingCapital.toFixed(2)),
      date: new Date(),
    };

    await this.cacheManager.set(cacheKey, result, 3600);

    return result;
  }

  async getConsolidatedCashFlowWaterfall(parentOrganizationId: string): Promise<CashFlowWaterfallDto> {
    const parentOrg = await this.organizationRepository.findOne({
        where: { id: parentOrganizationId },
        relations: ['subsidiaries', 'subsidiaries.subsidiary'],
    });

    if (!parentOrg) {
        throw new NotFoundException('Organización matriz no encontrada.');
    }

    const organizationIds = [parentOrganizationId, ...parentOrg.subsidiaries.map(s => s.subsidiary.id)];
    const today = new Date();
    const startDate = startOfYear(today);
    const endDate = endOfDay(today);

    const consolidatedData: Omit<CashFlowWaterfallDto, 'endingBalance'> = {
        openingBalance: 0,
        operatingIncome: 0,
        costOfGoodsSold: 0,
        operatingExpenses: 0,
        investments: 0,
        financing: 0,
    };

    for (const orgId of organizationIds) {

        const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId: orgId, isDefault: true });
        if (!defaultLedger) {
            console.warn(`Omitiendo organización ${orgId} de la consolidación: no tiene un libro contable por defecto.`);
            continue;
        }

        
        const openingBalanceSheet = await this.financialReportingService.getBalanceSheet(orgId, startDate, {}, defaultLedger.id);
        const cashAccounts = openingBalanceSheet.assets.filter(a => a.category === AccountCategory.CURRENT_ASSET);
        consolidatedData.openingBalance += cashAccounts.reduce((sum, acc) => sum + acc.balance, 0);

        const incomeStatement = await this.financialReportingService.getIncomeStatement(orgId, startDate, endDate, {}, defaultLedger.id);
        consolidatedData.operatingIncome += incomeStatement.revenue.total;

        const cogsAccounts = incomeStatement.expenses.accounts.filter(a => a.category === AccountCategory.COST_OF_GOODS_SOLD);
        const otherExpensesAccounts = incomeStatement.expenses.accounts.filter(a => a.category !== AccountCategory.COST_OF_GOODS_SOLD);

        consolidatedData.costOfGoodsSold += cogsAccounts.reduce((sum, acc) => sum + acc.balance, 0);
        consolidatedData.operatingExpenses += otherExpensesAccounts.reduce((sum, acc) => sum + acc.balance, 0);


        consolidatedData.investments += await this.financialReportingService.getInvestingActivities(orgId, startDate, endDate, defaultLedger.id);
        consolidatedData.financing += await this.financialReportingService.getFinancingActivities(orgId, startDate, endDate, defaultLedger.id);

    }

    const endingBalance =
        consolidatedData.openingBalance +
        consolidatedData.operatingIncome -
        consolidatedData.costOfGoodsSold -
        consolidatedData.operatingExpenses +
        consolidatedData.investments +
        consolidatedData.financing;

    return {
        ...consolidatedData,
        costOfGoodsSold: -consolidatedData.costOfGoodsSold,
        operatingExpenses: -consolidatedData.operatingExpenses,
        endingBalance,
    };
  }
}
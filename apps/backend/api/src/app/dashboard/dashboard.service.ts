
import { Injectable, Inject, Logger } from '@nestjs/common';
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
import {
  AccountBalancesService,
  toNaturalAmount,
} from '../chart-of-accounts/account-balances.service';
import { roundAmount } from '../common/money';
import { FinancialReportingService } from '../financial-reporting/financial-reporting.service';
import { CashFlowWaterfallDto } from './dto/cash-flow-waterfall.dto';
import { startOfYear, endOfDay } from 'date-fns';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly chartOfAccountsService: ChartOfAccountsService,
    private readonly inventoryService: InventoryService,
    @Inject(CACHE_MANAGER) private cacheManager: cacheManager_1.Cache,
    private readonly dataSource: DataSource,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    private readonly financialReportingService: FinancialReportingService,
    private readonly accountBalances: AccountBalancesService,
  ) {}

  private async getFinancialMetrics(organizationId: string) {
    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
        throw new BadRequestError('DASHBOARD.NO_HA_CONFIGURADO_LIBRO_CONTABLE_DEFECTO_ORGANIZACION');
    }

    // Signed balances, `debit − credit`, straight from the journal. The previous version summed
    // `account.balances`, a stored per-ledger figure maintained asynchronously, and added revenue
    // to a running total without negating it — so `revenue` came out negative and `netIncome`
    // computed as `revenue − expenses` was `−(revenue + expenses)`. Every KPI built on it (ROE,
    // margins, free cash flow) carried that error.
    const accounts = await this.chartOfAccountsService.findAllForOrg(organizationId);
    const asOf = new Date();
    const balances = await this.accountBalances.balancesAsOf({
      organizationId,
      ledgerId: defaultLedger.id,
      asOf,
    });

    let totalAssets = 0;
    let currentAssets = 0;
    let totalLiabilities = 0;
    let currentLiabilities = 0;
    let totalEquity = 0;
    let revenue = 0;
    let expenses = 0;

    for (const account of accounts) {
      const signed = balances.get(account.id) ?? 0;
      if (signed === 0) continue;
      const natural = toNaturalAmount(account.type, signed);

      switch (account.type) {
        case AccountType.ASSET:
          totalAssets += natural;
          if (account.category === AccountCategory.CURRENT_ASSET) currentAssets += natural;
          break;
        case AccountType.LIABILITY:
          totalLiabilities += natural;
          if (account.category === AccountCategory.CURRENT_LIABILITY) {
            currentLiabilities += natural;
          }
          break;
        case AccountType.EQUITY:
          totalEquity += natural;
          break;
        case AccountType.REVENUE:
          revenue += natural;
          break;
        case AccountType.EXPENSE:
          expenses += natural;
          break;
      }
    }

    const netIncome = roundAmount(revenue - expenses);
    const workingCapital = roundAmount(currentAssets - currentLiabilities);

    return {
      totalAssets: roundAmount(totalAssets),
      currentAssets: roundAmount(currentAssets),
      totalLiabilities: roundAmount(totalLiabilities),
      currentLiabilities: roundAmount(currentLiabilities),
      totalEquity: roundAmount(totalEquity),
      revenue: roundAmount(revenue),
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
        throw new NotFoundError('DASHBOARD.ORGANIZACION_MATRIZ_NO_ENCONTRADA');
    }

    const organizationIds = [parentOrganizationId, ...parentOrg.subsidiaries.map(s => s.subsidiary.id)];
    const today = new Date();
    const startDate = startOfYear(today);
    const endDate = endOfDay(today);

    const consolidated = {
      openingBalance: 0,
      operating: 0,
      investing: 0,
      financing: 0,
      endingBalance: 0,
    };

    for (const orgId of organizationIds) {
      const defaultLedger = await this.dataSource
        .getRepository(Ledger)
        .findOneBy({ organizationId: orgId, isDefault: true });
      if (!defaultLedger) {
        this.logger.warn(
          `Se omite la organización ${orgId} de la consolidación: no tiene libro contable por defecto.`,
        );
        continue;
      }

      // The statement itself, not a re-derivation of it. Every subsidiary's own cash flow ties, so
      // the sum of them ties too.
      const statement = await this.financialReportingService.getCashFlowStatement(
        orgId,
        startDate,
        endDate,
        defaultLedger.id,
      );

      consolidated.openingBalance += statement.openingCash;
      consolidated.operating += statement.operating.total;
      consolidated.investing += statement.investing.total;
      consolidated.financing += statement.financing.total;
      consolidated.endingBalance += statement.closingCash;
    }

    return {
      openingBalance: roundAmount(consolidated.openingBalance),
      operating: roundAmount(consolidated.operating),
      investing: roundAmount(consolidated.investing),
      financing: roundAmount(consolidated.financing),
      endingBalance: roundAmount(consolidated.endingBalance),
    };
  }
}
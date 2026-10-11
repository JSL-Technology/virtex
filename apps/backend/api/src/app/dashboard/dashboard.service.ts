
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
import { startOfYear, endOfDay, format } from 'date-fns';
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
        throw new BadRequestError('dashboard.no_default_ledger_has_configured_organization');
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

  /**
   * Free cash flow for the year to date: the cash that came in and went out through operations and
   * investment, read from the cash and bank accounts themselves (the direct method).
   *
   * It was `net income − working capital`, a level subtracted from a flow. A company created that
   * day with RD$28,800 of opening stock showed −RD$28,800 of free cash flow: the stock is working
   * capital, but no cash ever left for it (QA D02). Now an entry counts only when it moves a cash or
   * bank account, and not when it is financing — its other side is equity (capital, opening
   * balances, dividends) or long-term debt. Opening stock moves no cash; a sale on credit moves none
   * until it is collected; a machine bought in cash is investment and counts.
   */
  async getFreeCashFlow(organizationId: string): Promise<FcfDto> {
    const cacheKey = `fcf:${organizationId}`;
    const cachedData = await this.cacheManager.get<FcfDto>(cacheKey);

    if (cachedData) {
      return cachedData;
    }

    const defaultLedger = await this.dataSource.getRepository(Ledger).findOneBy({ organizationId, isDefault: true });
    if (!defaultLedger) {
      throw new BadRequestError('dashboard.no_default_ledger_has_configured_organization');
    }

    const today = new Date();
    const periodStart = startOfYear(today);
    const [row]: Array<{ fcf: string | null }> = await this.dataSource.query(
      `WITH cash AS (
         SELECT gl_account_id AS id FROM bank_accounts WHERE organization_id = $1
         UNION
         SELECT default_cash_id FROM organization_settings WHERE organization_id = $1 AND default_cash_id IS NOT NULL
         UNION
         SELECT default_bank_id FROM organization_settings WHERE organization_id = $1 AND default_bank_id IS NOT NULL
       ),
       entries AS (
         SELECT je.id,
                SUM(CASE WHEN l.account_id IN (SELECT id FROM cash) THEN v.debit - v.credit ELSE 0 END) AS cash_delta,
                BOOL_OR(a.type = 'EQUITY' OR a.category = 'NON_CURRENT_LIABILITY') AS financing
           FROM journal_entries je
           JOIN journal_entry_lines l ON l.journal_entry_id = je.id
           JOIN journal_entry_line_valuations v ON v.journal_entry_line_id = l.id AND v.ledger_id = $2
           JOIN accounts a ON a.id = l.account_id
          WHERE je.organization_id = $1
            AND je.status = 'Posted'
            AND je.date BETWEEN $3 AND $4
          GROUP BY je.id
       )
       SELECT SUM(cash_delta) FILTER (WHERE NOT financing) AS fcf FROM entries`,
      [organizationId, defaultLedger.id, format(periodStart, 'yyyy-MM-dd'), format(today, 'yyyy-MM-dd')],
    );
    const freeCashFlow = Number(row?.fcf ?? 0);

    const result = {
      freeCashFlow: parseFloat(freeCashFlow.toFixed(2)),
      periodStart: format(periodStart, 'yyyy-MM-dd'),
      date: today,
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
        throw new NotFoundError('dashboard.parent_organization_not_found');
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
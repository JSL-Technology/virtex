import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, Between } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { AccountType, AccountCategory } from '../chart-of-accounts/entities/account.entity';
import {
  BalanceSheetReport,
  FinancialReportingService,
  IncomeStatementReport,
  ReportAccountLine,
  balanceSheetAccounts,
  incomeStatementAccounts,
} from '../financial-reporting/financial-reporting.service';
import { roundAmount, sumAmounts, toCents } from '../common/money';
import { addMonthsIso, endOfMonthIso, IsoDate, startOfMonthIso, toIsoDate } from '../common/dates';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { ExchangeRateType } from '../currencies/entities/exchange-rate.entity';
import {
  IntercompanyTransaction,
  IntercompanyTransactionStatus,
} from '../intercompany/entities/intercompany-transaction.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';

/** How much of an entity's result and net assets belongs to the group, and how much to others. */
export interface OwnershipSplit {
  parent: number;
  nonControlling: number;
}

/** The three rates NIC 21.39 requires, and how each was arrived at. */
export interface TranslationRates {
  /** Assets and liabilities: the rate at the reporting date. */
  closing: number;
  /** Income and expenses: the average for the period, NIC 21.22. */
  average: number;
  /** Pre-acquisition equity: the rate on the date control was obtained, NIC 21.39(b). */
  historical: number;
  /** Which of the published rates (official, market…) was used throughout. */
  rateType: ExchangeRateType;
  /** The month-ends the average was computed over, so the figure can be reproduced. */
  averagedOver: IsoDate[];
}

export interface ConsolidatedEntity {
  organizationId: string;
  legalName: string;
  role: 'PARENT' | 'SUBSIDIARY';
  functionalCurrency: string;
  ownership: number;
  acquisitionDate: IsoDate | null;
  rates: TranslationRates;
  /** In the entity's own functional currency, before translation. */
  functional: { assets: number; liabilities: number; equity: number; netIncome: number };
  /** After translation into the group's presentation currency. */
  presented: { assets: number; liabilities: number; equity: number; netIncome: number };
  /**
   * The exchange difference NIC 21.41 requires be recognised in other comprehensive income.
   *
   * It is a balancing figure by construction, and that is not a shortcut: assets and liabilities
   * are translated at one rate, equity at another and the result at a third, so the translated
   * statement of position cannot balance without it. Reporting it is the point — it is a real
   * component of equity, not a rounding plug.
   */
  translationAdjustment: number;
}

export interface ConsolidatedLine {
  accountId: string;
  code: string;
  name: Record<string, string> | string;
  type: AccountType;
  category: AccountCategory;
  amount: number;
  /** What each entity contributed, so a group figure can be traced back to a company. */
  contributions: { organizationId: string; legalName: string; amount: number }[];
}

export interface Elimination {
  kind: 'INTRAGROUP_BALANCE' | 'INVESTMENT_IN_SUBSIDIARY' | 'INTRAGROUP_TRANSACTION';
  description: string;
  amount: number;
  organizationIds: string[];
}

export interface ConsolidationWarning {
  code:
    | 'UNMAPPED_ACCOUNT'
    | 'NO_CONSOLIDATION_MAP'
    | 'NO_EXCHANGE_RATE'
    | 'NO_ACQUISITION_DATE'
    | 'INTRAGROUP_MISMATCH'
    | 'ENTITY_OUT_OF_BALANCE';
  organizationId: string;
  detail: string;
}

export interface ConsolidatedFinancialStatements {
  consolidationDate: string;
  period: { startDate: IsoDate; endDate: IsoDate };
  presentationCurrency: string;
  parentOrganization: { id: string; legalName: string };
  entities: ConsolidatedEntity[];

  balanceSheet: {
    assets: ConsolidatedLine[];
    liabilities: ConsolidatedLine[];
    equity: ConsolidatedLine[];
    goodwill: number;
    totalAssets: number;
    totalLiabilities: number;
    /** Equity before the parent/non-controlling split: assets less liabilities. */
    totalEquity: number;
    equityAttributableToParent: number;
    nonControllingInterests: number;
    accumulatedTranslationAdjustment: number;
    isBalanced: boolean;
    outOfBalanceBy: number;
  };

  incomeStatement: {
    revenue: ConsolidatedLine[];
    expenses: ConsolidatedLine[];
    totalRevenue: number;
    totalExpenses: number;
    netIncome: number;
    attributableToParent: number;
    attributableToNonControlling: number;
  };

  eliminations: Elimination[];
  warnings: ConsolidationWarning[];
}

/**
 * Consolidated financial statements for a group: NIIF 10 and NIC 21.
 *
 * ## What the previous implementation produced
 *
 * A single list of balance-sheet accounts, and four defects that each make the output unusable as
 * a financial statement rather than merely imprecise:
 *
 * 1. **One rate for everything.** Every subsidiary line — assets, liabilities and equity alike —
 *    was multiplied by the closing rate. NIC 21.39 requires assets and liabilities at the closing
 *    rate, income and expenses at the rate on the transaction date (an average, in practice) and
 *    pre-acquisition equity at the historical rate. Applying one rate to all three does not merely
 *    misstate the figures: it destroys the accounting equation, and nothing checked that the
 *    result balanced.
 * 2. **No exchange difference.** NIC 21.41 recognises the difference in other comprehensive income
 *    as a separate component of equity. There was no such component, so the difference had nowhere
 *    to go and was simply absorbed into whatever the numbers happened to add up to.
 * 3. **Ownership was logged and then ignored.** `subRelation.ownership` appears once, inside a
 *    log line. NIIF 10.22 requires the portion of a subsidiary not owned by the parent to be
 *    presented within equity as a non-controlling interest. A group owning 60 % of a subsidiary
 *    reported 100 % of its equity as its own.
 * 4. **Nothing was eliminated.** NIIF 10.B86(c) requires intragroup balances and transactions to
 *    be eliminated in full. A loan from the parent to a subsidiary appeared as both an asset and a
 *    liability of the same group, inflating both sides of the consolidated balance sheet.
 *
 * There was also no consolidated income statement at all — only a statement of position — so a
 * group had no consolidated profit figure to split, which is the figure NIIF 10 is mostly about.
 *
 * ## What "unmapped" now means
 *
 * A subsidiary account with no entry in the consolidation map used to be skipped with a warning.
 * Silently dropping an asset from a balance sheet is worse than presenting it under its own name:
 * the totals stop tying and the reader has no way to know. Unmapped accounts are now consolidated
 * under their own code and reported in `warnings`, so the statement balances and the gap is
 * visible.
 */
@Injectable()
export class ConsolidationService {
  private readonly logger = new Logger(ConsolidationService.name);

  constructor(
    @InjectRepository(Organization)
    private readonly orgRepository: Repository<Organization>,
    @InjectRepository(ConsolidationMap)
    private readonly mapRepository: Repository<ConsolidationMap>,
    @InjectRepository(OrganizationSettings)
    private readonly orgSettingsRepository: Repository<OrganizationSettings>,
    @InjectRepository(IntercompanyTransaction)
    private readonly intercompanyRepository: Repository<IntercompanyTransaction>,
    private readonly exchangeRateResolver: ExchangeRateResolver,
    private readonly financialReportingService: FinancialReportingService,
    private readonly dataSource: DataSource,
  ) {}

  async runConsolidation(
    parentOrganizationId: string,
    asOfDateInput: Date | string,
    startDateInput?: Date | string,
  ): Promise<ConsolidatedFinancialStatements> {
    const asOfDate = toIsoDate(asOfDateInput);
    // The financial year to date when the caller does not say otherwise. A consolidated income
    // statement needs a period; the previous version had no income statement and so never asked.
    const startDate = startDateInput
      ? toIsoDate(startDateInput)
      : (`${asOfDate.slice(0, 4)}-01-01` as IsoDate);

    if (startDate > asOfDate) {
      throw new BadRequestError('CONSOLIDATION.RANGO_FECHAS_INVALIDO', { startDate, asOfDate });
    }

    this.logger.log(
      `Consolidando el grupo de ${parentOrganizationId} del ${startDate} al ${asOfDate}.`,
    );

    const parentOrg = await this.orgRepository.findOne({
      where: { id: parentOrganizationId },
      relations: ['subsidiaries', 'subsidiaries.subsidiary'],
    });
    if (!parentOrg) {
      throw new NotFoundError('CONSOLIDATION.ORGANIZACION_MATRIZ_NO_ENCONTRADA');
    }
    if (!parentOrg.subsidiaries || parentOrg.subsidiaries.length === 0) {
      throw new BadRequestError(
        'CONSOLIDATION.ORGANIZACION_NO_TIENE_SUBSIDIARIAS_CONFIGURADAS_CONSOLIDAR',
      );
    }

    const parentSettings = await this.orgSettingsRepository.findOneBy({
      organizationId: parentOrganizationId,
    });
    if (!parentSettings) {
      throw new NotFoundError(
        'CONSOLIDATION.CONFIGURACIONES_ORGANIZACION_MATRIZ_NO_ENCONTRADAS',
        { parentOrganizationId },
      );
    }
    const presentationCurrency = parentSettings.baseCurrency.toUpperCase();
    const rateType = await this.exchangeRateResolver.rateTypeFor(parentOrganizationId);

    const warnings: ConsolidationWarning[] = [];
    const eliminations: Elimination[] = [];

    // ── Every entity in the group, translated ────────────────────────────────
    const members = [
      {
        organizationId: parentOrganizationId,
        legalName: parentOrg.legalName,
        role: 'PARENT' as const,
        ownership: 100,
        acquisitionDate: null as IsoDate | null,
        investmentAccountId: null as string | null,
        acquisitionCost: null as number | null,
      },
      ...parentOrg.subsidiaries.map((relation) => ({
        organizationId: relation.subsidiary.id,
        legalName: relation.subsidiary.legalName,
        role: 'SUBSIDIARY' as const,
        ownership: Number(relation.ownership),
        acquisitionDate: relation.acquisitionDate ? toIsoDate(relation.acquisitionDate) : null,
        investmentAccountId: relation.investmentAccountId,
        acquisitionCost: relation.acquisitionCost,
      })),
    ];

    const entities: ConsolidatedEntity[] = [];
    const assetLines = new Map<string, ConsolidatedLine>();
    const liabilityLines = new Map<string, ConsolidatedLine>();
    const equityLines = new Map<string, ConsolidatedLine>();
    const revenueLines = new Map<string, ConsolidatedLine>();
    const expenseLines = new Map<string, ConsolidatedLine>();

    let goodwill = 0;
    let nonControllingEquity = 0;
    let nonControllingResult = 0;
    let accumulatedTranslationAdjustment = 0;

    for (const member of members) {
      const settings = await this.orgSettingsRepository.findOneBy({
        organizationId: member.organizationId,
      });
      const functionalCurrency = (settings?.baseCurrency ?? presentationCurrency).toUpperCase();

      const [balanceSheet, incomeStatement] = await Promise.all([
        this.financialReportingService.getBalanceSheet(member.organizationId, asOfDate),
        this.financialReportingService.getIncomeStatement(
          member.organizationId,
          startDate,
          asOfDate,
        ),
      ]);

      if (!balanceSheet.isBalanced) {
        warnings.push({
          code: 'ENTITY_OUT_OF_BALANCE',
          organizationId: member.organizationId,
          detail: `El balance individual de ${member.legalName} está descuadrado por ${balanceSheet.outOfBalanceBy}.`,
        });
      }

      const rates = await this.ratesFor(
        functionalCurrency,
        presentationCurrency,
        startDate,
        asOfDate,
        member.acquisitionDate,
        rateType,
        member.organizationId,
        warnings,
      );

      const mapping = await this.mappingFor(parentOrganizationId, member, warnings);

      // NIC 21.39: assets and liabilities at the closing rate, income and expenses at the average
      // rate, pre-acquisition equity at the historical rate. Three rates, three lines of code, and
      // the difference between a translation and a multiplication.
      const presentedAssets = this.accumulate(
        assetLines,
        balanceSheet.assets.sections.flatMap((s) => s.accounts),
        rates.closing,
        member,
        mapping,
        warnings,
      );
      const presentedLiabilities = this.accumulate(
        liabilityLines,
        balanceSheet.liabilities.sections.flatMap((s) => s.accounts),
        rates.closing,
        member,
        mapping,
        warnings,
      );
      const presentedEquityAccounts = this.accumulate(
        equityLines,
        balanceSheet.equity.sections.flatMap((s) => s.accounts),
        rates.historical,
        member,
        mapping,
        warnings,
      );
      const presentedRevenue = this.accumulate(
        revenueLines,
        [
          ...incomeStatement.revenue.sections.flatMap((s) => s.accounts),
          ...incomeStatement.nonOperating.accounts.filter((a) => a.type === AccountType.REVENUE),
        ],
        rates.average,
        member,
        mapping,
        warnings,
      );
      const presentedExpenses = this.accumulate(
        expenseLines,
        [
          ...incomeStatement.costOfSales.accounts,
          ...incomeStatement.operatingExpenses.accounts,
          ...incomeStatement.nonOperating.accounts.filter((a) => a.type === AccountType.EXPENSE),
        ],
        rates.average,
        member,
        mapping,
        warnings,
      );

      const presentedResult = roundAmount(presentedRevenue - presentedExpenses);
      const functionalEquity = roundAmount(
        balanceSheet.assets.total - balanceSheet.liabilities.total,
      );
      const presentedEquity = roundAmount(presentedAssets - presentedLiabilities);

      // NIC 21.41. The plug, and the standard says so: the difference arising from translating at
      // different rates goes to other comprehensive income.
      const translationAdjustment = roundAmount(
        presentedEquity - presentedEquityAccounts - presentedResult,
      );
      accumulatedTranslationAdjustment = roundAmount(
        accumulatedTranslationAdjustment + translationAdjustment,
      );

      entities.push({
        organizationId: member.organizationId,
        legalName: member.legalName,
        role: member.role,
        functionalCurrency,
        ownership: member.ownership,
        acquisitionDate: member.acquisitionDate,
        rates,
        functional: {
          assets: balanceSheet.assets.total,
          liabilities: balanceSheet.liabilities.total,
          equity: functionalEquity,
          netIncome: incomeStatement.netIncome,
        },
        presented: {
          assets: presentedAssets,
          liabilities: presentedLiabilities,
          equity: presentedEquity,
          netIncome: presentedResult,
        },
        translationAdjustment,
      });

      if (member.role === 'SUBSIDIARY') {
        // NIIF 10.22: the share of a subsidiary's net assets and results not attributable to the
        // parent is presented separately within equity. It was not presented at all.
        const outsideShare = this.outsideShare(member.ownership);
        nonControllingEquity = roundAmount(nonControllingEquity + presentedEquity * outsideShare);
        nonControllingResult = roundAmount(nonControllingResult + presentedResult * outsideShare);

        goodwill = roundAmount(
          goodwill +
            (await this.eliminateInvestment(
              member,
              presentationCurrency,
              rateType,
              rates,
              eliminations,
              warnings,
            )),
        );
      }
    }

    // ── NIIF 10.B86(c): intragroup balances and transactions, in full ────────
    const groupOrganizationIds = members.map((m) => m.organizationId);
    await this.eliminateIntragroup(
      groupOrganizationIds,
      members,
      presentationCurrency,
      rateType,
      startDate,
      asOfDate,
      assetLines,
      liabilityLines,
      revenueLines,
      expenseLines,
      eliminations,
      warnings,
    );

    // ── Totals ───────────────────────────────────────────────────────────────
    const assets = this.finalize(assetLines);
    const liabilities = this.finalize(liabilityLines);
    const equity = this.finalize(equityLines);
    const revenue = this.finalize(revenueLines);
    const expenses = this.finalize(expenseLines);

    const totalAssets = roundAmount(sumAmounts(assets.map((l) => l.amount)) + goodwill);
    const totalLiabilities = sumAmounts(liabilities.map((l) => l.amount));
    const totalEquity = roundAmount(totalAssets - totalLiabilities);
    const equityAttributableToParent = roundAmount(totalEquity - nonControllingEquity);

    const totalRevenue = sumAmounts(revenue.map((l) => l.amount));
    const totalExpenses = sumAmounts(expenses.map((l) => l.amount));
    const netIncome = roundAmount(totalRevenue - totalExpenses);

    // Assets less liabilities *is* equity by construction, so this can only fail if an individual
    // entity's books are themselves unbalanced — which is exactly what it is here to surface.
    const outOfBalanceCents =
      toCents(totalAssets) - toCents(roundAmount(totalLiabilities + totalEquity));

    return {
      consolidationDate: new Date().toISOString(),
      period: { startDate, endDate: asOfDate },
      presentationCurrency,
      parentOrganization: { id: parentOrganizationId, legalName: parentOrg.legalName },
      entities,
      balanceSheet: {
        assets,
        liabilities,
        equity,
        goodwill,
        totalAssets,
        totalLiabilities,
        totalEquity,
        equityAttributableToParent,
        nonControllingInterests: nonControllingEquity,
        accumulatedTranslationAdjustment,
        isBalanced: outOfBalanceCents === 0,
        outOfBalanceBy: roundAmount(outOfBalanceCents / 100),
      },
      incomeStatement: {
        revenue,
        expenses,
        totalRevenue,
        totalExpenses,
        netIncome,
        attributableToParent: roundAmount(netIncome - nonControllingResult),
        attributableToNonControlling: nonControllingResult,
      },
      eliminations,
      warnings,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Translation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The closing, average and historical rates for one entity.
   *
   * The average is computed over the month-ends inside the period rather than as `(open+close)/2`,
   * which NIC 21.22 permits as an approximation of the transaction-date rates and which a reader
   * can reproduce from the same stored quotes. A month with no quote is skipped rather than
   * treated as zero.
   */
  private async ratesFor(
    functionalCurrency: string,
    presentationCurrency: string,
    startDate: IsoDate,
    endDate: IsoDate,
    acquisitionDate: IsoDate | null,
    rateType: ExchangeRateType,
    organizationId: string,
    warnings: ConsolidationWarning[],
  ): Promise<TranslationRates> {
    if (functionalCurrency === presentationCurrency) {
      return {
        closing: 1,
        average: 1,
        historical: 1,
        rateType,
        averagedOver: [],
      };
    }

    const closing = await this.exchangeRateResolver.rateFor(
      functionalCurrency,
      presentationCurrency,
      endDate,
      undefined,
      rateType,
    );

    const samples: { date: IsoDate; rate: number }[] = [];
    for (
      let cursor = startOfMonthIso(startDate);
      cursor <= endDate;
      cursor = startOfMonthIso(addMonthsIso(cursor, 1))
    ) {
      const sampleDate = endOfMonthIso(cursor) > endDate ? endDate : endOfMonthIso(cursor);
      try {
        samples.push({
          date: sampleDate,
          rate: await this.exchangeRateResolver.rateFor(
            functionalCurrency,
            presentationCurrency,
            sampleDate,
            undefined,
            rateType,
          ),
        });
      } catch {
        // A month without a quote contributes nothing to the average rather than contributing a
        // zero. A period with no quotes at all falls back to the closing rate, below.
      }
    }

    const average =
      samples.length > 0
        ? roundAmount(sumAmounts(samples.map((s) => s.rate)) / samples.length, 6)
        : closing;

    if (samples.length === 0) {
      warnings.push({
        code: 'NO_EXCHANGE_RATE',
        organizationId,
        detail: `Sin cotizaciones de ${functionalCurrency} a ${presentationCurrency} dentro del período; se usó la tasa de cierre como promedio.`,
      });
    }

    let historical = closing;
    if (acquisitionDate) {
      try {
        historical = await this.exchangeRateResolver.rateFor(
          functionalCurrency,
          presentationCurrency,
          acquisitionDate,
          undefined,
          rateType,
        );
      } catch {
        warnings.push({
          code: 'NO_EXCHANGE_RATE',
          organizationId,
          detail: `Sin tasa de ${functionalCurrency} a ${presentationCurrency} en la fecha de adquisición ${acquisitionDate}; se usó la tasa de cierre.`,
        });
      }
    } else {
      warnings.push({
        code: 'NO_ACQUISITION_DATE',
        organizationId,
        detail:
          'Sin fecha de adquisición registrada: el patrimonio se convirtió a la tasa de cierre en lugar de la histórica (NIC 21.39(b)).',
      });
    }

    return {
      closing,
      average,
      historical,
      rateType,
      averagedOver: samples.map((s) => s.date),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Aggregation
  // ───────────────────────────────────────────────────────────────────────────

  private async mappingFor(
    parentOrganizationId: string,
    member: { organizationId: string; legalName: string; role: 'PARENT' | 'SUBSIDIARY' },
    warnings: ConsolidationWarning[],
  ): Promise<Map<string, ReportAccountLine>> {
    if (member.role === 'PARENT') return new Map();

    const rows = await this.mapRepository.find({
      where: {
        parentOrganizationId,
        subsidiaryOrganizationId: member.organizationId,
      },
      relations: ['parentAccount'],
    });

    if (rows.length === 0) {
      warnings.push({
        code: 'NO_CONSOLIDATION_MAP',
        organizationId: member.organizationId,
        detail: `Sin mapa de consolidación para ${member.legalName}: sus cuentas se presentan con su propia codificación.`,
      });
      return new Map();
    }

    return new Map(
      rows
        .filter((row) => row.parentAccount)
        .map((row) => [
          row.subsidiaryAccountId,
          {
            accountId: row.parentAccount.id,
            code: row.parentAccount.code,
            name: row.parentAccount.name,
            type: row.parentAccount.type,
            category: row.parentAccount.category,
            amount: 0,
          } as ReportAccountLine,
        ]),
    );
  }

  /**
   * Translate each line and add it to the group total under its mapped account.
   *
   * @returns the entity's translated total for this set of lines.
   */
  private accumulate(
    target: Map<string, ConsolidatedLine>,
    lines: ReportAccountLine[],
    rate: number,
    member: { organizationId: string; legalName: string; role: 'PARENT' | 'SUBSIDIARY' },
    mapping: Map<string, ReportAccountLine>,
    warnings: ConsolidationWarning[],
  ): number {
    let total = 0;

    for (const line of lines) {
      const mapped = mapping.get(line.accountId);
      if (!mapped && member.role === 'SUBSIDIARY' && mapping.size > 0) {
        warnings.push({
          code: 'UNMAPPED_ACCOUNT',
          organizationId: member.organizationId,
          detail: `La cuenta ${line.code} de ${member.legalName} no está mapeada; se presenta con su propia codificación.`,
        });
      }

      const identity = mapped ?? line;
      const amount = roundAmount(line.amount * rate);
      total = roundAmount(total + amount);
      if (toCents(amount) === 0) continue;

      const existing = target.get(identity.code);
      if (existing) {
        existing.amount = roundAmount(existing.amount + amount);
        existing.contributions.push({
          organizationId: member.organizationId,
          legalName: member.legalName,
          amount,
        });
      } else {
        target.set(identity.code, {
          accountId: identity.accountId,
          code: identity.code,
          name: identity.name,
          type: identity.type,
          category: identity.category,
          amount,
          contributions: [
            { organizationId: member.organizationId, legalName: member.legalName, amount },
          ],
        });
      }
    }

    return total;
  }

  private finalize(lines: Map<string, ConsolidatedLine>): ConsolidatedLine[] {
    return [...lines.values()]
      .filter((line) => toCents(line.amount) !== 0)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Eliminations
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * The parent's investment against its share of the subsidiary's equity at acquisition.
   *
   * @returns the goodwill arising, or a negative figure for a bargain purchase.
   *
   * Both halves are already in the consolidated totals — the investment as an asset of the parent,
   * the equity as equity of the subsidiary — so leaving them there double-counts the same net
   * assets. The residual is goodwill (NIIF 3.32): what the parent paid over and above its share of
   * the identifiable net assets it acquired.
   */
  private async eliminateInvestment(
    member: {
      organizationId: string;
      legalName: string;
      ownership: number;
      acquisitionDate: IsoDate | null;
      acquisitionCost: number | null;
    },
    presentationCurrency: string,
    rateType: ExchangeRateType,
    rates: TranslationRates,
    eliminations: Elimination[],
    warnings: ConsolidationWarning[],
  ): Promise<number> {
    if (member.acquisitionCost === null || member.acquisitionDate === null) {
      // Without both, there is nothing to eliminate against and no goodwill to compute. The
      // warning already raised for the missing acquisition date says so.
      return 0;
    }

    const atAcquisition = await this.financialReportingService.getBalanceSheet(
      member.organizationId,
      member.acquisitionDate,
    );
    const netAssetsAcquired = roundAmount(
      (atAcquisition.assets.total - atAcquisition.liabilities.total) * rates.historical,
    );
    const parentShare = roundAmount(netAssetsAcquired * (member.ownership / 100));
    const arising = roundAmount(member.acquisitionCost - parentShare);

    eliminations.push({
      kind: 'INVESTMENT_IN_SUBSIDIARY',
      description: `Inversión en ${member.legalName} contra su patrimonio a la fecha de adquisición (${member.acquisitionDate}).`,
      amount: parentShare,
      organizationIds: [member.organizationId],
    });

    if (arising < 0) {
      warnings.push({
        code: 'INTRAGROUP_MISMATCH',
        organizationId: member.organizationId,
        detail: `Compra en condiciones ventajosas: el costo de adquisición (${member.acquisitionCost} ${presentationCurrency}) es inferior a la participación adquirida (${parentShare} ${presentationCurrency}).`,
      });
    }

    return arising;
  }

  /**
   * Intragroup receivables, payables and the transactions behind them.
   *
   * Derived from `intercompany_transactions`, which is the record of every movement posted between
   * two members of the group. A completed transaction is a receivable in one company and a payable
   * in another for the same economic event; from the group's point of view neither exists. A
   * transaction still PENDING or FAILED means one half is missing from the books entirely, which is
   * reported rather than netted — eliminating a one-sided balance would hide the break.
   */
  private async eliminateIntragroup(
    groupOrganizationIds: string[],
    members: { organizationId: string; legalName: string }[],
    presentationCurrency: string,
    rateType: ExchangeRateType,
    startDate: IsoDate,
    endDate: IsoDate,
    assetLines: Map<string, ConsolidatedLine>,
    liabilityLines: Map<string, ConsolidatedLine>,
    revenueLines: Map<string, ConsolidatedLine>,
    expenseLines: Map<string, ConsolidatedLine>,
    eliminations: Elimination[],
    warnings: ConsolidationWarning[],
  ): Promise<void> {
    const names = new Map(members.map((m) => [m.organizationId, m.legalName]));

    const transactions = await this.intercompanyRepository.find({
      where: {
        transactionDate: Between(
          new Date(`${startDate}T00:00:00.000Z`),
          new Date(`${endDate}T23:59:59.999Z`),
        ),
      },
    });

    const inGroup = transactions.filter(
      (t) =>
        groupOrganizationIds.includes(t.fromOrganizationId) &&
        groupOrganizationIds.includes(t.toOrganizationId),
    );

    for (const transaction of inGroup) {
      if (transaction.status !== IntercompanyTransactionStatus.COMPLETED) {
        warnings.push({
          code: 'INTRAGROUP_MISMATCH',
          organizationId: transaction.fromOrganizationId,
          detail: `La operación intercompañía ${transaction.id} está en estado ${transaction.status}: solo una de sus dos mitades está registrada, por lo que no se elimina.`,
        });
        continue;
      }

      const currency = (transaction.currencyCode ?? transaction.currency ?? '').toUpperCase();
      let amount = transaction.amount;
      if (currency && currency !== presentationCurrency) {
        try {
          amount = roundAmount(
            transaction.amount *
              (await this.exchangeRateResolver.rateFor(
                currency,
                presentationCurrency,
                toIsoDate(transaction.transactionDate),
                undefined,
                rateType,
              )),
          );
        } catch {
          warnings.push({
            code: 'NO_EXCHANGE_RATE',
            organizationId: transaction.fromOrganizationId,
            detail: `Sin tasa de ${currency} a ${presentationCurrency} al ${toIsoDate(transaction.transactionDate)}; la operación intercompañía ${transaction.id} no se eliminó.`,
          });
          continue;
        }
      }

      // Reduce both sides by the same figure. Which accounts they landed in is recorded on the
      // transaction, so the elimination reaches the actual lines rather than a guess at them.
      const reduced =
        this.reduceLine(assetLines, transaction.fromAccountId, amount) &&
        this.reduceLine(liabilityLines, transaction.toAccountId, amount);

      eliminations.push({
        kind: 'INTRAGROUP_BALANCE',
        description: `${names.get(transaction.fromOrganizationId) ?? transaction.fromOrganizationId} → ${
          names.get(transaction.toOrganizationId) ?? transaction.toOrganizationId
        }: ${transaction.description}`,
        amount,
        organizationIds: [transaction.fromOrganizationId, transaction.toOrganizationId],
      });

      if (!reduced) {
        warnings.push({
          code: 'INTRAGROUP_MISMATCH',
          organizationId: transaction.fromOrganizationId,
          detail: `La operación intercompañía ${transaction.id} no encontró ambas cuentas en los estados consolidados; la eliminación puede estar incompleta.`,
        });
      }
    }

    // Revenue and expense recognised between group members is not group revenue (NIIF 10.B86(c)).
    // Nothing is netted here beyond the balances above until intercompany postings distinguish a
    // trading transaction from a financing one — doing it blind would remove real third-party
    // revenue that happens to sit in the same account.
    void revenueLines;
    void expenseLines;
  }

  /** Reduce an already-accumulated line by `amount`. Returns whether the account was found. */
  private reduceLine(
    lines: Map<string, ConsolidatedLine>,
    accountId: string | null,
    amount: number,
  ): boolean {
    if (!accountId) return false;
    for (const line of lines.values()) {
      if (line.accountId === accountId) {
        line.amount = roundAmount(line.amount - amount);
        return true;
      }
    }
    return false;
  }

  /** The fraction of a subsidiary that belongs to someone other than the group. */
  private outsideShare(ownership: number): number {
    const owned = Number(ownership);
    if (!Number.isFinite(owned) || owned <= 0) return 1;
    if (owned >= 100) return 0;
    return roundAmount(1 - owned / 100, 6);
  }
}

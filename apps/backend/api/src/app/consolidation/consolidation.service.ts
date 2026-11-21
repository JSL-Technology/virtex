import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Organization } from '../organizations/entities/organization.entity';
import { AccountType, AccountCategory } from '../chart-of-accounts/entities/account.entity';
import { FinancialReportingService, ReportAccountLine } from '../financial-reporting/financial-reporting.service';
import { roundAmount, sumAmounts, toCents } from '../common/money';
import { addDaysIso, addMonthsIso, endOfMonthIso, IsoDate, startOfMonthIso, toIsoDate } from '../common/dates';
import { splitSubsidiaryEquity, SubsidiaryEquityResult } from './group-eliminations';
import { ConsolidationMap } from './entities/consolidation-map.entity';
import { ConsolidationRun } from './entities/consolidation-run.entity';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { ExchangeRateResolver } from '../currencies/exchange-rate-resolver.service';
import { ExchangeRateType } from '../currencies/entities/exchange-rate.entity';
import {
  IntercompanyTransaction,
  IntercompanyTransactionStatus,
} from '../intercompany/entities/intercompany-transaction.entity';
import { BadRequestError, NotFoundError } from '../i18n/localized.exception';
import { I18nService } from '../i18n/i18n.service';
import { currentLanguage } from '../i18n/request-locale';

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
  /** The elimination as a journal entry, in the presentation currency: what an auditor reviews. */
  entries: { side: 'DEBIT' | 'CREDIT'; code: string; label: string; amount: number }[];
}

interface GroupMemberInput {
  organizationId: string;
  legalName: string;
  role: 'PARENT' | 'SUBSIDIARY';
  ownership: number;
  acquisitionDate: IsoDate | null;
  investmentAccountId: string | null;
  acquisitionCost: number | null;
}

/** A member as consolidated: its rates, its account mapping and its default accounts. */
interface GroupMember extends GroupMemberInput {
  functionalCurrency: string;
  rates: TranslationRates;
  mapping: Map<string, ReportAccountLine>;
  settings: OrganizationSettings | null;
  deconsolidated: boolean;
}

interface SyntheticLine {
  code: string;
  key: string;
  type: AccountType;
  category: AccountCategory;
}

export interface ConsolidationWarning {
  code:
    | 'UNMAPPED_ACCOUNT'
    | 'NO_CONSOLIDATION_MAP'
    | 'NO_EXCHANGE_RATE'
    | 'NO_ACQUISITION_DATE'
    | 'INTRAGROUP_MISMATCH'
    | 'ENTITY_OUT_OF_BALANCE'
    | 'CONTROL_ENDED_IN_PERIOD';
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
    private readonly i18n: I18nService,
    @InjectRepository(ConsolidationRun)
    private readonly runs: Repository<ConsolidationRun>,
  ) {}

  /** Consolidate and keep the run (FINB-34): reproducible, reviewable, comparable over time. */
  async runAndRecord(
    parentOrganizationId: string,
    asOfDate: Date | string,
    startDate: Date | string | undefined,
    actorUserId: string | null,
  ): Promise<ConsolidatedFinancialStatements & { runId: string }> {
    const result = await this.runConsolidation(parentOrganizationId, asOfDate, startDate);
    const run = await this.runs.save(
      this.runs.create({
        organizationId: parentOrganizationId,
        startDate: result.period.startDate,
        asOfDate: result.period.endDate,
        presentationCurrency: result.presentationCurrency,
        isBalanced: result.balanceSheet.isBalanced,
        totalAssets: result.balanceSheet.totalAssets,
        totalEquity: result.balanceSheet.totalEquity,
        nonControllingInterests: result.balanceSheet.nonControllingInterests,
        goodwill: result.balanceSheet.goodwill,
        translationReserve: result.balanceSheet.accumulatedTranslationAdjustment,
        netIncome: result.incomeStatement.netIncome,
        warningCount: result.warnings.length,
        result,
        createdByUserId: actorUserId,
      }),
    );
    return { ...result, runId: run.id };
  }

  listRuns(parentOrganizationId: string, limit = 25): Promise<Omit<ConsolidationRun, 'result'>[]> {
    return this.runs.find({
      where: { organizationId: parentOrganizationId },
      order: { createdAt: 'DESC' },
      take: limit,
      select: ['id', 'startDate', 'asOfDate', 'presentationCurrency', 'isBalanced', 'totalAssets', 'totalEquity', 'nonControllingInterests', 'goodwill', 'translationReserve', 'netIncome', 'warningCount', 'createdByUserId', 'createdAt'],
    });
  }

  async getRun(parentOrganizationId: string, id: string): Promise<ConsolidationRun> {
    const run = await this.runs.findOne({ where: { id, organizationId: parentOrganizationId } });
    if (!run) throw new NotFoundError('consolidation.run_not_found');
    return run;
  }

  /**
   * A sentence for the consolidated report, in the language of whoever asked for it.
   *
   * The reader's language and not the books': a consolidation spans several companies, which can
   * be kept in several languages, and the report is composed fresh on every request rather than
   * written into a ledger. There is no one set of books for it to belong to. (Contrast
   * `LedgerNarrativeService`, which narrates entries that are part of the record.)
   */
  private say(key: string, params: Record<string, unknown> = {}): string {
    return this.i18n.translate(key, currentLanguage(), params);
  }

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
      throw new BadRequestError('consolidation.period_start_start_date_later_than', { startDate, asOfDate });
    }

    this.logger.log(
      `Consolidando el grupo de ${parentOrganizationId} del ${startDate} al ${asOfDate}.`,
    );

    const parentOrg = await this.orgRepository.findOne({
      where: { id: parentOrganizationId },
      relations: ['subsidiaries', 'subsidiaries.subsidiary'],
    });
    if (!parentOrg) {
      throw new NotFoundError('consolidation.parent_organization_not_found');
    }
    // A subsidiary whose control ended before the period began is not part of this group's
    // statements for the period (NIIF 10.25). One that ended inside it is still consolidated, and
    // flagged below: the period's result should only include it up to that date.
    const controlled = (parentOrg.subsidiaries ?? []).filter(
      (relation) => !relation.controlEndedOn || toIsoDate(relation.controlEndedOn) > startDate,
    );
    if (controlled.length === 0) {
      throw new BadRequestError(
        'consolidation.organization_has_no_subsidiaries_configured_consolidate',
      );
    }

    const parentSettings = await this.orgSettingsRepository.findOneBy({
      organizationId: parentOrganizationId,
    });
    if (!parentSettings) {
      throw new NotFoundError(
        'consolidation.settings_parent_organization_parent_organization_id',
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
      ...controlled.map((relation) => ({
        organizationId: relation.subsidiary.id,
        legalName: relation.subsidiary.legalName,
        role: 'SUBSIDIARY' as const,
        ownership: Number(relation.ownership),
        acquisitionDate: relation.acquisitionDate ? toIsoDate(relation.acquisitionDate) : null,
        investmentAccountId: relation.investmentAccountId,
        acquisitionCost: relation.acquisitionCost,
      })),
    ];

    for (const relation of controlled) {
      if (relation.controlEndedOn && toIsoDate(relation.controlEndedOn) <= asOfDate) {
        warnings.push({
          code: 'CONTROL_ENDED_IN_PERIOD',
          organizationId: relation.subsidiary.id,
          detail: this.say('consolidation.warning.control_ended_in_period', {
            member: relation.subsidiary.legalName,
            date: toIsoDate(relation.controlEndedOn),
          }),
        });
      }
    }

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
    const consolidatedMembers: GroupMember[] = [];

    for (const member of members) {
      const settings = await this.orgSettingsRepository.findOneBy({
        organizationId: member.organizationId,
      });
      const functionalCurrency = (settings?.baseCurrency ?? presentationCurrency).toUpperCase();

      // NIIF 10.20 / B88: a subsidiary's results enter the group from the date control is obtained
      // to the date it is lost. A member that left the group before the reporting date is not in
      // the closing statement of position at all (NIIF 10.25: deconsolidated).
      const relation = controlled.find((r) => r.subsidiary.id === member.organizationId);
      const controlEndedOn = relation?.controlEndedOn ? toIsoDate(relation.controlEndedOn) : null;
      const deconsolidated = controlEndedOn !== null && controlEndedOn <= asOfDate;
      const resultsFrom =
        member.acquisitionDate && member.acquisitionDate >= startDate ? addDaysIso(member.acquisitionDate, 1) : startDate;
      const resultsTo = deconsolidated ? (controlEndedOn as IsoDate) : asOfDate;

      const [balanceSheet, incomeStatement] = await Promise.all([
        this.financialReportingService.getBalanceSheet(member.organizationId, asOfDate),
        resultsFrom <= resultsTo
          ? this.financialReportingService.getIncomeStatement(member.organizationId, resultsFrom, resultsTo)
          : Promise.resolve(null),
      ]);

      if (!balanceSheet.isBalanced) {
        warnings.push({
          code: 'ENTITY_OUT_OF_BALANCE',
          organizationId: member.organizationId,
          detail: this.say('consolidation.warning.member_out_of_balance', {
            member: member.legalName,
            amount: balanceSheet.outOfBalanceBy,
          }),
        });
      }

      const rates = await this.ratesFor(
        functionalCurrency,
        presentationCurrency,
        resultsFrom <= resultsTo ? resultsFrom : startDate,
        asOfDate,
        member.acquisitionDate,
        rateType,
        member.organizationId,
        warnings,
      );

      const mapping = await this.mappingFor(parentOrganizationId, member, warnings);

      // NIC 21.39: assets and liabilities at the closing rate, income and expenses at the average
      // rate. A deconsolidated member contributes its results to the date control ended, nothing
      // to the statement of position.
      const scratch = new Map<string, ConsolidatedLine>();
      const presentedAssets = this.accumulate(
        deconsolidated ? scratch : assetLines,
        balanceSheet.assets.sections.flatMap((s) => s.accounts),
        rates.closing,
        member,
        mapping,
        warnings,
      );
      const presentedLiabilities = this.accumulate(
        deconsolidated ? scratch : liabilityLines,
        balanceSheet.liabilities.sections.flatMap((s) => s.accounts),
        rates.closing,
        member,
        mapping,
        warnings,
      );
      // The parent's own equity accounts are group equity. A subsidiary's are not: they are
      // replaced below by what they are to the group (FINB-30). Translated here only to report
      // the entity's own translation difference.
      const presentedEquityAccounts = this.accumulate(
        member.role === 'PARENT' ? equityLines : scratch,
        balanceSheet.equity.sections.flatMap((s) => s.accounts),
        rates.historical,
        member,
        mapping,
        member.role === 'PARENT' ? warnings : [],
      );
      const presentedRevenue = incomeStatement
        ? this.accumulate(
            revenueLines,
            [
              ...incomeStatement.revenue.sections.flatMap((s) => s.accounts),
              ...incomeStatement.nonOperating.accounts.filter((a) => a.type === AccountType.REVENUE),
            ],
            rates.average,
            member,
            mapping,
            warnings,
          )
        : 0;
      const presentedExpenses = incomeStatement
        ? this.accumulate(
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
          )
        : 0;

      const presentedResult = roundAmount(presentedRevenue - presentedExpenses);
      const functionalEquity = roundAmount(balanceSheet.assets.total - balanceSheet.liabilities.total);
      const presentedEquity = roundAmount(presentedAssets - presentedLiabilities);
      // NIC 21.41: the entity's own exchange difference, reported per entity.
      const translationAdjustment = roundAmount(presentedEquity - presentedEquityAccounts - presentedResult);

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
          netIncome: incomeStatement?.netIncome ?? 0,
        },
        presented: {
          assets: presentedAssets,
          liabilities: presentedLiabilities,
          equity: presentedEquity,
          netIncome: presentedResult,
        },
        translationAdjustment,
      });

      if (member.role === 'PARENT') {
        // The parent's result not yet closed into retained earnings is part of its equity; the
        // individual statement presents it outside the equity accounts (`unclosedResult`).
        this.addSynthetic(equityLines, 'CONS-UNC', 'consolidation.line.unclosed_result', AccountType.EQUITY, roundAmount(balanceSheet.equity.unclosedResult * rates.historical), member);
        consolidatedMembers.push({ ...member, functionalCurrency, rates, mapping, settings, deconsolidated: false });
        continue;
      }

      // NIIF 10.22: the outside share of the subsidiary's result.
      const outsideShare = this.outsideShare(member.ownership);
      nonControllingResult = roundAmount(nonControllingResult + presentedResult * outsideShare);
      if (deconsolidated) continue;
      consolidatedMembers.push({ ...member, functionalCurrency, rates, mapping, settings, deconsolidated });

      const split = await this.subsidiaryEquity(member, functionalCurrency, presentationCurrency, rateType, rates, asOfDate, functionalEquity, presentedEquity, warnings);
      nonControllingEquity = roundAmount(nonControllingEquity + split.nonControlling);
      goodwill = roundAmount(goodwill + split.goodwill);
      accumulatedTranslationAdjustment = roundAmount(
        accumulatedTranslationAdjustment + split.parentTranslation + split.goodwillTranslation,
      );

      // The elimination, as the entry an accountant would write: remove the investment, recognise
      // goodwill, and present the subsidiary's equity as group reserves, translation reserve and
      // non-controlling interest.
      const investmentLine = await this.lineFor(parentOrganizationId, member.investmentAccountId, new Map());
      if (split.investmentEliminated > 0) {
        const found = this.adjustLine(assetLines, investmentLine, -split.investmentEliminated, this.synthetic('CONS-INV', 'consolidation.line.investment_eliminated', AccountType.ASSET, AccountCategory.NON_CURRENT_ASSET));
        if (!found) {
          warnings.push({
            code: 'INTRAGROUP_MISMATCH',
            organizationId: member.organizationId,
            detail: this.say('consolidation.warning.investment_account_missing', { member: member.legalName }),
          });
        }
      }
      this.addSynthetic(equityLines, 'CONS-RES', 'consolidation.line.post_acquisition_reserves', AccountType.EQUITY, split.parentPostAcquisition + split.bargainPurchaseGain + split.uneliminatedPreAcquisition, member);
      this.addSynthetic(equityLines, 'CONS-CTA', 'consolidation.line.translation_reserve', AccountType.EQUITY, split.parentTranslation + split.goodwillTranslation, member);
      this.addSynthetic(equityLines, 'CONS-NCI', 'consolidation.line.non_controlling_interest', AccountType.EQUITY, split.nonControlling, member);

      eliminations.push({
        kind: 'INVESTMENT_IN_SUBSIDIARY',
        description: this.say('consolidation.elimination.investment_in_subsidiary', {
          member: member.legalName,
          date: member.acquisitionDate ?? '—',
        }),
        amount: split.investmentEliminated,
        organizationIds: [parentOrganizationId, member.organizationId],
        entries: [
          { side: 'DEBIT', code: 'EQUITY', label: this.say('consolidation.line.pre_acquisition_equity'), amount: split.parentShareAtAcquisition },
          { side: 'DEBIT', code: 'GOODWILL', label: this.say('consolidation.line.goodwill'), amount: roundAmount(split.goodwill - split.goodwillTranslation) },
          { side: 'CREDIT', code: investmentLine?.code ?? 'CONS-INV', label: this.say('consolidation.line.investment_eliminated'), amount: split.investmentEliminated },
          ...(split.bargainPurchaseGain > 0
            ? [{ side: 'CREDIT' as const, code: 'CONS-RES', label: this.say('consolidation.line.bargain_purchase_gain'), amount: split.bargainPurchaseGain }]
            : []),
        ],
      });

      if (split.bargainPurchaseGain > 0) {
        warnings.push({
          code: 'INTRAGROUP_MISMATCH',
          organizationId: member.organizationId,
          detail: this.say('consolidation.warning.bargain_purchase', {
            cost: member.acquisitionCost,
            share: split.parentShareAtAcquisition,
            currency: presentationCurrency,
          }),
        });
        // NIIF 3.34: in profit or loss when the acquisition falls in the period.
        if (member.acquisitionDate && member.acquisitionDate >= startDate && member.acquisitionDate <= asOfDate) {
          this.addSynthetic(revenueLines, 'CONS-BPG', 'consolidation.line.bargain_purchase_gain', AccountType.REVENUE, split.bargainPurchaseGain, member);
        }
      }
      if (split.uneliminatedPreAcquisition !== 0) {
        warnings.push({
          code: 'NO_ACQUISITION_DATE',
          organizationId: member.organizationId,
          detail: this.say('consolidation.warning.no_acquisition_cost', { member: member.legalName }),
        });
      }
    }

    // ── NIIF 10.B86(c): intragroup balances, transactions and results, in full ──
    await this.eliminateIntercompanyFunding(consolidatedMembers, asOfDate, assetLines, liabilityLines, equityLines, eliminations, warnings);
    await this.eliminateIntragroupTrade(consolidatedMembers, startDate, asOfDate, assetLines, liabilityLines, equityLines, revenueLines, expenseLines, eliminations, warnings);

    // ── Totals ───────────────────────────────────────────────────────────────
    const assets = this.finalize(assetLines);
    const liabilities = this.finalize(liabilityLines);
    const equity = this.finalize(equityLines);
    const revenue = this.finalize(revenueLines);
    const expenses = this.finalize(expenseLines);

    const totalAssets = roundAmount(sumAmounts(assets.map((l) => l.amount)) + goodwill);
    const totalLiabilities = sumAmounts(liabilities.map((l) => l.amount));
    // Equity is the SUM OF ITS LINES — no longer assets less liabilities, which made the check
    // below true by construction and hid every elimination that was missing.
    const totalEquity = sumAmounts(equity.map((l) => l.amount));
    const equityAttributableToParent = roundAmount(totalEquity - nonControllingEquity);

    const totalRevenue = sumAmounts(revenue.map((l) => l.amount));
    const totalExpenses = sumAmounts(expenses.map((l) => l.amount));
    const netIncome = roundAmount(totalRevenue - totalExpenses);

    const outOfBalanceCents = toCents(totalAssets) - toCents(roundAmount(totalLiabilities + totalEquity));

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
        detail: this.say('consolidation.warning.no_average_rate', {
          from: functionalCurrency,
          to: presentationCurrency,
        }),
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
          detail: this.say('consolidation.warning.no_acquisition_rate', {
            from: functionalCurrency,
            to: presentationCurrency,
            date: acquisitionDate,
          }),
        });
      }
    } else {
      warnings.push({
        code: 'NO_ACQUISITION_DATE',
        organizationId,
        detail: this.say('consolidation.warning.no_acquisition_date'),
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
        detail: this.say('consolidation.warning.no_consolidation_map', {
          member: member.legalName,
        }),
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
          detail: this.say('consolidation.warning.account_not_mapped', {
            code: line.code,
            member: member.legalName,
          }),
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
   * The subsidiary's equity, split into what it is to the group (see `group-eliminations.ts`).
   * Net assets at acquisition are read from the subsidiary's own books at that date.
   */
  private async subsidiaryEquity(
    member: GroupMemberInput,
    functionalCurrency: string,
    presentationCurrency: string,
    rateType: ExchangeRateType,
    rates: TranslationRates,
    asOfDate: IsoDate,
    functionalEquity: number,
    presentedEquity: number,
    warnings: ConsolidationWarning[],
  ): Promise<SubsidiaryEquityResult> {
    let equityAtAcquisition = 0;
    let averageSinceAcquisition = rates.average;
    if (member.acquisitionDate) {
      const atAcquisition = await this.financialReportingService.getBalanceSheet(member.organizationId, member.acquisitionDate);
      equityAtAcquisition = roundAmount(atAcquisition.assets.total - atAcquisition.liabilities.total);
      if (functionalCurrency !== presentationCurrency) {
        const since = await this.ratesFor(functionalCurrency, presentationCurrency, member.acquisitionDate, asOfDate, member.acquisitionDate, rateType, member.organizationId, []);
        averageSinceAcquisition = since.average;
      } else {
        averageSinceAcquisition = 1;
      }
    }
    void warnings;
    return splitSubsidiaryEquity({
      parentShare: Number(member.ownership) / 100,
      equityAtAcquisitionFunctional: equityAtAcquisition,
      equityFunctional: functionalEquity,
      equityPresented: presentedEquity,
      historicalRate: rates.historical,
      closingRate: rates.closing,
      averageSinceAcquisitionRate: averageSinceAcquisition,
      acquisitionCost: member.acquisitionCost === null ? null : Number(member.acquisitionCost),
    });
  }

  /**
   * Intercompany funding (`intercompany_transactions`): a receivable in the lender, a payable in
   * the borrower — both eliminated (FINB-31). The old code reduced the CASH accounts recorded on
   * the transaction and left the receivable and payable in the statements, and took the period's
   * flows instead of what is owed at the date. Here: every completed transaction up to the
   * reporting date, each side at the amount its own books recorded (the journal lines on the
   * intercompany accounts), translated at that member's closing rate.
   */
  private async eliminateIntercompanyFunding(
    members: GroupMember[],
    asOfDate: IsoDate,
    assetLines: Map<string, ConsolidatedLine>,
    liabilityLines: Map<string, ConsolidatedLine>,
    equityLines: Map<string, ConsolidatedLine>,
    eliminations: Elimination[],
    warnings: ConsolidationWarning[],
  ): Promise<void> {
    const byId = new Map(members.map((m) => [m.organizationId, m]));
    const ids = [...byId.keys()];
    const rows: Array<{ id: string; status: string; from_id: string; to_id: string; description: string; from_amount: string | null; to_amount: string | null }> =
      await this.dataSource.query(
        `SELECT t.id, t.status, t.from_organization_id AS from_id, t.to_organization_id AS to_id, t.description,
                (SELECT SUM(l.debit - l.credit) FROM journal_entry_lines l
                  WHERE l.journal_entry_id = t.source_journal_entry_id AND l.account_id = fs.default_intercompany_receivable_id) AS from_amount,
                (SELECT SUM(l.credit - l.debit) FROM journal_entry_lines l
                  WHERE l.journal_entry_id = t.destination_journal_entry_id AND l.account_id = ts.default_intercompany_payable_id) AS to_amount
           FROM intercompany_transactions t
           LEFT JOIN organization_settings fs ON fs.organization_id = t.from_organization_id
           LEFT JOIN organization_settings ts ON ts.organization_id = t.to_organization_id
          WHERE t.from_organization_id = ANY($1::uuid[]) AND t.to_organization_id = ANY($1::uuid[])
            AND t.transaction_date <= ($2::date + 1)`,
      [ids, asOfDate],
    );

    const pairs = new Map<string, { from: GroupMember; to: GroupMember; receivable: number; payable: number; count: number }>();
    for (const row of rows) {
      if (row.status !== IntercompanyTransactionStatus.COMPLETED) {
        warnings.push({
          code: 'INTRAGROUP_MISMATCH',
          organizationId: row.from_id,
          detail: this.say('consolidation.warning.intercompany_transaction_transaction_status_only_one', { transaction: row.id, status: row.status }),
        });
        continue;
      }
      const from = byId.get(row.from_id);
      const to = byId.get(row.to_id);
      if (!from || !to) continue;
      const key = `${row.from_id}>${row.to_id}`;
      const pair = pairs.get(key) ?? { from, to, receivable: 0, payable: 0, count: 0 };
      pair.receivable += Number(row.from_amount ?? 0);
      pair.payable += Number(row.to_amount ?? 0);
      pair.count += 1;
      pairs.set(key, pair);
    }

    for (const pair of pairs.values()) {
      const receivable = roundAmount(pair.receivable * pair.from.rates.closing);
      const payable = roundAmount(pair.payable * pair.to.rates.closing);
      this.adjustLine(assetLines, await this.lineFor(pair.from.organizationId, pair.from.settings?.defaultIntercompanyReceivableAccountId ?? null, pair.from.mapping), -receivable, this.synthetic('CONS-ICR', 'consolidation.line.intercompany_receivable_eliminated', AccountType.ASSET, AccountCategory.CURRENT_ASSET));
      this.adjustLine(liabilityLines, await this.lineFor(pair.to.organizationId, pair.to.settings?.defaultIntercompanyPayableAccountId ?? null, pair.to.mapping), -payable, this.synthetic('CONS-ICP', 'consolidation.line.intercompany_payable_eliminated', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY));
      this.settleResidual(equityLines, receivable, payable, pair.from, pair.to, warnings);
      eliminations.push({
        kind: 'INTRAGROUP_BALANCE',
        description: this.say('consolidation.elimination.intercompany_funding', { from: pair.from.legalName, to: pair.to.legalName, count: pair.count }),
        amount: receivable,
        organizationIds: [pair.from.organizationId, pair.to.organizationId],
        entries: [
          { side: 'DEBIT', code: 'IC-PAYABLE', label: this.say('consolidation.line.intercompany_payable_eliminated'), amount: payable },
          { side: 'CREDIT', code: 'IC-RECEIVABLE', label: this.say('consolidation.line.intercompany_receivable_eliminated'), amount: receivable },
        ],
      });
    }
  }

  /**
   * Sales between members (FINB-32): a member's invoice to a customer whose tax identifier is
   * another member's. The revenue is not the group's and neither is the matching cost (NIIF
   * 10.B86(c)): Dr revenue, Cr cost of sales, for the seller's figure. What is still owed is a
   * receivable and a payable inside the group: both eliminated. The buyer's side is read from its
   * vendor bills to report a mismatch, and goods it bought from the group raise a warning that the
   * unrealised profit in its inventory is not eliminated — verificar con el contador.
   */
  private async eliminateIntragroupTrade(
    members: GroupMember[],
    startDate: IsoDate,
    asOfDate: IsoDate,
    assetLines: Map<string, ConsolidatedLine>,
    liabilityLines: Map<string, ConsolidatedLine>,
    equityLines: Map<string, ConsolidatedLine>,
    revenueLines: Map<string, ConsolidatedLine>,
    expenseLines: Map<string, ConsolidatedLine>,
    eliminations: Elimination[],
    warnings: ConsolidationWarning[],
  ): Promise<void> {
    const taxRows: Array<{ id: string; tax: string | null }> = await this.dataSource.query(
      `SELECT id, NULLIF(regexp_replace(upper(coalesce(tax_id, '')), '[^A-Z0-9]', '', 'g'), '') AS tax FROM organizations WHERE id = ANY($1::uuid[])`,
      [members.map((m) => m.organizationId)],
    );
    const taxOf = new Map(taxRows.map((r) => [r.id, r.tax]));

    for (const seller of members) {
      for (const buyer of members) {
        if (seller === buyer) continue;
        const sellerTax = taxOf.get(seller.organizationId);
        const buyerTax = taxOf.get(buyer.organizationId);
        if (!sellerTax || !buyerTax) continue;
        const from = [startDate, ...[seller, buyer].map((m) => (m.acquisitionDate && m.acquisitionDate >= startDate ? addDaysIso(m.acquisitionDate, 1) : startDate))].sort().pop() as IsoDate;

        const [sales] = await this.dataSource.query(
          `SELECT COALESCE(SUM(CASE WHEN i.type = 'CREDIT_NOTE' THEN -i.subtotal ELSE i.subtotal END * i.exchange_rate)
                    FILTER (WHERE i."issueDate" BETWEEN $3 AND $4), 0) AS revenue,
                  COALESCE(SUM(i.balance * i.exchange_rate)
                    FILTER (WHERE i."issueDate" <= $4 AND i.type <> 'CREDIT_NOTE' AND i.balance > 0), 0) AS receivable
             FROM invoices i JOIN customers c ON c.id = i.customer_id
            WHERE i.organization_id = $1 AND i.status NOT IN ('Draft', 'Void')
              AND regexp_replace(upper(coalesce(c."taxId", '')), '[^A-Z0-9]', '', 'g') = $2`,
          [seller.organizationId, buyerTax, from, asOfDate],
        );
        const [purchases] = await this.dataSource.query(
          `SELECT COALESCE(SUM((vb.services_amount + vb.goods_amount) * vb.exchange_rate) FILTER (WHERE vb.date BETWEEN $3 AND $4), 0) AS expense,
                  COALESCE(SUM(vb.goods_amount * vb.exchange_rate) FILTER (WHERE vb.date BETWEEN $3 AND $4), 0) AS goods,
                  COALESCE(SUM(vb.balance * vb.exchange_rate) FILTER (WHERE vb.date <= $4 AND vb.balance > 0), 0) AS payable
             FROM vendor_bills vb JOIN suppliers s ON s.id = vb.vendor_id
            WHERE vb.organization_id = $1 AND vb.status NOT IN ('DRAFT', 'VOID', 'REJECTED')
              AND regexp_replace(upper(coalesce(s."taxId", '')), '[^A-Z0-9]', '', 'g') = $2`,
          [buyer.organizationId, sellerTax, from, asOfDate],
        );

        const revenue = roundAmount(Number(sales.revenue) * seller.rates.average);
        const bought = roundAmount(Number(purchases.expense) * buyer.rates.average);
        const receivable = roundAmount(Number(sales.receivable) * seller.rates.closing);
        const payable = roundAmount(Number(purchases.payable) * buyer.rates.closing);
        if ([revenue, bought, receivable, payable].every((v) => toCents(v) === 0)) continue;

        if (toCents(revenue) !== 0) {
          this.adjustLine(revenueLines, await this.lineFor(seller.organizationId, seller.settings?.defaultSalesRevenueId ?? null, seller.mapping), -revenue, this.synthetic('CONS-ISR', 'consolidation.line.intragroup_sales_eliminated', AccountType.REVENUE, AccountCategory.OPERATING_REVENUE));
          this.adjustLine(expenseLines, null, -revenue, this.synthetic('CONS-ICS', 'consolidation.line.intragroup_cost_eliminated', AccountType.EXPENSE, AccountCategory.COST_OF_GOODS_SOLD));
        }
        if (toCents(receivable) !== 0 || toCents(payable) !== 0) {
          this.adjustLine(assetLines, await this.lineFor(seller.organizationId, seller.settings?.defaultAccountsReceivableId ?? null, seller.mapping), -receivable, this.synthetic('CONS-ICR', 'consolidation.line.intercompany_receivable_eliminated', AccountType.ASSET, AccountCategory.CURRENT_ASSET));
          this.adjustLine(liabilityLines, await this.lineFor(buyer.organizationId, buyer.settings?.defaultAccountsPayableId ?? null, buyer.mapping), -payable, this.synthetic('CONS-ICP', 'consolidation.line.intercompany_payable_eliminated', AccountType.LIABILITY, AccountCategory.CURRENT_LIABILITY));
          this.settleResidual(equityLines, receivable, payable, seller, buyer, warnings);
        }
        if (Math.abs(revenue - bought) > Math.max(1, Math.abs(revenue) * 0.005)) {
          warnings.push({
            code: 'INTRAGROUP_MISMATCH',
            organizationId: seller.organizationId,
            detail: this.say('consolidation.warning.intragroup_sales_mismatch', { seller: seller.legalName, buyer: buyer.legalName, sold: revenue, bought }),
          });
        }
        if (Number(purchases.goods) > 0) {
          warnings.push({
            code: 'INTRAGROUP_MISMATCH',
            organizationId: buyer.organizationId,
            detail: this.say('consolidation.warning.unrealised_profit_not_eliminated', { seller: seller.legalName, buyer: buyer.legalName }),
          });
        }
        eliminations.push({
          kind: 'INTRAGROUP_TRANSACTION',
          description: this.say('consolidation.elimination.intragroup_trade', { seller: seller.legalName, buyer: buyer.legalName }),
          amount: revenue,
          organizationIds: [seller.organizationId, buyer.organizationId],
          entries: [
            { side: 'DEBIT', code: 'REVENUE', label: this.say('consolidation.line.intragroup_sales_eliminated'), amount: revenue },
            { side: 'CREDIT', code: 'CONS-ICS', label: this.say('consolidation.line.intragroup_cost_eliminated'), amount: revenue },
            { side: 'DEBIT', code: 'AP', label: this.say('consolidation.line.intercompany_payable_eliminated'), amount: payable },
            { side: 'CREDIT', code: 'AR', label: this.say('consolidation.line.intercompany_receivable_eliminated'), amount: receivable },
          ],
        });
      }
    }
  }

  /**
   * Eliminating a receivable and a payable that do not agree leaves the difference somewhere. At
   * the presentation level it is translation (each side at its own closing rate) or timing (one
   * side recorded, the other not); it goes to the translation reserve so the statement balances,
   * and a material one is reported, because it is a reconciliation the group has to make.
   */
  private settleResidual(
    equityLines: Map<string, ConsolidatedLine>,
    receivable: number,
    payable: number,
    left: GroupMember,
    right: GroupMember,
    warnings: ConsolidationWarning[],
  ): void {
    const residual = roundAmount(receivable - payable);
    if (toCents(residual) === 0) return;
    this.addSynthetic(equityLines, 'CONS-CTA', 'consolidation.line.translation_reserve', AccountType.EQUITY, -residual, left);
    if (Math.abs(residual) > Math.max(1, Math.max(Math.abs(receivable), Math.abs(payable)) * 0.005)) {
      warnings.push({
        code: 'INTRAGROUP_MISMATCH',
        organizationId: left.organizationId,
        detail: this.say('consolidation.warning.intragroup_balance_mismatch', { left: left.legalName, right: right.legalName, receivable, payable }),
      });
    }
  }

  /** The consolidated line an account of a member lands in: its mapped parent account, or itself. */
  private async lineFor(
    organizationId: string,
    accountId: string | null,
    mapping: Map<string, ReportAccountLine>,
  ): Promise<{ code: string } | null> {
    if (!accountId) return null;
    const mapped = mapping.get(accountId);
    if (mapped) return { code: mapped.code };
    const [row] = await this.dataSource.query(`SELECT code FROM accounts WHERE id = $1 AND organization_id = $2`, [accountId, organizationId]);
    return row ? { code: row.code } : null;
  }

  /**
   * Move an accumulated line by `delta`. When the account is not among the lines, the movement is
   * presented on a named elimination line instead, so the totals are right either way; returns
   * whether the real line was found.
   */
  private adjustLine(
    lines: Map<string, ConsolidatedLine>,
    identity: { code: string } | null,
    delta: number,
    fallback: SyntheticLine,
  ): boolean {
    if (toCents(delta) === 0) return true;
    const line = identity ? lines.get(identity.code) : undefined;
    if (line) {
      line.amount = roundAmount(line.amount + delta);
      return true;
    }
    this.addSyntheticLine(lines, fallback, delta);
    return false;
  }

  private synthetic(code: string, key: string, type: AccountType, category: AccountCategory): SyntheticLine {
    return { code, key, type, category };
  }

  private addSynthetic(
    lines: Map<string, ConsolidatedLine>,
    code: string,
    key: string,
    type: AccountType,
    amount: number,
    member: { organizationId: string; legalName: string },
  ): void {
    const category =
      type === AccountType.EQUITY ? AccountCategory.RETAINED_EARNINGS : type === AccountType.REVENUE ? AccountCategory.NON_OPERATING_REVENUE : AccountCategory.CURRENT_ASSET;
    this.addSyntheticLine(lines, { code, key, type, category }, amount, member);
  }

  private addSyntheticLine(
    lines: Map<string, ConsolidatedLine>,
    synthetic: SyntheticLine,
    amount: number,
    member?: { organizationId: string; legalName: string },
  ): void {
    const value = roundAmount(amount);
    if (toCents(value) === 0) return;
    const existing = lines.get(synthetic.code);
    const contribution = member ? [{ organizationId: member.organizationId, legalName: member.legalName, amount: value }] : [];
    if (existing) {
      existing.amount = roundAmount(existing.amount + value);
      existing.contributions.push(...contribution);
      return;
    }
    lines.set(synthetic.code, {
      accountId: synthetic.code,
      code: synthetic.code,
      name: this.say(synthetic.key),
      type: synthetic.type,
      category: synthetic.category,
      amount: value,
      contributions: contribution,
    });
  }

  /** The fraction of a subsidiary that belongs to someone other than the group. */
  private outsideShare(ownership: number): number {
    const owned = Number(ownership);
    if (!Number.isFinite(owned) || owned <= 0) return 1;
    if (owned >= 100) return 0;
    return roundAmount(1 - owned / 100, 6);
  }
}

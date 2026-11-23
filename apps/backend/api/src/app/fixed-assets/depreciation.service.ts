import { ExclusiveJob } from '../shared/scheduling/exclusive-job';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DepreciationPort } from './depreciation.port';
import { REGISTER_REASON } from './register-reasons';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { DepreciationRunTrigger, FixedAssetDepreciationRun } from './entities/fixed-asset-depreciation-run.entity';
import { AssetPostingService } from './asset-posting.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Cron } from '@nestjs/schedule';
import { Ledger } from '../accounting/entities/ledger.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError, NotFoundError, UnprocessableEntityError } from '../i18n/localized.exception';
import { personDisplayNames } from '../users/contracts/person-names.contract';
import { resolvePaging, toPage, type Page } from '../common/pagination';
import { DepreciationRunsQueryDto } from './dto/fixed-asset.dto';
import { organizationToday } from '../organizations/contracts/fiscal-today.contract';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { roundAmount, toCents } from '../common/money';
import { endOfMonthIso, previousDay, startOfMonthIso, toIsoDate, toIsoMonth, type IsoDate } from '../common/dates';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { chargesDue, disposalMonthCharge, ScheduledCharge, type DepreciableAsset } from './depreciation-schedule';
import { DEFAULT_DEPRECIATION_CONVENTION, type DepreciationConvention } from '@virtex/shared/types';
import { closingThrough, resolvePostingPeriod } from '../accounting/period-status';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';
import { narrated } from '../contracts/ledger-posting/ledger-text';
import { PlannedBookCharges, TaxBookService } from './tax-book.service';
import { FiscalYearCalendar, yearOpenings } from './fiscal-year-calendar';

/** Why an asset due a charge was left out of a run. */
export type DepreciationSkipReason = 'missing_accounts';

/** What set a run going, and who: the run's record says so, and its entries lead back to it. */
export interface DepreciationRunOrigin {
  trigger: Exclude<DepreciationRunTrigger, DepreciationRunTrigger.DISPOSAL>;
  /** The person who ran it, or closed the period that did; null for the monthly job. */
  ranByUserId: string | null;
}

/** What one run charged. */
export interface DepreciationRunResult {
  /** The last day of the month the run was for. */
  periodEnd: IsoDate;
  /** The run's record — null when nothing was due, and for a preview. */
  runId: string | null;
  /** The entry it posted (the latest, when it caught up several months), or null. */
  journalEntryId: string | null;
  total: number;
  assets: Array<{ id: string; number: string; name: string; months: number; amount: number }>;
  /** Assets that were due a charge and could not be charged, with the reason. */
  skipped: Array<{ id: string; number: string; name: string; reason: DepreciationSkipReason }>;
  /** What it charged in the tax books (FINB-16): recorded, posted nowhere. */
  tax: { total: number; assets: Array<{ id: string; number: string; name: string; months: number; amount: number }> };
  /**
   * Whether the run can be posted: false for a month that has not ended yet in the company's
   * calendar (FINB-13), with the reason — the preview still shows what it would charge.
   */
  postable: boolean;
  notPostable: { key: string; params: Record<string, unknown> } | null;
}

/** A run, as the board lists it. */
export interface DepreciationRunSummary {
  id: string;
  periodEnd: IsoDate;
  trigger: DepreciationRunTrigger;
  /** The asset whose disposal ran it, for a disposal's run. */
  fixedAsset: { id: string; number: string; name: string } | null;
  ranByUserId: string | null;
  ranByName: string | null;
  assetCount: number;
  chargeCount: number;
  total: number;
  /** The tax book's months it charged, and their total. */
  taxChargeCount: number;
  taxTotal: number;
  createdAt: Date;
}

/** A run with every asset-month it charged and the entries that carry them. */
export interface DepreciationRunDetail extends DepreciationRunSummary {
  charges: Array<{
    fixedAssetId: string;
    number: string;
    name: string;
    periodEnd: IsoDate;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
    journalEntryId: string;
  }>;
  entries: Array<{ id: string; entryNumber: string | null; date: IsoDate; total: number }>;
  /** The tax book's months it charged. */
  taxCharges: Array<{
    fixedAssetId: string;
    number: string;
    name: string;
    periodEnd: IsoDate;
    amount: number;
    accumulatedAfter: number;
    bookValueAfter: number;
  }>;
}

/** What set a run going, as its record says it. */
interface RunOrigin {
  trigger: DepreciationRunTrigger;
  ranByUserId: string | null;
  fixedAssetId: string | null;
}

/**
 * What a disposal is charged for depreciation: the run that charged the months still due before
 * the disposal month, and that month's own charge — through the day the asset leaves — with the
 * accounts it goes to, for the disposal's entry to carry. Both null when nothing was due.
 */
export interface DisposalDepreciation {
  runId: string | null;
  stub: (ScheduledCharge & { expenseAccountId: string; accumulatedAccountId: string }) | null;
}

/** A charge planned for an asset, before it is posted. */
interface PlannedAsset {
  asset: FixedAsset;
  charges: ScheduledCharge[];
  amount: number;
  expenseAccountId: string;
  accumulatedAccountId: string;
}

/**
 * Monthly depreciation.
 *
 * ## Defects this has replaced, in order
 *
 * The cron was `EVERY_DAY_AT_2AM` with no marker of what had already been depreciated, so a
 * five-year asset was written down in about two months. `accumulatedDepreciation` arrived as a
 * string and `+=` concatenated. One entry per asset filled the consecutive series. And the period
 * close passed a `date` column's string where a `Date` was expected, and failed for every tenant.
 *
 * Then: a run charged ONE month per asset, under a claim that marked the month done for the whole
 * tenant. An asset registered after its month had run lost that month for good — its write-off
 * ended later than its useful life said, and the books carried it too high meanwhile. Every charge
 * went to the company's default accounts, whatever the asset's own were — so a disposal debited
 * one accumulated-depreciation account while the runs had credited another.
 *
 * ## How it works now
 *
 * Every run charges each asset every month it is due, through the run's month (`chargesDue`), to
 * the asset's own accounts (the company's defaults only where the asset names none), in one entry
 * per month dated on that month's last day (a month whose period is closed is booked in the run's
 * month instead), and records each asset-month in `fixed_asset_depreciations`. The
 * unique (asset, month) row and the asset's `depreciatedThrough` make any run idempotent — the
 * scheduler's, the period close's, a manual one, or two at once — and a transaction-scoped
 * advisory lock per tenant serialises concurrent runs so the second sees the first's work.
 */
@Injectable()
export class DepreciationService extends DepreciationPort {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(
    private readonly assetPosting: AssetPostingService,
    private readonly schedulerLock: SchedulerLockService,
    private readonly dataSource: DataSource,
    private readonly orgSettings: OrgSettingsService,
    private readonly journalLookup: JournalLookupService,
    /** The assets' tax books, charged by the same runs (FINB-16). */
    private readonly taxBooks: TaxBookService,
    /** Narratives in the tenant's books language; see `LedgerNarrativeService`. */
    private readonly narrative: LedgerNarrativeService = new LedgerNarrativeService(
      new I18nService(),
    ),
  ) {
    super();
  }

  /**
   * Fires on the first of the month for the month that just ended. The claim keeps several
   * replicas from walking every tenant at once; the run itself would be safe regardless.
   *
   * Noon UTC on the first is the first moment the month has ended everywhere — at UTC−12 it is
   * midnight. It fired at 02:00 UTC, when the month was still running for every company west of
   * Greenwich: their books were charged a month they were still living, and since a run refuses a
   * month that has not ended (FINB-13), at that hour it would not have charged them at all. Each
   * company is charged through the last month ended in its own calendar, not in the server's.
   */
  @Cron('0 12 1 * *', { name: 'monthly-depreciation' })
  @ExclusiveJob()
  async handleCron(): Promise<void> {
    const now = new Date();
    const monthJustEnded = toIsoMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15)));

    await this.schedulerLock.runOnce('monthly-depreciation', monthJustEnded, async () => {
      // Each tenant in its own context: the assets are behind the row-level policies, and a run
      // with no tenant set found none and depreciated nothing.
      await forEachTenant(
        this.dataSource,
        (organizationId) => this.chargeLastEndedMonth(organizationId),
        undefined,
        (organizationId, error) =>
          this.logger.error(`Depreciation failed for organization ${organizationId}: ${(error as Error).message}`),
      );
    });
  }

  /** The monthly job for one company: through the last month ended in its own calendar. */
  private async chargeLastEndedMonth(organizationId: string): Promise<void> {
    const today = await organizationToday(this.dataSource.manager, organizationId);
    await this.runMonthlyDepreciation(organizationId, lastEndedMonth(today), {
      trigger: DepreciationRunTrigger.SCHEDULE,
      ranByUserId: null,
    });
  }

  /** `DepreciationPort.runForPeriod`: the period close charges the month it closes. */
  override async runForPeriod(
    organizationId: string,
    period: { startDate: IsoDate; endDate: IsoDate },
    manager?: EntityManager,
    closedByUserId: string | null = null,
  ): Promise<void> {
    await this.runMonthlyDepreciation(
      organizationId,
      period.endDate,
      { trigger: DepreciationRunTrigger.PERIOD_CLOSE, ranByUserId: closedByUserId },
      manager,
    );
  }

  /**
   * Charge every in-use asset of the tenant everything it is due through the month of
   * `depreciationDate`.
   *
   * @param depreciationDate any date inside the month to charge through, as an `IsoDate` (what a
   *   `date` column hands back) or a `Date`.
   * @param origin what set the run going and who, recorded with it.
   */
  async runMonthlyDepreciation(
    organizationId: string,
    depreciationDate: Date | string,
    origin: DepreciationRunOrigin,
    manager?: EntityManager,
  ): Promise<DepreciationRunResult> {
    const periodEnd = endOfMonthIso(toIsoDate(depreciationDate));
    const execute = async (em: EntityManager) => {
      const blocked = await this.notYetEnded(em, organizationId, periodEnd);
      if (blocked) throw new UnprocessableEntityError(blocked.key, blocked.params);
      await this.lockTenant(em, organizationId);
      const assets = await em.find(FixedAsset, {
        where: { organizationId, status: FixedAssetStatus.IN_USE },
        order: { number: 'ASC' },
      });
      return this.charge(em, organizationId, assets, periodEnd, { ...origin, fixedAssetId: null });
    };
    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }

  /** What a run for the month would charge, without posting anything. */
  async preview(organizationId: string, depreciationDate: Date | string): Promise<DepreciationRunResult> {
    const periodEnd = endOfMonthIso(toIsoDate(depreciationDate));
    const manager = this.dataSource.manager;
    const assets = await manager.find(FixedAsset, {
      where: { organizationId, status: FixedAssetStatus.IN_USE },
      order: { number: 'ASC' },
    });
    const { planned, skipped } = await this.plan(manager, organizationId, assets, periodEnd);
    const taxPlanned = await this.taxBooks.plan(manager, organizationId, assets, periodEnd);
    return {
      ...summarise(periodEnd, null, null, planned, skipped, taxPlanned),
      ...postability(await this.notYetEnded(manager, organizationId, periodEnd)),
    };
  }

  /**
   * Why a month cannot be charged yet, or null: a month is depreciated once it has ended in the
   * company's calendar — or while the close of that very month runs, which may close it early.
   *
   * There was no such check: on the 7th of November a run for November posted the whole month
   * dated the 30th, and the preview offered to post 25 months that had not happened (FINB-13) —
   * expense booked ahead of its time, and an asset carried below its value until then.
   */
  private async notYetEnded(em: EntityManager, organizationId: string, periodEnd: IsoDate): Promise<DepreciationRunResult['notPostable']> {
    const today = await organizationToday(em, organizationId);
    if (periodEnd <= today) return null;
    const closing = await closingThrough(em);
    if (closing && closing >= periodEnd) return null;
    return { key: 'fixed_assets.depreciation_period_not_ended', params: { period: toIsoMonth(periodEnd), today } };
  }

  private async charge(
    em: EntityManager,
    organizationId: string,
    assets: FixedAsset[],
    periodEnd: IsoDate,
    origin: RunOrigin,
  ): Promise<DepreciationRunResult> {
    const { planned, skipped } = await this.plan(em, organizationId, assets, periodEnd);
    for (const skip of skipped) {
      this.logger.warn(`Activo ${skip.number} sin cuentas de depreciación en ${organizationId}; se omite.`);
    }
    // The tax books too: an asset may owe tax months when its accounting book owes none.
    const taxPlanned = await this.taxBooks.plan(em, organizationId, assets, periodEnd);
    if (planned.length === 0 && taxPlanned.length === 0) return summarise(periodEnd, null, null, [], skipped, []);

    const totals = summarise(periodEnd, null, null, planned, skipped, taxPlanned);
    const run = await this.openRun(em, organizationId, periodEnd, origin, {
      assetCount: new Set([...planned.map((item) => item.asset.id), ...taxPlanned.map((item) => item.asset.id)]).size,
      chargeCount: planned.reduce((count, item) => count + item.charges.length, 0),
      total: totals.total,
      taxChargeCount: taxPlanned.reduce((count, item) => count + item.charges.length, 0),
      taxTotal: totals.tax.total,
    });
    const runEntryId = planned.length > 0 ? await this.post(em, organizationId, run, planned, periodEnd, origin) : null;
    await this.taxBooks.record(em, run.id, taxPlanned);

    // The latest entry: the run's own month whenever anything was due in it.
    const result = summarise(periodEnd, run.id, runEntryId, planned, skipped, taxPlanned);
    this.logger.log(
      `Depreciación hasta ${toIsoMonth(periodEnd)} registrada en ${organizationId}: ${planned.length} activos, ${result.total}.`,
    );
    return result;
  }

  /**
   * Before an asset leaves the books on `disposalDate`: every month it is still due before the
   * disposal month is charged, each in its own entry, and the disposal month's own charge — through
   * the day it leaves, by its convention (FINB-12) — is worked out for the disposal's entry to
   * carry. One run, the disposal's, records both; `recordDisposalCharge` books the second once that
   * entry exists.
   *
   * A month due that cannot be charged — no expense account on the asset nor on the company — stops
   * the disposal: the asset would leave the books above its carrying amount, and the loss on it
   * would be overstated by the depreciation nobody charged.
   */
  async prepareDisposal(
    manager: EntityManager,
    asset: FixedAsset,
    disposalDate: IsoDate,
    disposedByUserId: string | null,
  ): Promise<DisposalDepreciation> {
    const organizationId = asset.organizationId;
    await this.lockTenant(manager, organizationId);
    const lastMonthBefore = previousDay(startOfMonthIso(disposalDate));
    const { planned, skipped } = await this.plan(manager, organizationId, [asset], lastMonthBefore);

    // The disposal month, projected on from the same state: the months before it charged as the
    // catch-up charges them, in the year they fall in.
    const catchUp = planned[0]?.charges ?? [];
    const stub = disposalMonthCharge((await this.depreciables(manager, organizationId, [asset])).get(asset.id) ?? asset, disposalDate);
    // The tax book leaves with it: its months due before the disposal month and that month's own.
    const taxClosing = await this.taxBooks.planClosing(manager, asset, disposalDate);
    const taxCharges = taxClosing?.charges ?? [];
    const accountingDue = skipped.length > 0 || catchUp.length > 0 || !!stub;
    if (!accountingDue && taxCharges.length === 0) {
      if (taxClosing) await this.taxBooks.close(manager, taxClosing.book, disposalDate);
      return { runId: null, stub: null };
    }
    const accounts = accountingDue ? await this.accountsFor(manager, organizationId, asset) : null;
    if (accountingDue && (skipped.length > 0 || !accounts)) {
      throw new BadRequestError('fixed_assets.disposal_depreciation_accounts_missing', { number: asset.number });
    }

    const origin: RunOrigin = { trigger: DepreciationRunTrigger.DISPOSAL, ranByUserId: disposedByUserId, fixedAssetId: asset.id };
    const total = roundAmount((catchUp.reduce((sum, charge) => sum + toCents(charge.amount), 0) + (stub ? toCents(stub.amount) : 0)) / 100);
    const lastMonth = [stub?.periodEnd, catchUp.at(-1)?.periodEnd, taxCharges.at(-1)?.periodEnd].filter(Boolean).sort().at(-1) as IsoDate;
    const run = await this.openRun(manager, organizationId, lastMonth, origin, {
      assetCount: 1,
      chargeCount: catchUp.length + (stub ? 1 : 0),
      total,
      taxChargeCount: taxCharges.length,
      taxTotal: taxClosing?.amount ?? 0,
    });
    if (catchUp.length > 0) await this.post(manager, organizationId, run, planned, lastMonthBefore, origin);
    if (taxClosing) {
      await this.taxBooks.record(manager, run.id, [taxClosing]);
      await this.taxBooks.close(manager, taxClosing.book, disposalDate);
    }
    return { runId: run.id, stub: stub && accounts ? { ...stub, ...accounts } : null };
  }

  /** Books the disposal month's charge, carried by the disposal's own entry `journalEntryId`. */
  async recordDisposalCharge(
    manager: EntityManager,
    asset: FixedAsset,
    disposal: DisposalDepreciation,
    journalEntryId: string,
  ): Promise<void> {
    const { stub, runId } = disposal;
    if (!stub || !runId) return;
    await manager.insert(FixedAssetDepreciation, {
      organizationId: asset.organizationId,
      fixedAssetId: asset.id,
      periodEnd: stub.periodEnd,
      amount: stub.amount,
      accumulatedAfter: stub.accumulatedAfter,
      bookValueAfter: stub.bookValueAfter,
      journalEntryId,
      runId,
    });
    asset.accumulatedDepreciation = stub.accumulatedAfter;
    asset.bookValue = stub.bookValueAfter;
    asset.depreciatedThrough = stub.periodEnd;
  }

  /** The run's record, written before anything it posts: its entries name it. */
  private async openRun(
    em: EntityManager,
    organizationId: string,
    periodEnd: IsoDate,
    origin: RunOrigin,
    totals: { assetCount: number; chargeCount: number; total: number; taxChargeCount: number; taxTotal: number },
  ): Promise<FixedAssetDepreciationRun> {
    return em.save(
      em.create(FixedAssetDepreciationRun, {
        organizationId,
        periodEnd,
        trigger: origin.trigger,
        fixedAssetId: origin.fixedAssetId,
        ranByUserId: origin.ranByUserId,
        ...totals,
      }),
    );
  }

  /**
   * Posts what `planned` charges — one entry per month, dated on its last day — records every
   * asset-month under `run`, and moves each asset on. Returns the latest entry.
   */
  private async post(
    em: EntityManager,
    organizationId: string,
    run: FixedAssetDepreciationRun,
    planned: PlannedAsset[],
    periodEnd: IsoDate,
    origin: RunOrigin,
  ): Promise<string | null> {
    // Only now that something is due: a company with no assets to charge must not need a ledger
    // or a journal it will never post to (QA C-06).
    const defaultLedger = await em.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!defaultLedger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
    const journal = await this.journalLookup.findByCode(organizationId, SYSTEM_JOURNALS.depreciation.code, em);
    if (!journal) throw new BadRequestError('fixed_assets.depreciation_journal_deprec_not_found_create');
    // What posted the entries: a disposal's catch-up, or a run of the register.
    const systemReason = origin.trigger === DepreciationRunTrigger.DISPOSAL ? REGISTER_REASON.disposalRun : REGISTER_REASON.depreciationRun;

    // One entry per month, dated on that month's last day (QA R3-M14: a run that caught up August
    // and September booked both in one entry dated 30/09, so August's expense sat in September's
    // income statement). A month whose period is already closed cannot take its own entry; its
    // charge goes into the run's month instead, still described as the month it belongs to.
    const postingDates = new Map<IsoDate, IsoDate>();
    for (const { charges } of planned) {
      for (const charge of charges) {
        if (!postingDates.has(charge.periodEnd)) {
          postingDates.set(
            charge.periodEnd,
            charge.periodEnd === periodEnd || (await this.isPostable(em, organizationId, charge.periodEnd))
              ? charge.periodEnd
              : periodEnd,
          );
        }
      }
    }

    const groups = new Map<IsoDate, { lines: CreateJournalEntryLineDto[]; rows: Array<{ asset: FixedAsset; charge: ScheduledCharge }> }>();
    for (const { asset, charges, expenseAccountId, accumulatedAccountId } of planned) {
      for (const charge of charges) {
        const postOn = postingDates.get(charge.periodEnd) ?? periodEnd;
        const group = groups.get(postOn) ?? { lines: [], rows: [] };
        groups.set(postOn, group);
        group.lines.push(
          ...(await this.chargeLines(em, organizationId, asset, charge, { expenseAccountId, accumulatedAccountId }, defaultLedger.id)),
        );
        group.rows.push({ asset, charge });
      }
    }

    let runEntryId: string | null = null;
    for (const postOn of [...groups.keys()].sort()) {
      const group = groups.get(postOn)!;
      const entry = await this.assetPosting.createWithManager(
        em,
        {
          date: postOn,
          ...narrated(await this.narrative.describe(em, organizationId, 'ledger.depreciation.entry', { month: toIsoMonth(postOn) })),
          journalId: journal.id,
          lines: group.lines,
        } as CreateJournalEntryDto,
        organizationId,
        // Each entry names its run and the date it is posted on — one per month — so it leads back
        // to the run, and a run cannot post the same month's entry twice.
        { actorUserId: origin.ranByUserId, systemReason, idempotencyKey: `depreciation-run:${run.id}:${postOn}` },
      );
      runEntryId = entry.id;
      await em.insert(
        FixedAssetDepreciation,
        group.rows.map(({ asset, charge }) => ({
          organizationId,
          fixedAssetId: asset.id,
          periodEnd: charge.periodEnd,
          amount: charge.amount,
          accumulatedAfter: charge.accumulatedAfter,
          bookValueAfter: charge.bookValueAfter,
          journalEntryId: entry.id,
          runId: run.id,
        })),
      );
    }

    for (const { asset, charges } of planned) {
      const last = charges[charges.length - 1];
      await em.update(
        FixedAsset,
        { id: asset.id, organizationId },
        {
          accumulatedDepreciation: last.accumulatedAfter,
          bookValue: last.bookValueAfter,
          depreciatedThrough: last.periodEnd,
        },
      );
      asset.accumulatedDepreciation = last.accumulatedAfter;
      asset.bookValue = last.bookValueAfter;
      asset.depreciatedThrough = last.periodEnd;
    }
    return runEntryId;
  }

  /**
   * The two lines that charge `charge` to `asset`: the expense, and the accumulated depreciation.
   * The disposal's entry carries the same two for the month the asset leaves in.
   */
  async chargeLines(
    em: EntityManager,
    organizationId: string,
    asset: FixedAsset,
    charge: Pick<ScheduledCharge, 'periodEnd' | 'amount'>,
    accounts: { expenseAccountId: string; accumulatedAccountId: string },
    ledgerId: string,
  ): Promise<CreateJournalEntryLineDto[]> {
    const month = toIsoMonth(charge.periodEnd);
    const amount = roundAmount(charge.amount);
    const words = await this.narrative.describeAll(em, organizationId, {
      expense: { key: 'ledger.depreciation.expense', params: { month, asset: `${asset.number} ${asset.name}` } },
      accumulated: { key: 'ledger.depreciation.accumulated', params: { month, asset: `${asset.number} ${asset.name}` } },
    });
    // A depreciation charge consumes cost that originated when the asset was acquired: the
    // restatement for inflation restates the charge and the accumulated depreciation from then,
    // as it does the cost (IAS 29.15; FIN-AC-04), not from the month it was booked.
    const originDate = toIsoDate(asset.acquisitionDate);
    return [
      {
        accountId: accounts.expenseAccountId,
        debit: amount,
        credit: 0,
        ...narrated(words.expense),
        originDate,
        valuations: [{ ledgerId, debit: amount, credit: 0 }],
      },
      {
        accountId: accounts.accumulatedAccountId,
        debit: 0,
        credit: amount,
        ...narrated(words.accumulated),
        originDate,
        valuations: [{ ledgerId, debit: 0, credit: amount }],
      },
    ];
  }

  /** The asset's own accounts, the company's where it names none; null when one is missing. */
  private async accountsFor(
    em: EntityManager,
    organizationId: string,
    asset: FixedAsset,
  ): Promise<{ expenseAccountId: string; accumulatedAccountId: string } | null> {
    if (asset.depreciationExpenseAccountId && asset.accumulatedDepreciationAccountId) {
      return { expenseAccountId: asset.depreciationExpenseAccountId, accumulatedAccountId: asset.accumulatedDepreciationAccountId };
    }
    const settings = await this.settingsOf(em, organizationId);
    const expenseAccountId = asset.depreciationExpenseAccountId ?? settings?.defaultDepreciationExpenseAccountId ?? null;
    const accumulatedAccountId = asset.accumulatedDepreciationAccountId ?? settings?.defaultAccumulatedDepreciationAccountId ?? null;
    return expenseAccountId && accumulatedAccountId ? { expenseAccountId, accumulatedAccountId } : null;
  }

  /** The convention a new asset of the company follows unless it says otherwise (FINB-12). */
  async defaultConvention(manager: EntityManager, organizationId: string): Promise<DepreciationConvention> {
    const settings = await this.settingsOf(manager, organizationId);
    return settings?.defaultDepreciationConvention ?? DEFAULT_DEPRECIATION_CONVENTION;
  }

  /** The company's settings, on the caller's transaction: its default accounts and convention. */
  private settingsOf(em: EntityManager, organizationId: string): ReturnType<OrgSettingsService['getForOrg']> {
    return this.orgSettings.getForOrg(organizationId, em);
  }

  /** Which assets are due what, and to which accounts. */
  private async plan(
    em: EntityManager,
    organizationId: string,
    assets: FixedAsset[],
    periodEnd: IsoDate,
  ): Promise<{ planned: PlannedAsset[]; skipped: DepreciationRunResult['skipped'] }> {
    const planned: PlannedAsset[] = [];
    const skipped: DepreciationRunResult['skipped'] = [];
    let settings: Awaited<ReturnType<OrgSettingsService['getForOrg']>> | undefined;
    const depreciables = await this.depreciables(em, organizationId, assets);

    for (const asset of assets) {
      const charges = chargesDue(depreciables.get(asset.id) ?? asset, periodEnd);
      if (charges.length === 0) continue;

      if (settings === undefined) settings = await this.settingsOf(em, organizationId);
      const expenseAccountId = asset.depreciationExpenseAccountId ?? settings?.defaultDepreciationExpenseAccountId ?? null;
      const accumulatedAccountId =
        asset.accumulatedDepreciationAccountId ?? settings?.defaultAccumulatedDepreciationAccountId ?? null;
      if (!expenseAccountId || !accumulatedAccountId) {
        skipped.push({ id: asset.id, number: asset.number, name: asset.name, reason: 'missing_accounts' });
        continue;
      }
      const amount = roundAmount(charges.reduce((sum, charge) => sum + toCents(charge.amount), 0) / 100);
      planned.push({ asset, charges, amount, expenseAccountId, accumulatedAccountId });
    }
    return { planned, skipped };
  }

  /**
   * The assets as the calculation reads them: each with the company's fiscal year its next month
   * falls in, and what it had accumulated when that year began — what a declining balance's yearly
   * rate applies to, and what a straight line's year adds up from (FINB-16). One query per year
   * start the assets share.
   */
  async depreciables(em: EntityManager, organizationId: string, assets: readonly FixedAsset[]): Promise<Map<string, DepreciableAsset>> {
    const result = new Map<string, DepreciableAsset>();
    if (assets.length === 0) return result;
    const calendar = await FiscalYearCalendar.load(em, organizationId);
    const openings = await yearOpenings(
      calendar,
      assets.map((asset) => ({
        id: asset.id,
        accumulatedDepreciation: asset.accumulatedDepreciation,
        inServiceDate: toIsoDate(asset.inServiceDate),
        depreciatedThrough: asset.depreciatedThrough ? toIsoDate(asset.depreciatedThrough) : null,
      })),
      async (yearStart, ids) => {
        const rows: Array<{ fixed_asset_id: string; charged: string }> = await em.query(
          `SELECT "fixed_asset_id", SUM("amount")::text AS charged FROM "fixed_asset_depreciations"
            WHERE "organization_id" = $1 AND "fixed_asset_id" = ANY($2::uuid[]) AND "period_end" >= $3::date
            GROUP BY "fixed_asset_id"`,
          [organizationId, ids, yearStart],
        );
        return new Map(rows.map((row) => [row.fixed_asset_id, Number(row.charged)]));
      },
    );
    for (const asset of assets) {
      const year = openings.get(asset.id);
      result.set(asset.id, {
        ...asset,
        fiscalYearStartMonth: year?.fiscalYearStartMonth ?? 1,
        yearOpeningAccumulated: year?.opening ?? null,
      });
    }
    return result;
  }

  /** Whether a past month can still take its own entry: its period exists and is open. */
  private async isPostable(em: EntityManager, organizationId: string, date: IsoDate): Promise<boolean> {
    try {
      await resolvePostingPeriod(em, organizationId, date, ModuleSlug.GL);
      return true;
    } catch {
      return false;
    }
  }

  /** The runs that charged something, newest first — by what set them going, or for one asset. */
  async listRuns(organizationId: string, query: DepreciationRunsQueryDto = {}): Promise<Page<DepreciationRunSummary>> {
    const paging = resolvePaging(query.page, query.pageSize);
    const qb = this.dataSource
      .getRepository(FixedAssetDepreciationRun)
      .createQueryBuilder('run')
      .leftJoinAndSelect('run.fixedAsset', 'asset')
      .where('run.organizationId = :organizationId', { organizationId });
    if (query.trigger) qb.andWhere('run.trigger = :trigger', { trigger: query.trigger });
    if (query.fixedAssetId) {
      // A run charged the asset if any of its months is the asset's — not only a disposal's run.
      qb.andWhere(
        `(EXISTS (SELECT 1 FROM "fixed_asset_depreciations" d WHERE d."run_id" = run.id AND d."fixed_asset_id" = :assetId)
          OR EXISTS (SELECT 1 FROM "fixed_asset_book_charges" c JOIN "fixed_asset_books" b ON b."id" = c."book_id"
                      WHERE c."run_id" = run.id AND b."fixed_asset_id" = :assetId))`,
        { assetId: query.fixedAssetId },
      );
    }
    const [runs, total] = await qb
      .orderBy('run.createdAt', 'DESC')
      .addOrderBy('run.id', 'DESC')
      .skip(paging.skip)
      .take(paging.take)
      .getManyAndCount();
    const people = await personDisplayNames(this.dataSource.manager, runs.map((run) => run.ranByUserId));
    return toPage(runs.map((run) => summariseRun(run, people)), total, paging);
  }

  /** One run: each asset-month it charged, and the entries that carry them. */
  async findRun(id: string, organizationId: string): Promise<DepreciationRunDetail> {
    const manager = this.dataSource.manager;
    const run = await manager.findOne(FixedAssetDepreciationRun, {
      where: { id, organizationId },
      relations: { fixedAsset: true },
    });
    if (!run) throw new NotFoundError('fixed_assets.depreciation_run_not_found', { id });

    const charges = await manager
      .getRepository(FixedAssetDepreciation)
      .createQueryBuilder('charge')
      .innerJoinAndSelect('charge.fixedAsset', 'asset')
      .where('charge.organizationId = :organizationId AND charge.runId = :runId', { organizationId, runId: id })
      .orderBy('asset.number', 'ASC')
      .addOrderBy('charge.periodEnd', 'ASC')
      .getMany();
    const entryIds = [...new Set(charges.map((charge) => charge.journalEntryId))];
    const entries: Array<{ id: string; entryNumber: string | null; date: string; total: string }> = entryIds.length
      ? await manager.query(
          `SELECT e."id", e."entry_number" AS "entryNumber", e."date"::text AS "date",
                  COALESCE(SUM(l."debit"), 0)::text AS "total"
             FROM "journal_entries" e
             LEFT JOIN "journal_entry_lines" l ON l."journal_entry_id" = e."id"
            WHERE e."organization_id" = $1 AND e."id" = ANY($2::uuid[])
            GROUP BY e."id"
            ORDER BY e."date", e."entry_number"`,
          [organizationId, entryIds],
        )
      : [];
    const taxCharges: Array<{ fixedAssetId: string; number: string; name: string; periodEnd: string; amount: string; accumulatedAfter: string; bookValueAfter: string }> =
      await manager.query(
        `SELECT b."fixed_asset_id" AS "fixedAssetId", a."number", a."name", c."period_end"::text AS "periodEnd",
                c."amount"::text AS "amount", c."accumulated_after"::text AS "accumulatedAfter", c."book_value_after"::text AS "bookValueAfter"
           FROM "fixed_asset_book_charges" c
           JOIN "fixed_asset_books" b ON b."id" = c."book_id"
           JOIN "fixed_asset" a ON a."id" = b."fixed_asset_id"
          WHERE c."organization_id" = $1 AND c."run_id" = $2
          ORDER BY a."number", c."period_end"`,
        [organizationId, id],
      );
    const people = await personDisplayNames(manager, [run.ranByUserId]);
    return {
      ...summariseRun(run, people),
      taxCharges: taxCharges.map((charge) => ({
        fixedAssetId: charge.fixedAssetId,
        number: charge.number,
        name: charge.name,
        periodEnd: charge.periodEnd,
        amount: Number(charge.amount),
        accumulatedAfter: Number(charge.accumulatedAfter),
        bookValueAfter: Number(charge.bookValueAfter),
      })),
      charges: charges.map((charge) => ({
        fixedAssetId: charge.fixedAssetId,
        number: charge.fixedAsset!.number,
        name: charge.fixedAsset!.name,
        periodEnd: toIsoDate(charge.periodEnd),
        amount: charge.amount,
        accumulatedAfter: charge.accumulatedAfter,
        bookValueAfter: charge.bookValueAfter,
        journalEntryId: charge.journalEntryId,
      })),
      entries: entries.map((entry) => ({
        id: entry.id,
        entryNumber: entry.entryNumber,
        date: entry.date,
        total: roundAmount(Number(entry.total)),
      })),
    };
  }

  /**
   * One run per tenant at a time. Transaction-scoped: released at commit or rollback, so a failed
   * run leaves nothing claimed — the period close's rollback included.
   */
  private async lockTenant(em: EntityManager, organizationId: string): Promise<void> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fixed-asset-depreciation:${organizationId}`]);
  }
}

function summariseRun(run: FixedAssetDepreciationRun, people: Map<string, string>): DepreciationRunSummary {
  return {
    id: run.id,
    periodEnd: toIsoDate(run.periodEnd),
    trigger: run.trigger,
    fixedAsset: run.fixedAsset ? { id: run.fixedAsset.id, number: run.fixedAsset.number, name: run.fixedAsset.name } : null,
    ranByUserId: run.ranByUserId,
    ranByName: people.get(run.ranByUserId ?? '') ?? null,
    assetCount: run.assetCount,
    chargeCount: run.chargeCount,
    total: run.total,
    taxChargeCount: run.taxChargeCount,
    taxTotal: run.taxTotal,
    createdAt: run.createdAt,
  };
}

/** The last day of the last month that has ended on `today`: the month before today's. */
export function lastEndedMonth(today: IsoDate): IsoDate {
  return previousDay(startOfMonthIso(today));
}

/** A posted run, or a preview: postable unless the month has not ended. */
function postability(blocked: DepreciationRunResult['notPostable']): Pick<DepreciationRunResult, 'postable' | 'notPostable'> {
  return { postable: blocked === null, notPostable: blocked };
}

function summarise(
  periodEnd: IsoDate,
  runId: string | null,
  journalEntryId: string | null,
  planned: PlannedAsset[],
  skipped: DepreciationRunResult['skipped'],
  taxPlanned: PlannedBookCharges[],
): DepreciationRunResult {
  const totalCents = planned.reduce((sum, item) => sum + toCents(item.amount), 0);
  const taxCents = taxPlanned.reduce((sum, item) => sum + toCents(item.amount), 0);
  return {
    periodEnd,
    runId,
    journalEntryId,
    total: roundAmount(totalCents / 100),
    assets: planned.map(({ asset, charges, amount }) => ({
      id: asset.id,
      number: asset.number,
      name: asset.name,
      months: charges.length,
      amount,
    })),
    skipped,
    tax: {
      total: roundAmount(taxCents / 100),
      assets: taxPlanned.map(({ asset, charges, amount }) => ({ id: asset.id, number: asset.number, name: asset.name, months: charges.length, amount })),
    },
    postable: true,
    notPostable: null,
  };
}

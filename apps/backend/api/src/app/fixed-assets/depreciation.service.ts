import { ExclusiveJob } from '../shared/scheduling/exclusive-job';
import { forEachTenant } from '../shared/tenancy/tenant-job';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DepreciationPort } from './depreciation.port';
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
import { chargesDue, disposalMonthCharge, ScheduledCharge } from './depreciation-schedule';
import { DEFAULT_DEPRECIATION_CONVENTION, type DepreciationConvention } from '@virtex/shared/types';
import { closingThrough, resolvePostingPeriod } from '../accounting/period-status';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';
import { SYSTEM_JOURNALS } from '../contracts/ledger-posting/system-journals';

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
    return {
      ...summarise(periodEnd, null, null, planned, skipped),
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
    if (planned.length === 0) return summarise(periodEnd, null, null, [], skipped);

    const totals = summarise(periodEnd, null, null, planned, skipped);
    const run = await this.openRun(em, organizationId, periodEnd, origin, {
      assetCount: planned.length,
      chargeCount: planned.reduce((count, item) => count + item.charges.length, 0),
      total: totals.total,
    });
    const runEntryId = await this.post(em, organizationId, run, planned, periodEnd, origin);

    // The latest entry: the run's own month whenever anything was due in it.
    const result = summarise(periodEnd, run.id, runEntryId, planned, skipped);
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

    // The disposal month, on the asset as the months before it leave it.
    const catchUp = planned[0]?.charges ?? [];
    const caughtUp = catchUp.at(-1);
    const stub = disposalMonthCharge(
      caughtUp
        ? { ...asset, accumulatedDepreciation: caughtUp.accumulatedAfter, depreciatedThrough: caughtUp.periodEnd }
        : asset,
      disposalDate,
    );
    if (skipped.length === 0 && catchUp.length === 0 && !stub) return { runId: null, stub: null };
    const accounts = await this.accountsFor(manager, organizationId, asset);
    if (skipped.length > 0 || !accounts) {
      throw new BadRequestError('fixed_assets.disposal_depreciation_accounts_missing', { number: asset.number });
    }

    const origin: RunOrigin = { trigger: DepreciationRunTrigger.DISPOSAL, ranByUserId: disposedByUserId, fixedAssetId: asset.id };
    const total = roundAmount((catchUp.reduce((sum, charge) => sum + toCents(charge.amount), 0) + (stub ? toCents(stub.amount) : 0)) / 100);
    const run = await this.openRun(manager, organizationId, stub?.periodEnd ?? catchUp.at(-1)!.periodEnd, origin, {
      assetCount: 1,
      chargeCount: catchUp.length + (stub ? 1 : 0),
      total,
    });
    if (catchUp.length > 0) await this.post(manager, organizationId, run, planned, lastMonthBefore, origin);
    return { runId: run.id, stub: stub ? { ...stub, ...accounts } : null };
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
    totals: { assetCount: number; chargeCount: number; total: number },
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
    const systemReason = origin.trigger === DepreciationRunTrigger.DISPOSAL ? 'asset-disposal' : 'depreciation-run';

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
          description: await this.narrative.describe(em, organizationId, 'ledger.depreciation.entry', { month: toIsoMonth(postOn) }),
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
        description: words.expense,
        originDate,
        valuations: [{ ledgerId, debit: amount, credit: 0 }],
      },
      {
        accountId: accounts.accumulatedAccountId,
        debit: 0,
        credit: amount,
        description: words.accumulated,
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

    for (const asset of assets) {
      const charges = chargesDue(asset, periodEnd);
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
        `EXISTS (SELECT 1 FROM "fixed_asset_depreciations" d WHERE d."run_id" = run.id AND d."fixed_asset_id" = :assetId)`,
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
    const people = await personDisplayNames(manager, [run.ranByUserId]);
    return {
      ...summariseRun(run, people),
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
): DepreciationRunResult {
  const totalCents = planned.reduce((sum, item) => sum + toCents(item.amount), 0);
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
    postable: true,
    notPostable: null,
  };
}

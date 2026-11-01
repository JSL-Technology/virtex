import { forEachTenant } from '../shared/tenancy/tenant-job';
import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { DepreciationPort } from './depreciation.port';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { FixedAssetDepreciation } from './entities/fixed-asset-depreciation.entity';
import { AssetPostingService } from './asset-posting.service';
import { OrgSettingsService } from '../organizations/services/org-settings.service';
import { JournalLookupService } from '../journal-entries/services/journal-lookup.service';
import { Cron } from '@nestjs/schedule';
import { Ledger } from '../accounting/entities/ledger.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { roundAmount, toCents } from '../common/money';
import { endOfMonthIso, toIsoDate, toIsoMonth, type IsoDate } from '../common/dates';
import { LedgerNarrativeService } from '../journal-entries/ledger-narrative.service';
import { I18nService } from '../i18n/i18n.service';
import { chargesDue, ScheduledCharge } from './depreciation-schedule';
import { resolvePostingPeriod } from '../accounting/period-status';
import { ModuleSlug } from '../accounting/entities/accounting-period.entity';

/** Why an asset due a charge was left out of a run. */
export type DepreciationSkipReason = 'missing_accounts';

/** What one run charged. */
export interface DepreciationRunResult {
  /** The last day of the month the run was for. */
  periodEnd: IsoDate;
  /** The entry it posted, or null when nothing was due. */
  journalEntryId: string | null;
  total: number;
  assets: Array<{ id: string; number: string; name: string; months: number; amount: number }>;
  /** Assets that were due a charge and could not be charged, with the reason. */
  skipped: Array<{ id: string; number: string; name: string; reason: DepreciationSkipReason }>;
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
   */
  @Cron('0 2 1 * *', { name: 'monthly-depreciation' })
  async handleCron(): Promise<void> {
    const today = new Date();
    const target = endOfMonthIso(
      toIsoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15))),
    );

    await this.schedulerLock.runOnce('monthly-depreciation', toIsoMonth(target), async () => {
      // Each tenant in its own context: the assets are behind the row-level policies, and a run
      // with no tenant set found none and depreciated nothing.
      await forEachTenant(
        this.dataSource,
        async (organizationId) => {
          await this.runMonthlyDepreciation(organizationId, target);
        },
        undefined,
        (organizationId, error) =>
          this.logger.error(`Depreciation failed for organization ${organizationId}: ${(error as Error).message}`),
      );
    });
  }

  /** `DepreciationPort.runForPeriod`: the period close charges the month it closes. */
  override async runForPeriod(
    organizationId: string,
    period: { startDate: IsoDate; endDate: IsoDate },
    manager?: EntityManager,
  ): Promise<void> {
    await this.runMonthlyDepreciation(organizationId, period.endDate, manager);
  }

  /**
   * Charge every in-use asset of the tenant everything it is due through the month of
   * `depreciationDate`.
   *
   * @param depreciationDate any date inside the month to charge through, as an `IsoDate` (what a
   *   `date` column hands back) or a `Date`.
   */
  async runMonthlyDepreciation(
    organizationId: string,
    depreciationDate: Date | string = new Date(),
    manager?: EntityManager,
  ): Promise<DepreciationRunResult> {
    const periodEnd = endOfMonthIso(toIsoDate(depreciationDate));
    const execute = async (em: EntityManager) => {
      await this.lockTenant(em, organizationId);
      const assets = await em.find(FixedAsset, {
        where: { organizationId, status: FixedAssetStatus.IN_USE },
        order: { number: 'ASC' },
      });
      return this.charge(em, organizationId, assets, periodEnd, 'monthly-depreciation');
    };
    return manager ? execute(manager) : this.dataSource.transaction(execute);
  }

  /**
   * Charge one asset everything it is due through `through`, on the caller's transaction — what a
   * disposal does first, so the asset leaves the books at its carrying amount on the day.
   */
  async chargeAsset(
    manager: EntityManager,
    asset: FixedAsset,
    through: IsoDate,
  ): Promise<DepreciationRunResult> {
    await this.lockTenant(manager, asset.organizationId);
    return this.charge(manager, asset.organizationId, [asset], endOfMonthIso(through), 'asset-disposal');
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
    return summarise(periodEnd, null, planned, skipped);
  }

  private async charge(
    em: EntityManager,
    organizationId: string,
    assets: FixedAsset[],
    periodEnd: IsoDate,
    systemReason: string,
  ): Promise<DepreciationRunResult> {
    const { planned, skipped } = await this.plan(em, organizationId, assets, periodEnd);
    for (const skip of skipped) {
      this.logger.warn(`Activo ${skip.number} sin cuentas de depreciación en ${organizationId}; se omite.`);
    }
    if (planned.length === 0) return summarise(periodEnd, null, [], skipped);

    // Only now that something is due: a company with no assets to charge must not need a ledger
    // or a journal it will never post to (QA C-06).
    const defaultLedger = await em.findOneBy(Ledger, { organizationId, isDefault: true });
    if (!defaultLedger) throw new BadRequestError('fixed_assets.no_default_ledger_has_configured_organization');
    const journal = await this.journalLookup.findByCode(organizationId, 'DEPREC', em);
    if (!journal) throw new BadRequestError('fixed_assets.depreciation_journal_deprec_not_found_create');

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
        const month = toIsoMonth(charge.periodEnd);
        const amount = roundAmount(charge.amount);
        const words = await this.narrative.describeAll(em, organizationId, {
          expense: { key: 'ledger.depreciation.expense', params: { month, asset: `${asset.number} ${asset.name}` } },
          accumulated: { key: 'ledger.depreciation.accumulated', params: { month, asset: `${asset.number} ${asset.name}` } },
        });
        group.lines.push(
          {
            accountId: expenseAccountId,
            debit: amount,
            credit: 0,
            description: words.expense,
            valuations: [{ ledgerId: defaultLedger.id, debit: amount, credit: 0 }],
          },
          {
            accountId: accumulatedAccountId,
            debit: 0,
            credit: amount,
            description: words.accumulated,
            valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: amount }],
          },
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
        { actorUserId: null, systemReason },
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

    const month = toIsoMonth(periodEnd);
    // The latest entry: the run's own month whenever anything was due in it.
    const result = summarise(periodEnd, runEntryId, planned, skipped);
    this.logger.log(
      `Depreciación hasta ${month} registrada en ${organizationId}: ${planned.length} activos, ${result.total}.`,
    );
    return result;
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

      if (settings === undefined) settings = await this.orgSettings.getForOrg(organizationId, em);
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

  /**
   * One run per tenant at a time. Transaction-scoped: released at commit or rollback, so a failed
   * run leaves nothing claimed — the period close's rollback included.
   */
  private async lockTenant(em: EntityManager, organizationId: string): Promise<void> {
    await em.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fixed-asset-depreciation:${organizationId}`]);
  }
}

function summarise(
  periodEnd: IsoDate,
  journalEntryId: string | null,
  planned: PlannedAsset[],
  skipped: DepreciationRunResult['skipped'],
): DepreciationRunResult {
  const totalCents = planned.reduce((sum, item) => sum + toCents(item.amount), 0);
  return {
    periodEnd,
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
  };
}

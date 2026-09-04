import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { FixedAsset, FixedAssetStatus } from './entities/fixed-asset.entity';
import { JournalEntriesService } from '../journal-entries/journal-entries.service';
import { OrganizationSettings } from '../organizations/entities/organization-settings.entity';
import { Journal } from '../journal-entries/entities/journal.entity';
import { Cron } from '@nestjs/schedule';
import { Organization } from '../organizations/entities/organization.entity';
import { Ledger } from '../accounting/entities/ledger.entity';
import {
  CreateJournalEntryDto,
  CreateJournalEntryLineDto,
} from '../journal-entries/dto/create-journal-entry.dto';
import { BadRequestError } from '../i18n/localized.exception';
import { SchedulerLockService } from '../shared/scheduler/scheduler-lock.service';
import { roundAmount, toCents } from '../common/money';
import {
  endOfMonthIso,
  monthsBetween,
  toIsoDate,
  toIsoMonth,
  type IsoDate,
} from '../common/dates';

/**
 * Monthly depreciation.
 *
 * ## Three defects this replaces
 *
 * The cron was `EVERY_DAY_AT_2AM` on a method called `runMonthlyDepreciation`, with no marker of
 * what had already been depreciated. It posted a full month's charge **every night**, so a
 * five-year asset was fully written down in about two months — and the period close called it again
 * on top. Runs are now claimed per tenant and period through `SchedulerLockService`, so the job is
 * idempotent whatever fires it and however many replicas are running.
 *
 * `accumulatedDepreciation` was a `decimal` column with no transformer, so it arrived in JavaScript
 * as a string and `asset.accumulatedDepreciation += depreciationAmount` concatenated instead of
 * adding: `"0.00" + 166.67` is `"0.00166.67"`. From the next line on the book value was `NaN`, and
 * the guard that stops an asset at its depreciable base (`>= depreciableValue`) compared `NaN` and
 * never fired again. The transformer is declared now, and the arithmetic runs in cents.
 *
 * And it posted one journal entry per asset. A tenant with four hundred assets got four hundred
 * entries a month, each with its own number in the consecutive series. One entry per run now, with
 * a line per asset, which is both the conventional presentation and a single document to reverse.
 *
 * ## A fourth: the date this ran on was never a `Date`
 *
 * Every method here took a `Date` and called `getUTCFullYear()` on it. The scheduler passes one, so
 * the cron worked. The **period close** passes `period.endDate`, and a PostgreSQL `date` column
 * arrives in JavaScript as the string `'2026-01-31'` whatever the entity's type annotation claims —
 * so `runPreClosingTasks` threw `date.getUTCFullYear is not a function`, `ClosingAutomationService`
 * re-threw it as "Fallo en la depreciación de activos fijos", and **the period close failed for
 * every tenant, on every period, always**. The integration suite could not see it because it
 * replaces `ClosingAutomationService` with a stub.
 *
 * Dates are `IsoDate` strings throughout this file now, normalised at every entry point through
 * `toIsoDate`, which accepts both forms and rejects anything else loudly. See `common/dates`.
 */
@Injectable()
export class DepreciationService {
  private readonly logger = new Logger(DepreciationService.name);

  constructor(
    private readonly journalEntriesService: JournalEntriesService,
    private readonly schedulerLock: SchedulerLockService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Fires on the first of the month. The claim below is what actually makes it monthly — a cron
   * expression is a hope, and this one used to say daily.
   */
  @Cron('0 2 1 * *', { name: 'monthly-depreciation' })
  async handleCron(): Promise<void> {
    // Depreciate the month that just ended, not the one that just started.
    const today = new Date();
    const target = endOfMonthIso(
      toIsoDate(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 15))),
    );

    const organizations = await this.dataSource.getRepository(Organization).find({
      select: { id: true },
    });

    for (const org of organizations) {
      await this.runMonthlyDepreciation(org.id, target).catch((error) => {
        this.logger.error(
          `Depreciación fallida para la organización ${org.id}: ${(error as Error).message}`,
        );
      });
    }
  }

  /**
   * Post one month of depreciation for every in-use asset.
   *
   * Called by the scheduler and by the period close. **Both** go through
   * `SchedulerLockService.runOnce` on the same key, so the close cannot double up on a month the
   * scheduler has already posted, and vice versa. That was documented before and was not true: the
   * claim lived in `handleCron`, so the close called straight through it, and the only thing
   * standing between a period close and a duplicate month's charge was the per-asset
   * `depreciatedThrough` guard. The claim is inside the method now, where every caller gets it.
   *
   * @param depreciationDate the month to charge, as any date inside it. Accepts an `IsoDate` — which
   *   is what a `date` column actually hands back — as well as a `Date`.
   */
  async runMonthlyDepreciation(
    organizationId: string,
    depreciationDateInput: Date | string = new Date(),
    manager?: EntityManager,
  ): Promise<void> {
    const depreciationDate: IsoDate = toIsoDate(depreciationDateInput);
    const execute = async (em: EntityManager) => {
      const settings = await em.findOneBy(OrganizationSettings, { organizationId });
      if (
        !settings?.defaultDepreciationExpenseAccountId ||
        !settings?.defaultAccumulatedDepreciationAccountId
      ) {
        this.logger.warn(
          `Cuentas de depreciación no configuradas en la organización ${organizationId}; se omite.`,
        );
        return;
      }

      const defaultLedger = await em.findOneBy(Ledger, { organizationId, isDefault: true });
      if (!defaultLedger) {
        this.logger.warn(
          `Sin libro contable por defecto en la organización ${organizationId}; se omite.`,
        );
        return;
      }

      const depreciationJournal = await em.findOneBy(Journal, {
        organizationId,
        code: 'DEPREC',
      });
      if (!depreciationJournal) {
        throw new BadRequestError(
          'FIXED_ASSETS.DIARIO_DEPRECIACION_DEPREC_NO_ENCONTRADO_FAVOR_CREE',
        );
      }

      const assets = await em.find(FixedAsset, {
        where: { organizationId, status: FixedAssetStatus.IN_USE },
      });

      const lines: CreateJournalEntryLineDto[] = [];
      let totalCents = 0;

      for (const asset of assets) {
        const amount = this.monthlyChargeFor(asset, depreciationDate);
        if (toCents(amount) === 0) continue;

        asset.accumulatedDepreciation = roundAmount(asset.accumulatedDepreciation + amount);
        asset.bookValue = roundAmount(asset.cost - asset.accumulatedDepreciation);
        asset.depreciatedThrough = toIsoDate(depreciationDate);
        await em.save(asset);

        totalCents += toCents(amount);
        lines.push(
          {
            accountId: settings.defaultDepreciationExpenseAccountId,
            debit: amount,
            credit: 0,
            description: `Depreciación ${toIsoMonth(depreciationDate)} — ${asset.name}`,
            valuations: [{ ledgerId: defaultLedger.id, debit: amount, credit: 0 }],
          },
          {
            accountId: settings.defaultAccumulatedDepreciationAccountId,
            debit: 0,
            credit: amount,
            description: `Depreciación acumulada ${toIsoMonth(depreciationDate)} — ${asset.name}`,
            valuations: [{ ledgerId: defaultLedger.id, debit: 0, credit: amount }],
          },
        );
      }

      if (lines.length === 0) {
        this.logger.log(
          `Sin depreciación que registrar en ${organizationId} para ${toIsoMonth(depreciationDate)}.`,
        );
        return;
      }

      await this.journalEntriesService.createWithManager(
        em,
        {
          date: depreciationDate,
          description: `Depreciación mensual ${toIsoMonth(depreciationDate)}`,
          journalId: depreciationJournal.id,
          lines,
        } as CreateJournalEntryDto,
        organizationId,
        { actorUserId: null, systemReason: 'monthly-depreciation' },
      );

      this.logger.log(
        `Depreciación ${toIsoMonth(depreciationDate)} registrada en ${organizationId}: ${lines.length / 2} activos, ${roundAmount(totalCents / 100)}.`,
      );
    };

    // The claim keys on the tenant and the month, so the scheduler and the close cannot both post
    // it, and neither can two replicas. On the caller's manager when there is one, so a rolled-back
    // close releases the month rather than marking it permanently done.
    const runKey = `${organizationId}:${toIsoMonth(depreciationDate)}`;
    if (manager) {
      await this.schedulerLock.runOnce(
        'monthly-depreciation',
        runKey,
        () => execute(manager),
        manager,
      );
    } else {
      await this.schedulerLock.runOnce('monthly-depreciation', runKey, () =>
        this.dataSource.transaction(execute),
      );
    }
  }

  /**
   * One month's charge for an asset, capped at what is left to depreciate.
   *
   * Returns zero for an asset already depreciated through this period, which is the per-asset half
   * of the idempotency: the run-level claim stops the job repeating, and this stops an asset being
   * charged twice if it is picked up by two different runs (the scheduler's and the close's).
   */
  private monthlyChargeFor(asset: FixedAsset, depreciationDate: IsoDate): number {
    if (asset.depreciatedThrough && toIsoDate(asset.depreciatedThrough) >= depreciationDate) {
      return 0;
    }

    const depreciableValue = roundAmount(asset.cost - asset.residualValue);
    const remaining = roundAmount(depreciableValue - asset.accumulatedDepreciation);
    if (toCents(remaining) <= 0) return 0;

    const usefulLifeInMonths = asset.usefulLife;
    if (!usefulLifeInMonths || usefulLifeInMonths <= 0) return 0;

    const ageInMonths = monthsBetween(asset.purchaseDate, depreciationDate);
    if (ageInMonths < 0) return 0;

    let charge = 0;
    switch (asset.depreciationMethod) {
      case 'SUM_OF_YEARS_DIGITS': {
        const years = usefulLifeInMonths / 12;
        const sumOfDigits = (years * (years + 1)) / 2;
        const currentYear = Math.floor(ageInMonths / 12) + 1;
        if (currentYear <= years && sumOfDigits > 0) {
          charge = (depreciableValue * (years - currentYear + 1)) / sumOfDigits / 12;
        }
        break;
      }
      case 'DOUBLE_DECLINING_BALANCE': {
        const bookValue = asset.cost - asset.accumulatedDepreciation;
        charge = bookValue * (2 / usefulLifeInMonths);
        break;
      }
      case 'STRAIGHT_LINE':
      default:
        charge = depreciableValue / usefulLifeInMonths;
        break;
    }

    // Never past the residual value, whatever the method's formula produces in the final period.
    return roundAmount(Math.max(0, Math.min(charge, remaining)));
  }
}
